import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'

import config from '@/payload.config'
import {
  createCityContextResolver,
  normalizeCitySlug,
  type CityContext,
} from '@/domain/city-site-profile/resolver'
import type { PublicCitySiteProfile } from '@/domain/city-site-profile/public-contract'
import {
  CITY_PROFILES_TAG,
  cityProfileTag,
} from '@/domain/city-site-profile/cache-invalidator'
import {
  isValidCityProfileSeoText,
  normalizeAvgResponseHours,
  normalizeCityDisplayName,
} from '@/domain/city-site-profile/schema'
import { isPublicCitySlug } from '@/lib/frontend/city-routes'

export type PublicCityOption = Readonly<{
  slug: string
  name: string
  serviceStatus: 'live' | 'coming-soon'
  sortOrder: number
}>

type CachedResolver = () => Promise<CityContext | null>

const cityResolvers = new Map<string, CachedResolver>()
const CITY_RESOLVER_CACHE_CAPACITY = 64
const CITY_PROFILE_REVALIDATE_SECONDS = 300

type MappingResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>

function valid<T>(value: T): MappingResult<T> {
  return { ok: true, value }
}

function invalid(): MappingResult<never> {
  return { ok: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is number | string {
  return (
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === 'string' && value.trim().length > 0)
  )
}

function relationshipId(value: unknown): number | string | null {
  if (isIdentifier(value)) return value
  if (!isRecord(value)) return null
  return isIdentifier(value.id) ? value.id : null
}

function isRequiredString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function mapOptionalString(value: unknown): MappingResult<string> {
  if (value === null || value === undefined) return valid('')
  return typeof value === 'string' ? valid(value) : invalid()
}

function isValidDimension(value: unknown): value is number | null | undefined {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value > 0)
  )
}

function mapHeroMedia(value: unknown): MappingResult<PublicCitySiteProfile['hero']['media']> {
  if (value === null || value === undefined) return valid(null)
  if (!isRecord(value) || !isRequiredString(value.url) || typeof value.alt !== 'string') {
    return invalid()
  }
  if (!isValidDimension(value.width) || !isValidDimension(value.height)) {
    return invalid()
  }
  return valid({
    src: value.url,
    ...(typeof value.width === 'number' ? { width: value.width } : {}),
    ...(typeof value.height === 'number' ? { height: value.height } : {}),
    alt: value.alt,
  })
}

/**
 * 区域介绍（`Locations.description`）→ DTO 的 `description`。
 *
 * 与 `mapOptionalString` 的两点差别，都是刻意的：
 *   - 空串 / 纯空白折成 `null` 而不是 `''`。消费方要判「有没有区位信息」，
 *     留一个空串等于把这个判断复制到每个消费方去做。
 *   - 类型不对仍然 `invalid()`：与本 mapper 其余字段同一严格度，
 *     持久化里出现非字符串说明写入路径坏了，不该悄悄放行。
 */
function mapRegionDescription(value: unknown): MappingResult<string | null> {
  if (value === null || value === undefined) return valid(null)
  if (typeof value !== 'string') return invalid()
  const trimmed = value.trim()
  return valid(trimmed.length > 0 ? trimmed : null)
}

/**
 * 上级区域（`Locations.parent`）→ DTO 的 `parentName`（区位副标的前半段）。
 *
 * 层级事实（`Locations` 的 type 固定为 城市 > 行政区 > 商圈）：
 *   - `business_area` 的 parent 是**行政区** → 这正是稿子「上城区 · 金融总部核心区」
 *     里的「上城区」，要显示；
 *   - `district` 的 parent 是**城市本身** → 在这座城市自己的招募页上再印一遍
 *     城市名不是区位信息，是噪音，折成 null。
 * 判据用「parent 的 id 是否等于本 profile 的 cityId」而不是 `parent.type === 'city'`：
 * cityId 是调用方已经传进来的同一个事实源，且 `protectLocation` 保证节点不可跨城市移动，
 * 不需要再依赖 parent 自己的 type 字段被展开。
 *
 * **裸 id 的处置**：走到这里说明取数 depth 不足以展开 parent（当前两处取数都是
 * `depth: 2`，实测足够，见 scripts/verification/opt038-featured-regions-depth-probe.ts）。
 * 不返回 `invalid()` —— 那会把整个 profile 判废、让这座城市从城市页 / 切换器 /
 * 平台统计里整体消失，用「取数深度」这种查询侧问题去惩罚数据本身，代价完全不成比例。
 * 但也**不静默吞掉**（区位副标无声消失、几个月无人发现，正是本批反复强调的失效形状）：
 * 按 `Locations.ts` 既有口径打一条带 errorCode 的 error 日志，把守卫落在失效点上。
 */
