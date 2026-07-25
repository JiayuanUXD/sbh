/**
 * 公开目录 Mapper
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§7
 *
 * Mapper 负责把 Payload 文档（或后续 M4.7 服务输出）投影成公开 DTO。
 * 组件只消费 DTO，不接收原始 Payload 文档。
 *
 * 安全规则（FRONTEND_AGENT.md §6.2）：
 *   - 字段白名单：不向浏览器暴露审核、举报、商户资质、内部电话、
 *     权限、审计、精确内部坐标或工作版本
 *   - 关系字段在 Payload depth ≥ 1 时为对象，depth = 0 时为 id；
 *     mapper 使用类型守卫安全收窄
 *   - 媒体统一映射为 MediaViewModel；缺失 alt 时回退到"楼盘名 + 空间类型"
 *   - 价格始终保留数值、币种、单位和可读文本
 */

import type { Listing, Building, Location, Media, Amenity } from '@/payload-types'
import type {
  BuildingDetailViewModel,
  BuildingSummaryViewModel,
  DistrictViewModel,
  ListingCardViewModel,
  ListingDetailViewModel,
  MediaViewModel,
  PriceViewModel,
  PopulatedBuilding,
  PopulatedListing,
} from './contracts'

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

function isMedia(v: unknown): v is Media {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Media).id === 'number' &&
    typeof (v as Media).alt === 'string'
  )
}

function isLocation(v: unknown): v is Location {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Location).id === 'number' &&
    typeof (v as Location).slug === 'string' &&
    typeof (v as Location).name === 'string'
  )
}

function isBuilding(v: unknown): v is Building {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Building).id === 'number' &&
    typeof (v as Building).slug === 'string' &&
    typeof (v as Building).name === 'string'
  )
}

function isAmenity(v: unknown): v is Amenity {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Amenity).id === 'number' &&
    typeof (v as Amenity).name === 'string'
  )
}

function isPopulatedListing(v: unknown): v is PopulatedListing {
  if (typeof v !== 'object' || v === null) return false
  const l = v as Partial<Listing>
  return (
    typeof l.id === 'number' &&
    typeof l.slug === 'string' &&
    typeof l.title === 'string' &&
    typeof l.listingType === 'string' &&
    typeof l.rent === 'number'
  )
}

function isPopulatedBuilding(v: unknown): v is PopulatedBuilding {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Partial<Building>
  return (
    typeof b.id === 'number' &&
    typeof b.slug === 'string' &&
    typeof b.name === 'string'
  )
}

// ---------------------------------------------------------------------------
// 基础值对象 mapper
// ---------------------------------------------------------------------------

const RENT_UNIT_LABEL: Record<NonNullable<Listing['rentUnit']>, string> = {
  'rmb-sqm-day': '元/㎡/天',
  'rmb-month': '元/月',
  'rmb-seat-month': '元/工位/月',
}

/** 把 Listing.rent + rentUnit 投影为 PriceViewModel；rent 缺失或非法时返回 null */
export function mapPrice(
  rent: number | null | undefined,
  unit: Listing['rentUnit'],
): PriceViewModel | null {
  if (typeof rent !== 'number' || !Number.isFinite(rent) || rent < 0) return null
  if (!unit) return null
  const label = RENT_UNIT_LABEL[unit]
  if (!label) return null
  return {
    amount: rent,
    currency: 'CNY',
    unit,
    text: `${rent} ${label}`,
  }
}

/** 把 Media 投影为 MediaViewModel；非媒体或无 url 返回 null */
export function mapMedia(
  raw: unknown,
  fallbackAlt: string,
): MediaViewModel | null {
  if (!isMedia(raw)) return null
  const url = raw.url
  if (typeof url !== 'string' || url.length === 0) return null
  return {
    src: url,
    width: raw.width ?? undefined,
    height: raw.height ?? undefined,
    alt: raw.alt || fallbackAlt,
    blurDataURL: raw.blurDataUrl ?? undefined,
  }
}

/** 把 Location 投影为 DistrictViewModel */
export function mapDistrict(raw: unknown): DistrictViewModel | undefined {
  if (!isLocation(raw)) return undefined
  return { id: raw.id, slug: raw.slug, name: raw.name }
}

