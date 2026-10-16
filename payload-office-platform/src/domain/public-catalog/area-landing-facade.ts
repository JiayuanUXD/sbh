import type { Location } from '@/payload-types'
import {
  AREA_LANDING_MIN_LISTINGS,
  summarizeAreaPrice,
  type AreaLandingStatsRow,
  type AreaPriceSummary,
} from './area-landing'
import { parseBuildingSearchInput } from './building-search'
import type { ArticleCardViewModel, BuildingSummaryViewModel } from './contracts'
import { searchBuildingsFiltered } from './facade'
import { mapArticleCard } from './mappers'
import { getDefaultSupplyAdapter, type SupplyAdapter } from './supply-adapter'
import type { SearchContext } from './types'

/**
 * 区域 / 商圈落地页的取数门面（OPT-119）。
 *
 * 纯组装 + 最少的 IO：统计来自 `findAreaLandingStats`（与列表 / 详情 / sitemap 同一份有效
 * 供给谓词），可见性来自后台 `Locations.frontendVisible`（Payload 字段，SQL 里判不了），
 * 两者求交。热门楼盘复用楼盘列表页的 `searchBuildingsFiltered`，不另造一套楼盘排序。
 */

/** 区域页热门楼盘张数。 */
const TOP_BUILDINGS = 6
/** 兄弟商圈互链上限，防止个别行政区下辖商圈很多时页面被链接淹没。 */
const SIBLING_AREAS_MAX = 12
const ARTICLES_MAX = 6

export type AreaLandingEntry = AreaLandingStatsRow & Readonly<{
  /** 后台运营写的介绍；缺省为 null，由文案模板用数据事实补。 */
  description: string | null
  /** 达到收录门槛（进 sitemap、不加 noindex）。 */
  indexable: boolean
}>

function zeroStats(
  kind: AreaLandingStatsRow['kind'],
  location: Location,
  parent: Location | null,
): AreaLandingStatsRow {
  return {
    kind,
    id: location.id,
    slug: location.slug,
    name: location.name,
    parentSlug: parent?.slug ?? null,
    parentName: parent?.name ?? null,
    listingCount: 0,
    buildingCount: 0,
    priceSampleCount: 0,
    priceMin: null,
    priceP25: null,
    priceMedian: null,
    priceP75: null,
    priceMax: null,
    otherUnitCount: 0,
    areaMedian: null,
    lastUpdatedAt: null,
  }
}

function parentLocation(location: Location): Location | null {
  return typeof location.parent === 'object' && location.parent !== null ? location.parent : null
}

function toEntry(stats: AreaLandingStatsRow, location: Location): AreaLandingEntry {
  return {
    ...stats,
    // 名称以地点表为准：运营改名后立刻生效，不受统计行里的旧快照影响。
    name: location.name,
    description: location.description?.trim() || null,
    indexable: stats.listingCount >= AREA_LANDING_MIN_LISTINGS,
  }
}

/** 统计行 × 前台可见地点表。只有可见地点才会出现在结果里；可见但无供给的给零值行。 */
export function buildAreaLandingIndex(input: Readonly<{
  stats: readonly AreaLandingStatsRow[]
  districts: readonly Location[]
  businessAreas: readonly Location[]
}>): AreaLandingEntry[] {
  const byKey = new Map(input.stats.map((row) => [`${row.kind}:${row.slug}`, row]))
  const entries: AreaLandingEntry[] = []
  for (const district of input.districts) {
    const stats = byKey.get(`district:${district.slug}`) ?? zeroStats('district', district, null)
    entries.push(toEntry(stats, district))
  }
  for (const area of input.businessAreas) {
    const stats = byKey.get(`business_area:${area.slug}`) ?? zeroStats('business_area', area, parentLocation(area))
    entries.push(toEntry(stats, area))
  }
  return entries
}

export async function getAreaLandingIndex(
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly AreaLandingEntry[]> {
  if (!adapter.findAreaLandingStats) throw new Error('area_landing_stats_unsupported')
  const [stats, districts, businessAreas] = await Promise.all([
    adapter.findAreaLandingStats(ctx),
    adapter.findEffectiveDistricts(ctx),
    adapter.findEffectiveBusinessAreas(ctx),
  ])
  return buildAreaLandingIndex({ stats, districts, businessAreas })
}

export type AreaLandingPage = Readonly<{
  entry: AreaLandingEntry
  /** 商圈所属行政区（仅当它本身也可见时才有，否则面包屑不会指向 404）。 */
  parent: AreaLandingEntry | null
  /** 行政区页：有在租房源的下辖商圈，按在租套数降序。 */
  childAreas: readonly AreaLandingEntry[]
  /** 商圈页：同一行政区下其它有在租房源的商圈。 */
  siblingAreas: readonly AreaLandingEntry[]
  price: AreaPriceSummary | null
  topBuildings: readonly BuildingSummaryViewModel[]
  articles: readonly ArticleCardViewModel[]
}>

function byListingCountDesc(a: AreaLandingEntry, b: AreaLandingEntry): number {
  return b.listingCount - a.listingCount || a.name.localeCompare(b.name, 'zh-CN')
}

export async function getAreaLandingPage(
  slug: string,
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
  searchBuildings: typeof searchBuildingsFiltered = searchBuildingsFiltered,
): Promise<AreaLandingPage | null> {
  const index = await getAreaLandingIndex(ctx, adapter)
  const entry = index.find((item) => item.slug === slug)
  if (!entry) return null

  const areas = index.filter((item) => item.kind === 'business_area')
  const parent = entry.kind === 'business_area'
    ? index.find((item) => item.kind === 'district' && item.slug === entry.parentSlug) ?? null
    : null
  const childAreas = entry.kind === 'district'
    ? areas.filter((item) => item.parentSlug === entry.slug && item.listingCount > 0).sort(byListingCountDesc)
    : []
  const siblingAreas = entry.kind === 'business_area'
    ? areas
      .filter((item) => item.parentSlug === entry.parentSlug && item.slug !== entry.slug && item.listingCount > 0)
      .sort(byListingCountDesc)
      .slice(0, SIBLING_AREAS_MAX)
    : []

  // 零供给的页面只是诚实空态：不白打库查楼盘 / 资讯。
  if (entry.listingCount === 0) {
    return { entry, parent, childAreas, siblingAreas, price: null, topBuildings: [], articles: [] }
  }

  const input = parseBuildingSearchInput(new URLSearchParams([[entry.kind === 'district' ? 'district' : 'businessArea', entry.slug]]))
  const relatedIds = entry.kind === 'district'
    ? [entry.id, ...areas.filter((item) => item.parentSlug === entry.slug).map((item) => item.id)]
    : [entry.id, ...(parent ? [parent.id] : [])]
  const [buildings, articleDocs] = await Promise.all([
    searchBuildings(input, ctx, adapter),
    adapter.findArticlesByRelatedLocations
      ? adapter.findArticlesByRelatedLocations(relatedIds, ARTICLES_MAX)
      : Promise.resolve([]),
  ])
  const articles: ArticleCardViewModel[] = []
  for (const doc of articleDocs) {
    const card = mapArticleCard(doc)
    if (card) articles.push(card)
  }
  return {
    entry,
    parent,
    childAreas,
    siblingAreas,
    price: summarizeAreaPrice(entry),
    topBuildings: buildings.groups.withStock.slice(0, TOP_BUILDINGS),
    articles,
  }
}