function mapFeaturedRegionParentName(
  parent: unknown,
  regionId: number | string,
  cityId: number | string,
): string | null {
  const parentId = relationshipId(parent)
  if (parentId === null || String(parentId) === String(cityId)) return null
  if (isRecord(parent) && isRequiredString(parent.name)) return parent.name
  console.error('[city-profile-featured-regions] parent_unpopulated', {
    objectId: regionId,
    errorCode: 'featured_region_parent_unpopulated',
  })
  return null
}

function mapFeaturedRegions(
  value: unknown,
  cityId: number | string,
): MappingResult<PublicCitySiteProfile['featuredRegions']> {
  if (value === null || value === undefined) return valid([])
  if (!Array.isArray(value)) return invalid()
  const regions: PublicCitySiteProfile['featuredRegions'][number][] = []
  for (const relation of value) {
    const rawSlug = isRecord(relation) ? relation.slug : null
    const slug = normalizeCitySlug(rawSlug)
    const owningCityId = isRecord(relation) ? relationshipId(relation.city) : null
    const description = mapRegionDescription(isRecord(relation) ? relation.description : null)
    if (
      !isRecord(relation) ||
      !isIdentifier(relation.id) ||
      !slug ||
      rawSlug !== slug ||
      (relation.type !== 'district' && relation.type !== 'business_area') ||
      relation.status !== 'active' ||
      relation.frontendVisible !== true ||
      owningCityId === null ||
      String(owningCityId) !== String(cityId) ||
      !isRequiredString(relation.name) ||
      !description.ok
    ) {
      return invalid()
    }
    regions.push({
      id: relation.id,
      slug,
      name: relation.name,
      type: relation.type,
      parentName: mapFeaturedRegionParentName(relation.parent, relation.id, cityId),
      description: description.value,
    })
  }
  return valid(regions)
}

function mapPublicCityProfile(value: unknown): PublicCitySiteProfile | null {
  if (!isRecord(value) || !isRecord(value.city)) return null
  const city = value.city
  const rawCitySlug = city.slug
  const citySlug = normalizeCitySlug(rawCitySlug)
  const cityName = normalizeCityDisplayName(city.name)
  const eyebrow = mapOptionalString(value.heroEyebrow)
  const heading = mapOptionalString(value.heroHeading)
  const heroBody = mapOptionalString(value.heroBody)
  const introHeading = mapOptionalString(value.introHeading)
  const introBody = mapOptionalString(value.introBody)
  const contactHeading = mapOptionalString(value.contactHeading)
  const contactBody = mapOptionalString(value.contactBody)
  const media = mapHeroMedia(value.heroMedia)
  const featuredRegions = isIdentifier(city.id)
    ? mapFeaturedRegions(value.featuredRegions, city.id)
    : invalid()
  if (
    !isIdentifier(city.id) ||
    !citySlug ||
    rawCitySlug !== citySlug ||
    city.type !== 'city' ||
    city.status !== 'active' ||
    !cityName ||
    (value.serviceStatus !== 'live' && value.serviceStatus !== 'coming-soon') ||
    typeof value.switcherVisible !== 'boolean' ||
    typeof value.sortOrder !== 'number' ||
    !Number.isFinite(value.sortOrder) ||
    value.sortOrder < 0 ||
    !isValidCityProfileSeoText(value.seoTitle, 'title', cityName) ||
    !isValidCityProfileSeoText(value.seoDescription, 'description', cityName) ||
    !eyebrow.ok ||
    !heading.ok ||
    !heroBody.ok ||
    !introHeading.ok ||
    !introBody.ok ||
    !contactHeading.ok ||
    !contactBody.ok ||
    !media.ok ||
    !featuredRegions.ok
  ) {
    return null
  }

  return {
    cityId: city.id,
    citySlug,
    cityName,
    serviceStatus: value.serviceStatus,
    switcherVisible: value.switcherVisible,
    sortOrder: value.sortOrder,
    avgResponseHours: normalizeAvgResponseHours(value.avgResponseHours),
    seoTitle: value.seoTitle,
    seoDescription: value.seoDescription,
    hero: {
      eyebrow: eyebrow.value,
      heading: heading.value,
      body: heroBody.value,
      media: media.value,
    },
    intro: { heading: introHeading.value, body: introBody.value },
    contact: { heading: contactHeading.value, body: contactBody.value },
    featuredRegions: featuredRegions.value,
  }
}