/** 把 Building 投影为 BuildingSummaryViewModel；非楼盘返回 null */
export function mapBuildingSummary(raw: unknown): BuildingSummaryViewModel | null {
  if (!isBuilding(raw)) return null
  const populated = isPopulatedBuilding(raw) ? raw : null
  const districtRaw = populated?.district
  const coverRaw = populated?.coverImage
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    address: raw.address ?? '',
    grade: raw.grade ?? undefined,
    district: mapDistrict(districtRaw),
    coverImage: mapMedia(coverRaw, raw.name) ?? undefined,
    summary: raw.summary ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// 卡片 DTO mapper
// ---------------------------------------------------------------------------

const MAX_CARD_HIGHLIGHTS = 3

/**
 * 把 Payload Listing 文档投影为 ListingCardViewModel。
 *
 * 输入视为 `unknown`，由类型守卫收窄；任何字段缺失都返回 null 而非抛错，
 * 让上层决定如何处理（404 / 空列表 / 错误状态）。
 */
export function mapListingCard(raw: unknown): ListingCardViewModel | null {
  if (!isPopulatedListing(raw)) return null
  const listing = raw as PopulatedListing

  const building = mapBuildingSummary(listing.building)
  const coverImage =
    mapMedia(listing.coverImage, listing.title) ??
    building?.coverImage ??
    null

  const highlights: string[] = []
  if (Array.isArray(listing.highlights)) {
    for (const h of listing.highlights) {
      if (h && typeof h.text === 'string' && h.text.length > 0) {
        highlights.push(h.text)
      }
      if (highlights.length >= MAX_CARD_HIGHLIGHTS) break
    }
  }

  return {
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    price: mapPrice(listing.rent, listing.rentUnit),
    area: listing.area ?? null,
    listingType: listing.listingType,
    availableFrom: listing.availableFrom ?? null,
    isFeatured: listing.isFeatured === true,
    building,
    coverImage,
    highlights,
    stableSortKey: `listing-${listing.id}`,
  }
}

// ---------------------------------------------------------------------------
// 详情 DTO mapper
// ---------------------------------------------------------------------------

/**
 * 把 Payload Listing 文档投影为 ListingDetailViewModel。
 *
 * 详情 DTO 在卡片字段上增加画廊、楼盘摘要和富文本说明。
 * 画廊来源：房源 coverImage + 楼盘 gallery，去重后保留有效 url。
 */
export function mapListingDetail(raw: unknown): ListingDetailViewModel | null {
  const card = mapListingCard(raw)
  if (!card) return null
  const listing = raw as PopulatedListing

  const gallery: MediaViewModel[] = []
  if (card.coverImage) gallery.push(card.coverImage)

  const buildingRaw = listing.building
  if (isBuilding(buildingRaw) && Array.isArray(buildingRaw.gallery)) {
    for (const g of buildingRaw.gallery) {
      if (!g || typeof g !== 'object') continue
      const img = (g as { image?: unknown }).image
      const media = mapMedia(img, buildingRaw.name)
      if (media && !gallery.some((m) => m.src === media.src)) {
        gallery.push(media)
      }
    }
  }

  return {
    ...card,
    seats: listing.seats ?? null,
    gallery,
    description: listing.description,
  }
}

/** 把 Payload Building 文档投影为 BuildingDetailViewModel */
export function mapBuildingDetail(raw: unknown): BuildingDetailViewModel | null {
  if (!isPopulatedBuilding(raw)) return null
  const building = raw as PopulatedBuilding

  const coverImage = mapMedia(building.coverImage, building.name) ?? null

  const gallery: MediaViewModel[] = []
  if (coverImage) gallery.push(coverImage)
  if (Array.isArray(building.gallery)) {
    for (const g of building.gallery) {
      if (!g || typeof g !== 'object') continue
      const img = (g as { image?: unknown }).image
      const media = mapMedia(img, building.name)
      if (media && !gallery.some((m) => m.src === media.src)) {
        gallery.push(media)
      }
    }
  }

  const amenities: string[] = []
  if (Array.isArray(building.amenities)) {
    for (const a of building.amenities) {
      if (isAmenity(a)) amenities.push(a.name)
    }
  }

  return {
    id: building.id,
    slug: building.slug,
    name: building.name,
    address: building.address ?? '',
    grade: building.grade ?? undefined,
    district: mapDistrict(building.district),
    businessDistrict: mapDistrict(building.businessDistrict),
    nearestMetro: mapDistrict(building.nearestMetro),
    coverImage,
    gallery,
    amenities,
    summary: building.summary ?? '',
    description: building.description,
  }
}