/**
 * `depth: 2` 不是可以顺手调小的常数（两处取数同此约束）。
 *
 * 实测（scripts/verification/opt038-featured-regions-depth-probe.ts，本地库上海 profile）：
 *   - depth 1：`featuredRegions[i]` 是完整 Location，但 `.parent` 是裸 id（`number(2)`）；
 *   - depth 2：`.parent` 展开成完整 Location（`name` / `type` 都在）→ 区位副标的
 *     「上城区」这一段才拿得到；
 *   - depth 3：只多展开 `parent.parent`，本页用不上。
 * 即 **2 是刚好够用的最小值**。调到 1 不会报错，只会让 `parentName` 全变 null、
 * 商圈卡的区位副标静默少半截（`mapFeaturedRegionParentName` 会打 error 日志兜住）。
 */
async function findPublicCityProfile(slug: string): Promise<PublicCitySiteProfile | null> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'city-site-profiles',
    depth: 2,
    limit: 1,
    where: { 'city.slug': { equals: slug } },
  })
  const profile = result.docs[0]
  return profile ? mapPublicCityProfile(profile) : null
}

async function findPublicCityProfiles(): Promise<readonly PublicCitySiteProfile[]> {
  const payload = await getPayload({ config })
  const result = await payload.find({
    collection: 'city-site-profiles',
    depth: 2,
    limit: 500,
    sort: ['sortOrder', 'id'],
  })
  return result.docs
    .map(mapPublicCityProfile)
    .filter((profile): profile is PublicCitySiteProfile => profile !== null)
}

function getCachedResolver(citySlug: string): CachedResolver {
  const existing = cityResolvers.get(citySlug)
  if (existing) {
    cityResolvers.delete(citySlug)
    cityResolvers.set(citySlug, existing)
    return existing
  }

  const resolver = createCityContextResolver(findPublicCityProfile)
  const cachedResolver = unstable_cache(
    async () => resolver(citySlug),
    ['public-city-profile', citySlug],
    {
      revalidate: CITY_PROFILE_REVALIDATE_SECONDS,
      tags: [cityProfileTag(citySlug), CITY_PROFILES_TAG],
    },
  )
  cityResolvers.set(citySlug, cachedResolver)
  if (cityResolvers.size > CITY_RESOLVER_CACHE_CAPACITY) {
    const leastRecentlyUsedSlug = cityResolvers.keys().next().value
    if (leastRecentlyUsedSlug !== undefined) cityResolvers.delete(leastRecentlyUsedSlug)
  }
  return cachedResolver
}

export const resolveCityContext = cache(async (slug: unknown): Promise<CityContext | null> => {
  const normalizedSlug = normalizeCitySlug(slug)
  if (!normalizedSlug || !isPublicCitySlug(normalizedSlug)) return null
  return getCachedResolver(normalizedSlug)()
})

export const listPublicCityProfiles = unstable_cache(
  async (): Promise<readonly PublicCitySiteProfile[]> => findPublicCityProfiles(),
  ['public-city-profiles'],
  { revalidate: CITY_PROFILE_REVALIDATE_SECONDS, tags: [CITY_PROFILES_TAG] },
)

/**
 * 根页 `/` 数据带的跨城汇总口径：已开通（`live`）且 slug 在七城白名单内的城市。
 *
 * `isPublicCitySlug` 这道过滤不是冗余：profile 表是运营可写的，slug 可能不是
 * 可路由的公开城市（非规范形态，或撞上 `listings` / `admin` 这类保留根段）。
 * 这种 profile 在前台根本没有对应路由，却仍会被 `getPlatformHomepageStats`
 * 拿去建 SearchContext 并发起三次全量查询——既是无意义的库读，也会把用户
 * 点不进去的供给算进平台数字。与 `listPublicCityOptions` 用的是同一道边界。
 *
 * 不按 `switcherVisible` 过滤：那是「城市切换器里露不露脸」的展示开关，
 * 与「这座城市是否已开通、供给是否该计入平台规模」是两回事。
 */
export function livePlatformStatsSlugs(
  profiles: readonly PublicCitySiteProfile[],
): readonly string[] {
  return profiles
    .filter((profile) => profile.serviceStatus === 'live' && isPublicCitySlug(profile.citySlug))
    .map((profile) => profile.citySlug)
}

export async function listPublicCityOptions(): Promise<readonly PublicCityOption[]> {
  const profiles = await listPublicCityProfiles()
  return profiles
    .filter((profile) => profile.switcherVisible && isPublicCitySlug(profile.citySlug))
    .map((profile) => ({
      slug: profile.citySlug,
      name: profile.cityName,
      serviceStatus: profile.serviceStatus,
      sortOrder: profile.sortOrder,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.slug.localeCompare(right.slug))
}
