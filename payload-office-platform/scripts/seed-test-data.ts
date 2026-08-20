/**
 * 本地测试数据补全脚本（UI / 交互测试用）
 *
 * 目的：为本地 PostgreSQL 服务补全楼盘 / 房源详情页的全部展示字段与结构化媒体，
 *   已有数据字段不全的补全，图片取自免费图库 picsum.photos（离线 / CI 走 sharp 纯色回退）。
 *
 * 幂等：按 slug / alt 查到则更新或复用，找不到则创建；可重复运行。
 * 安全：不触碰 seed.ts 的核心种子、merchant_relations / teams / brokers / leads；
 *   不动 pending-recheck 房源的 merchant 关系；不删 about hero 等已有媒体；
 *   仅清理 3 张占位 dummy 图（替换 gallery 后已成孤儿）。
 *
 * 运行：node --env-file-if-exists=.env.local --import tsx scripts/seed-test-data.ts
 */
import { getPayload } from 'payload'
import sharp from 'sharp'

import config from '../src/payload.config'
import { applySeedTestListingVisibilityPolicy } from './seed-test-data-policy'

type AnyDoc = { id: number }

// ---------------------------------------------------------------------------
// 图片获取（复用 seed-media.ts 模式：在线 picsum / 离线 sharp 纯色）
// ---------------------------------------------------------------------------
const OFFLINE = !!process.env.CI || !!process.env.SEED_MEDIA_OFFLINE
const SOURCE_LABEL = OFFLINE ? 'sharp 本地生成' : 'picsum.photos 下载'

function picsumUrl(seed: string, w: number, h: number): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载图片失败 ${url}: ${res.status} ${res.statusText}`)
  return Buffer.from(await res.arrayBuffer())
}

function seedColor(seed: string): { r: number; g: number; b: number } {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return { r: (h >> 16) & 0xff, g: (h >> 8) & 0xff, b: h & 0xff }
}

async function generateImageBuffer(seed: string, w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: seedColor(seed) } })
    .jpeg({ quality: 70 })
    .toBuffer()
}

async function resolveImageBuffer(seed: string, w: number, h: number): Promise<Buffer> {
  return OFFLINE ? generateImageBuffer(seed, w, h) : fetchImageBuffer(picsumUrl(seed, w, h))
}

// 详情页媒体画廊视频样本（保证原生 video[controls] 可测）
const VIDEO_FIXTURE =
  'AAAAGGZ0eXBtcDQyAAAAAG1wNDJpc29tAAADE21vb3YAAABsbXZoZAAAAACX513Ul+dd1AAAu4AAAHU7AAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAKfdHJhawAAAFx0a2hkAAAAAZfnXdSX513UAAAAAQAAAAAAAHU7AAAAAAAAAAAAAAAAAQAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAJGVkdHMAAAAcZWxzdAAAAAAAAAABAAB1OwAACEAAAQAAAAACF21kaWEAAAAgbWRoZAAAAACX513Ul+dd1AAAu4AAAIAAAAAAAAAAACJoZGxyAAAAAAAAAABzb3VuAAAAAAAAAAAAAAAAAAAAAAHNbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAGRc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgAAAASAgIAUQBUAGAAAAJhwAAAAAAWAgIACEZAGgICAAQIAAAAac2dwZAEAAAByb2xsAAAAAgAAAAH//wAAABxzYmdwAAAAAHJvbGwAAAABAAAAIAAAAAEAAAAYc3R0cwAAAAAAAAABAAAAIAAABAAAAAAoc3RzYwAAAAAAAAACAAAAAQAAABgAAAABAAAAAgAAAAgAAAABAAAAlHN0c3oAAAAAAAAAAAAAACAAAAAGAAABqQAAAagAAAGDAAABIgAAAWEAAAGAAAABQgAAAUYAAAGAAAABwAAAAZIAAAFzAAABZAAAAYgAAAJiAAABWgAAAYEAAAFfAAABfAAAAiUAAAHNAAABOwAAAT0AAAE6AAABNAAAASEAAAEHAAABBgAAAR8AAAHMAAAABgAAABhzdGNvAAAAAAAAAAIAABAAAAAzGAAADM1mcmVlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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'

const COVER_W = 1600
const COVER_H = 900
const GALLERY_W = 1200
const GALLERY_H = 900

async function ensureImage(
  payload: any,
  alt: string,
  seed: string,
  w: number,
  h: number,
  filename: string,
): Promise<AnyDoc> {
  const existing = await payload.find({
    collection: 'media',
    where: { alt: { equals: alt } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs[0]) return existing.docs[0] as AnyDoc
  const buffer = await resolveImageBuffer(seed, w, h)
  return payload.create({
    collection: 'media',
    data: { alt },
    file: { data: buffer, mimetype: 'image/jpeg', name: `${filename}.jpg`, size: buffer.length },
    overrideAccess: true,
  }) as Promise<AnyDoc>
}

async function ensureVideo(payload: any): Promise<AnyDoc> {
  const alt = '空间视频导览样本'
  const existing = await payload.find({
    collection: 'media',
    where: { alt: { equals: alt } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs[0]) return existing.docs[0] as AnyDoc
  const buffer = Buffer.from(VIDEO_FIXTURE, 'base64')
  return payload.create({
    collection: 'media',
    data: { alt },
    file: { data: buffer, mimetype: 'video/mp4', name: 'space-tour-sample.mp4', size: buffer.length },
    overrideAccess: true,
  }) as Promise<AnyDoc>
}

// ---------------------------------------------------------------------------
// 通用 upsert 辅助
// ---------------------------------------------------------------------------
async function findBySlug(
  payload: any,
  collection: string,
  slug: string,
): Promise<AnyDoc | null> {
  const res = await payload.find({
    collection,
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (res.docs[0] as AnyDoc | undefined) ?? null
}

type LocationSpec = {
  slug: string
  name: string
  immutableCode: string
  type: 'city' | 'district' | 'business_area' | 'metro_line' | 'metro_station'
  parentId?: number | null
  centerLatitude?: number
  centerLongitude?: number
  frontendVisible?: boolean
  description?: string
  sortOrder?: number
}

/** location 幂等 upsert。update 时必须回传 type+parent（protectLocation hook 要求）。 */
async function upsertLocation(payload: any, spec: LocationSpec): Promise<AnyDoc> {
  const existing = await findBySlug(payload, 'locations', spec.slug)
  const baseData: Record<string, unknown> = {
    name: spec.name,
    immutableCode: spec.immutableCode,
    type: spec.type,
    parent: spec.parentId ?? null,
    status: 'active',
    frontendVisible: spec.frontendVisible ?? true,
    centerLatitude: spec.centerLatitude,
    centerLongitude: spec.centerLongitude,
    description: spec.description,
    sortOrder: spec.sortOrder ?? 100,
  }
  if (existing) {
    return payload.update({
      collection: 'locations',
      id: existing.id,
      data: baseData,
      overrideAccess: true,
    }) as Promise<AnyDoc>
  }
  return payload.create({
    collection: 'locations',
    data: { ...baseData, slug: spec.slug },
    overrideAccess: true,
  }) as Promise<AnyDoc>
}

async function upsertAmenity(
  payload: any,
  name: string,
  category: 'office-service' | 'space' | 'building' | 'lifestyle',
): Promise<AnyDoc> {
  const res = await payload.find({
    collection: 'amenities',
    where: { name: { equals: name } },
    limit: 1,
    overrideAccess: true,
  })
  if (res.docs[0]) return res.docs[0] as AnyDoc
  return payload.create({
    collection: 'amenities',
    data: { name, category },
    overrideAccess: true,
  }) as Promise<AnyDoc>
}

// ---------------------------------------------------------------------------
// 日期常量（脚本运行于 node，Date 可用）
// ---------------------------------------------------------------------------
const DAY = 86400000
const now = Date.now()
const past90 = new Date(now - 90 * DAY).toISOString()
const past30 = new Date(now - 30 * DAY).toISOString()
const fut365 = new Date(now + 365 * DAY).toISOString()
const fut730 = new Date(now + 730 * DAY).toISOString()

// ---------------------------------------------------------------------------
// 楼盘补全数据
// ---------------------------------------------------------------------------
type BuildingFill = {
  slug: string
  buildingType: 'office_building' | 'business_park' | 'commercial_complex' | 'serviced_office'
  completionDate: string
  totalFloors: number
  propertyCompany: string
  propertyFee: number
  parkingSpaces: number
  registrationCapability: 'supported' | 'conditional' | 'not_supported'
  metroSlug: string
  businessDistrictSlug?: string // 仅 4/5/6 需要新挂
  latitude: number
  longitude: number
  amenityNames: string[]
  developerAndScale: Record<string, unknown>
  verticalTransport: Record<string, unknown>
  buildingServices: Record<string, unknown>
  certifications: Array<Record<string, unknown>>
  seo: { title: string; description: string }
}

const BUILDINGS: BuildingFill[] = [
  {
    slug: 'west-nanjing-premium-center',
    buildingType: 'serviced_office',
    completionDate: '2018-06-01',
    totalFloors: 28,
    propertyCompany: '静安高端物业管理有限公司',
    propertyFee: 38,
    parkingSpaces: 120,
    registrationCapability: 'supported',
    metroSlug: 'metro-nanjing-west-road',
    latitude: 31.229,
    longitude: 121.459,
    amenityNames: ['可即刻入驻', '精装带家具', '共享会议室', '近地铁', '前台服务', '7×24门禁'],
    developerAndScale: { developer: '上海静安商务开发有限公司', grossFloorArea: 42000, typicalFloorArea: 1500, standardFloorHeight: 3.8, netCeilingHeight: 2.8, efficiencyRate: 70 },
    verticalTransport: { passengerElevators: 6, freightElevators: 1, zoningNote: '低区 1-14 层 / 高区 15-28 层' },
    buildingServices: { airConditioning: '中央空调（VAV 变风量）', network: '电信 / 联通 / 移动', powerSupply: '双回路供电', accessControl: '7×24 智能门禁', parkingFee: '1200 元/月', serviceHours: '7×24' },
    certifications: [
      { name: '消防验收合格', certificateNumber: 'XA-2018-0421', validFrom: '2018-06-01', validTo: fut730, publicVisible: true },
      { name: 'LEED 金级认证', certificateNumber: 'LEED-2019-1182', validFrom: '2019-03-01', validTo: fut730, publicVisible: true },
    ],
    seo: { title: '南京西路高端商务中心 · 上海服务式办公', description: '静安南京西路核心商圈高端服务式办公，即租即用，带全套家具与共享会议室。' },
  },
  {
    slug: 'empty-building',
    buildingType: 'office_building',
    completionDate: '2020-09-01',
    totalFloors: 22,
    propertyCompany: '静安置业物业',
    propertyFee: 32,
    parkingSpaces: 80,
    registrationCapability: 'conditional',
    metroSlug: 'metro-nanjing-west-road',
    latitude: 31.228,
    longitude: 121.458,
    amenityNames: ['近地铁', '中央空调', '新风系统'],
    developerAndScale: { developer: '静安置业集团', grossFloorArea: 30000, typicalFloorArea: 1200, standardFloorHeight: 3.9, netCeilingHeight: 2.85, efficiencyRate: 72 },
    verticalTransport: { passengerElevators: 5, freightElevators: 1, zoningNote: '统一管理' },
    buildingServices: { airConditioning: '中央空调', network: '电信 / 联通', powerSupply: '双回路供电', accessControl: '智能门禁', parkingFee: '1000 元/月', serviceHours: '08:00-20:00' },
    certifications: [
      { name: '消防验收合格', certificateNumber: 'XA-2020-0880', validFrom: '2020-09-01', validTo: fut730, publicVisible: true },
    ],
    seo: { title: '静安待租楼盘 · 南京西路', description: '静安南京西路待租楼盘，公开空间暂未释放，欢迎咨询后续供应计划。' },
  },
  {
    slug: 'lujiazui-grade-a-river-view',
    buildingType: 'office_building',
    completionDate: '2015-12-01',
    totalFloors: 52,
    propertyCompany: '陆家嘴物业管理有限公司',
    propertyFee: 35,
    parkingSpaces: 280,
    registrationCapability: 'supported',
    metroSlug: 'metro-lujiazui',
    latitude: 31.239,
    longitude: 121.499,
    amenityNames: ['精装带家具', '近地铁', '中央空调', '新风系统', '智能电梯'],
    developerAndScale: { developer: '陆家嘴股份', grossFloorArea: 88000, typicalFloorArea: 2000, standardFloorHeight: 4.0, netCeilingHeight: 3.0, efficiencyRate: 70 },
    verticalTransport: { passengerElevators: 14, freightElevators: 2, zoningNote: '低区 / 中区 / 高区三区' },
    buildingServices: { airConditioning: '中央空调（VAV 变风量）', network: '电信 / 联通 / 移动', powerSupply: '双回路供电', accessControl: '智能门禁', parkingFee: '1500 元/月', serviceHours: '7×24' },
    certifications: [
      { name: 'LEED 铂金认证', certificateNumber: 'LEED-2016-2204', validFrom: '2016-06-01', validTo: fut730, publicVisible: true },
      { name: '消防验收合格', certificateNumber: 'XA-2015-3310', validFrom: '2015-12-01', validTo: fut730, publicVisible: true },
    ],
    seo: { title: '陆家嘴江景甲级写字楼', description: '陆家嘴核心区甲级写字楼，高区江景视野，适合总部办公与外资企业形象展示。' },
  },
  {
    slug: 'huangpu-bund',
    buildingType: 'office_building',
    completionDate: '2012-10-01',
    totalFloors: 18,
    propertyCompany: '外滩源物业',
    propertyFee: 45,
    parkingSpaces: 60,
    registrationCapability: 'conditional',
    metroSlug: 'metro-nanjing-east-road',
    businessDistrictSlug: 'bund',
    latitude: 31.2397,
    longitude: 121.4905,
    amenityNames: ['近地铁', '中央空调', '智能电梯', '餐饮配套', '银行网点'],
    developerAndScale: { developer: '外滩源投资', grossFloorArea: 24000, typicalFloorArea: 1300, standardFloorHeight: 4.2, netCeilingHeight: 3.1, efficiencyRate: 68 },
    verticalTransport: { passengerElevators: 4, freightElevators: 1, zoningNote: '保留历史电梯厅' },
    buildingServices: { airConditioning: '中央空调', network: '电信 / 联通', powerSupply: '双回路供电', accessControl: '智能门禁', parkingFee: '1800 元/月', serviceHours: '08:00-20:00' },
    certifications: [
      { name: '历史建筑保护认证', certificateNumber: 'HB-2012-0117', validFrom: '2012-10-01', validTo: fut730, publicVisible: true },
      { name: '消防验收合格', certificateNumber: 'XA-2012-7745', validFrom: '2012-10-01', validTo: fut730, publicVisible: true },
    ],
    seo: { title: '外滩源大厦 · 超甲级办公', description: '外滩核心区超甲级办公，历史建筑与现代设施融合，适合金融与高端服务业。' },
  },
  {
    slug: 'xuhui-xujiahui',
    buildingType: 'office_building',
    completionDate: '2016-05-01',
    totalFloors: 36,
    propertyCompany: '徐汇商务物业',
    propertyFee: 30,
    parkingSpaces: 150,
    registrationCapability: 'supported',
    metroSlug: 'metro-xujiahui',
    businessDistrictSlug: 'xujiahui-area',
    latitude: 31.1942,
    longitude: 121.4365,
    amenityNames: ['近地铁', '中央空调', '新风系统', '共享会议室', '餐饮配套'],
    developerAndScale: { developer: '徐汇城开集团', grossFloorArea: 56000, typicalFloorArea: 1600, standardFloorHeight: 3.9, netCeilingHeight: 2.85, efficiencyRate: 71 },
    verticalTransport: { passengerElevators: 8, freightElevators: 1, zoningNote: '低区 / 高区' },
    buildingServices: { airConditioning: '中央空调（VAV 变风量）', network: '电信 / 联通 / 移动', powerSupply: '双回路供电', accessControl: '智能门禁', parkingFee: '1200 元/月', serviceHours: '7×24' },
    certifications: [
      { name: '消防验收合格', certificateNumber: 'XA-2016-5521', validFrom: '2016-05-01', validTo: fut730, publicVisible: true },
      { name: '绿色建筑二星', certificateNumber: 'GBL-2017-0339', validFrom: '2017-01-01', validTo: fut730, publicVisible: true },
    ],
    seo: { title: '徐家汇国际大厦 · 甲级写字楼', description: '徐家汇商圈甲级写字楼，近地铁 1/9/11 号线，商业与交通配套成熟。' },
  },
  {
    slug: 'changning-hongqiao',
    buildingType: 'office_building',
    completionDate: '2017-08-01',
    totalFloors: 30,
    propertyCompany: '虹桥商务物业',
    propertyFee: 28,
    parkingSpaces: 200,
    registrationCapability: 'supported',
    metroSlug: 'metro-hongqiao',
    businessDistrictSlug: 'hongqiao-area',
    latitude: 31.1965,
    longitude: 121.4158,
    amenityNames: ['近地铁', '中央空调', '新风系统', '智能电梯', '银行网点'],
    developerAndScale: { developer: '虹桥商务区投资', grossFloorArea: 62000, typicalFloorArea: 1800, standardFloorHeight: 3.9, netCeilingHeight: 2.9, efficiencyRate: 73 },
    verticalTransport: { passengerElevators: 10, freightElevators: 2, zoningNote: '低区 / 高区' },
    buildingServices: { airConditioning: '中央空调（VAV 变风量）', network: '电信 / 联通 / 移动', powerSupply: '双回路供电', accessControl: '智能门禁', parkingFee: '1000 元/月', serviceHours: '7×24' },
    certifications: [
      { name: '消防验收合格', certificateNumber: 'XA-2017-6610', validFrom: '2017-08-01', validTo: fut730, publicVisible: true },
      { name: '绿色建筑二星', certificateNumber: 'GBL-2018-0418', validFrom: '2018-02-01', validTo: fut730, publicVisible: true },
    ],
    seo: { title: '虹桥国际商务中心 · 甲级写字楼', description: '虹桥商务区核心办公，近虹桥枢纽，高铁机场地铁一站直达。' },
  },
]

// ---------------------------------------------------------------------------
// 房源补全数据
// ---------------------------------------------------------------------------
type ListingFill = {
  slug: string
  decoration: 'rough' | 'simple' | 'furnished' | 'fully_fitted'
  registration: 'available' | 'conditional' | 'unavailable' | 'confirm'
  floor: string
  minLease: number
  paymentTerms: string
  orientation: string
}

const LISTINGS: ListingFill[] = [
  { slug: 'jingan-serviced-office-42-seats', decoration: 'fully_fitted', registration: 'available', floor: '中区 12F', minLease: 3, paymentTerms: '押二付三，按季支付', orientation: '南' },
  { slug: 'media-rich-listing', decoration: 'fully_fitted', registration: 'available', floor: '高区 18F', minLease: 3, paymentTerms: '押二付三，按季支付', orientation: '东南' },
  { slug: 'lujiazui-grade-a-780sqm', decoration: 'simple', registration: 'available', floor: '高区 38F', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '南' },
  { slug: 'huangpu-bund-coworking', decoration: 'fully_fitted', registration: 'available', floor: '低区 3F', minLease: 1, paymentTerms: '押一付三，按月支付', orientation: '东南' },
  { slug: 'pudong-lujiazui-fullfloor', decoration: 'simple', registration: 'available', floor: '高区 45F 整层', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '三面采光' },
  { slug: 'xuhui-xujiahui-traditional', decoration: 'rough', registration: 'conditional', floor: '中区 15F', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '南' },
  { slug: 'changning-hongqiao-serviced', decoration: 'fully_fitted', registration: 'available', floor: '低区 6F', minLease: 3, paymentTerms: '押二付三，按季支付', orientation: '南' },
  { slug: 'jingan-center-fullfloor', decoration: 'simple', registration: 'available', floor: '高区 22F 整层', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '南' },
  { slug: 'jingan-price-on-request-300sqm', decoration: 'furnished', registration: 'available', floor: '中区 10F', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '南' },
  { slug: 'jingan-published-pending-recheck', decoration: 'simple', registration: 'available', floor: '中区 8F', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '南' },
  { slug: 'huangpu-bund-traditional', decoration: 'simple', registration: 'available', floor: '中区 8F', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '南' },
]

// ---------------------------------------------------------------------------
// 为每个楼盘新增多个可租面积（小 / 中 / 大面积段，混合房源类型）
// 每个新房源建恰好 1 条有效 merchant 关系；empty-building 的三个夹具另由
// supplyVisibilityHold 保持为非有效供给，以保留楼盘空状态验收契约。
// ---------------------------------------------------------------------------
type NewListing = {
  buildingSlug: string
  slug: string
  listingType: 'traditional-office' | 'serviced-office' | 'coworking' | 'full-floor'
  area: number
  seats: number
  rent: number
  rentUnit: 'rmb-sqm-day' | 'rmb-month' | 'rmb-seat-month'
  floor: string
  decoration: 'rough' | 'simple' | 'furnished' | 'fully_fitted'
  registration: 'available' | 'conditional' | 'unavailable' | 'confirm'
  minLease: number
  paymentTerms: string
  orientation: string
}

const NEW_LISTINGS: NewListing[] = [
  // west-nanjing-premium-center（服务式办公楼盘）
  { buildingSlug: 'west-nanjing-premium-center', slug: 'wn-80sqm-serviced', listingType: 'serviced-office', area: 80, seats: 6, rent: 2800, rentUnit: 'rmb-seat-month', floor: '低区 5F', decoration: 'fully_fitted', registration: 'available', minLease: 3, paymentTerms: '押二付三，按季支付', orientation: '南' },
  { buildingSlug: 'west-nanjing-premium-center', slug: 'wn-150sqm-serviced', listingType: 'serviced-office', area: 150, seats: 12, rent: 2600, rentUnit: 'rmb-seat-month', floor: '中区 12F', decoration: 'fully_fitted', registration: 'available', minLease: 3, paymentTerms: '押二付三，按季支付', orientation: '东南' },
  { buildingSlug: 'west-nanjing-premium-center', slug: 'wn-220sqm-coworking', listingType: 'coworking', area: 220, seats: 18, rent: 2300, rentUnit: 'rmb-seat-month', floor: '高区 20F', decoration: 'furnished', registration: 'available', minLease: 1, paymentTerms: '押一付三，按月支付', orientation: '南' },
  // empty-building（甲级，静安）
  { buildingSlug: 'empty-building', slug: 'eb-120sqm-traditional', listingType: 'traditional-office', area: 120, seats: 8, rent: 7.5, rentUnit: 'rmb-sqm-day', floor: '低区 4F', decoration: 'simple', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '南' },
  { buildingSlug: 'empty-building', slug: 'eb-380sqm-traditional', listingType: 'traditional-office', area: 380, seats: 25, rent: 8, rentUnit: 'rmb-sqm-day', floor: '中区 10F', decoration: 'simple', registration: 'conditional', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '东南' },
  { buildingSlug: 'empty-building', slug: 'eb-850sqm-fullfloor', listingType: 'full-floor', area: 850, seats: 57, rent: 8.5, rentUnit: 'rmb-sqm-day', floor: '高区 18F 整层', decoration: 'rough', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '三面采光' },
  // lujiazui-grade-a-river-view（甲级江景）
  { buildingSlug: 'lujiazui-grade-a-river-view', slug: 'ljz-160sqm-traditional', listingType: 'traditional-office', area: 160, seats: 11, rent: 10, rentUnit: 'rmb-sqm-day', floor: '低区 8F', decoration: 'simple', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '南' },
  { buildingSlug: 'lujiazui-grade-a-river-view', slug: 'ljz-520sqm-traditional', listingType: 'traditional-office', area: 520, seats: 35, rent: 10.5, rentUnit: 'rmb-sqm-day', floor: '中区 25F', decoration: 'simple', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '东南' },
  { buildingSlug: 'lujiazui-grade-a-river-view', slug: 'ljz-1200sqm-fullfloor', listingType: 'full-floor', area: 1200, seats: 80, rent: 12, rentUnit: 'rmb-sqm-day', floor: '高区 45F 整层 江景', decoration: 'fully_fitted', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '江景三面' },
  // huangpu-bund（超甲格外滩）
  { buildingSlug: 'huangpu-bund', slug: 'hp-100sqm-coworking', listingType: 'coworking', area: 100, seats: 5, rent: 2200, rentUnit: 'rmb-seat-month', floor: '低区 2F', decoration: 'fully_fitted', registration: 'available', minLease: 1, paymentTerms: '押一付三，按月支付', orientation: '东南' },
  { buildingSlug: 'huangpu-bund', slug: 'hp-300sqm-traditional', listingType: 'traditional-office', area: 300, seats: 20, rent: 12, rentUnit: 'rmb-sqm-day', floor: '中区 8F', decoration: 'simple', registration: 'conditional', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '南' },
  { buildingSlug: 'huangpu-bund', slug: 'hp-650sqm-fullfloor', listingType: 'full-floor', area: 650, seats: 43, rent: 13, rentUnit: 'rmb-sqm-day', floor: '高区 15F 整层', decoration: 'simple', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '外滩景观' },
  // xuhui-xujiahui（甲级徐家汇）
  { buildingSlug: 'xuhui-xujiahui', slug: 'xh-110sqm-traditional', listingType: 'traditional-office', area: 110, seats: 7, rent: 6.5, rentUnit: 'rmb-sqm-day', floor: '低区 3F', decoration: 'simple', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '南' },
  { buildingSlug: 'xuhui-xujiahui', slug: 'xh-360sqm-traditional', listingType: 'traditional-office', area: 360, seats: 24, rent: 7, rentUnit: 'rmb-sqm-day', floor: '中区 12F', decoration: 'simple', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '东南' },
  { buildingSlug: 'xuhui-xujiahui', slug: 'xh-900sqm-fullfloor', listingType: 'full-floor', area: 900, seats: 60, rent: 7.5, rentUnit: 'rmb-sqm-day', floor: '高区 30F 整层', decoration: 'rough', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '三面采光' },
  // changning-hongqiao（甲级虹桥）
  { buildingSlug: 'changning-hongqiao', slug: 'cn-90sqm-serviced', listingType: 'serviced-office', area: 90, seats: 6, rent: 2400, rentUnit: 'rmb-seat-month', floor: '低区 4F', decoration: 'fully_fitted', registration: 'available', minLease: 3, paymentTerms: '押二付三，按季支付', orientation: '南' },
  { buildingSlug: 'changning-hongqiao', slug: 'cn-280sqm-traditional', listingType: 'traditional-office', area: 280, seats: 19, rent: 6, rentUnit: 'rmb-sqm-day', floor: '中区 10F', decoration: 'simple', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '东南' },
  { buildingSlug: 'changning-hongqiao', slug: 'cn-720sqm-fullfloor', listingType: 'full-floor', area: 720, seats: 48, rent: 6.5, rentUnit: 'rmb-sqm-day', floor: '高区 25F 整层', decoration: 'simple', registration: 'available', minLease: 12, paymentTerms: '押三付一，按月支付', orientation: '三面采光' },
]

const TYPE_LABEL: Record<string, string> = {
  'traditional-office': '传统办公',
  'serviced-office': '服务式办公',
  'coworking': '共享办公',
  'full-floor': '整层办公',
}

/** 按 rentUnit 反推结构化 price；rent=null（价格面议）返回 null。 */
function priceFor(
  rent: number | null | undefined,
  rentUnit: string | null | undefined,
): { amount: number; currency: string; period: string; unit: string } | null {
  if (rent == null) return null
  const amount = Number(rent)
  if (rentUnit === 'rmb-sqm-day') return { amount, currency: 'CNY', period: 'day', unit: 'sqm' }
  if (rentUnit === 'rmb-month') return { amount, currency: 'CNY', period: 'month', unit: 'suite' }
  if (rentUnit === 'rmb-seat-month') return { amount, currency: 'CNY', period: 'month', unit: 'seat' }
  return null
}

function spaceDetailsFor(
  type: string,
  seats: number | null,
  orientation: string,
  decoration: string,
): Record<string, unknown> {
  const s = seats ?? 10
  const furnitureStatus = decoration === 'rough' ? 'none' : type === 'traditional-office' || type === 'full-floor' ? 'optional' : 'included'
  const base = { orientation, netCeilingHeight: type === 'full-floor' ? 2.9 : 2.8, isDivisible: type === 'traditional-office', furnitureStatus }
  switch (type) {
    case 'serviced-office':
      return { ...base, efficiencyRate: 72, seatMin: Math.max(1, s - 5), seatMax: s + 10 }
    case 'coworking':
      return { ...base, efficiencyRate: 75, seatMin: 1, seatMax: s + 5, isDivisible: false }
    case 'full-floor':
      return { ...base, efficiencyRate: 70, seatMin: s, seatMax: s + 20, isDivisible: false, netCeilingHeight: 2.9 }
    default: // traditional-office
      return { ...base, efficiencyRate: 68, seatMin: Math.max(1, s - 5), seatMax: s + 8 }
  }
}

function costTermsFor(type: string): Record<string, unknown> {
  switch (type) {
    case 'serviced-office':
      return { depositMonths: 2, propertyFeeInclusion: 'included', propertyFeeAmount: null, invoiceStatus: 'extra-tax', otherFixedCosts: '水电按表计费；网络 100 元/月/工位' }
    case 'coworking':
      return { depositMonths: 1, propertyFeeInclusion: 'included', propertyFeeAmount: null, invoiceStatus: 'included', otherFixedCosts: '租金含高速网络、水电与公区清洁' }
    case 'full-floor':
      return { depositMonths: 3, propertyFeeInclusion: 'excluded', propertyFeeAmount: 35, invoiceStatus: 'extra-tax', otherFixedCosts: '水电按表计费；空调延时费另计' }
    default: // traditional-office
      return { depositMonths: 3, propertyFeeInclusion: 'excluded', propertyFeeAmount: 35, invoiceStatus: 'extra-tax', otherFixedCosts: '水电按表计费' }
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  console.log('--- seed-test-data 开始 ---')
  const payload = await getPayload({ config })
  console.log('Payload 已初始化')

  // ===== 1. Locations：补 center 坐标 + 新增 business_area / metro_line / metro_station =====
  console.log('\n[1/7] 补全 locations...')
  const shanghai = await findBySlug(payload, 'locations', 'shanghai')
  const jingan = await findBySlug(payload, 'locations', 'jingan')
  const pudong = await findBySlug(payload, 'locations', 'pudong')
  const huangpu = await findBySlug(payload, 'locations', 'huangpu')
  const xuhui = await findBySlug(payload, 'locations', 'xuhui')
  const changning = await findBySlug(payload, 'locations', 'changning')

  // 既有节点补 center 坐标（回传 type+parent 满足 hook）
  await upsertLocation(payload, { slug: 'shanghai', name: '上海', immutableCode: 'SH', type: 'city', centerLatitude: 31.2304, centerLongitude: 121.4737, frontendVisible: true, description: '中高端商务办公租赁核心城市。', sortOrder: 1 })
  await upsertLocation(payload, { slug: 'jingan', name: '静安区', immutableCode: 'SH-JINGAN', type: 'district', parentId: shanghai?.id, centerLatitude: 31.2285, centerLongitude: 121.4483, description: '南京西路、苏河湾等高端商务办公聚集区。', sortOrder: 10 })
  await upsertLocation(payload, { slug: 'pudong', name: '浦东新区', immutableCode: 'SH-PUDONG', type: 'district', parentId: shanghai?.id, centerLatitude: 31.2215, centerLongitude: 121.5443, description: '陆家嘴、前滩等总部型企业办公聚集区。', sortOrder: 20 })
  await upsertLocation(payload, { slug: 'huangpu', name: '黄浦', immutableCode: 'SH-HUANGPU', type: 'district', parentId: shanghai?.id, centerLatitude: 31.231, centerLongitude: 121.469, description: '外滩、人民广场等核心商务区。', sortOrder: 10 })
  await upsertLocation(payload, { slug: 'xuhui', name: '徐汇', immutableCode: 'SH-XUHUI', type: 'district', parentId: shanghai?.id, centerLatitude: 31.1844, centerLongitude: 121.4365, description: '徐家汇、漕河泾等商务办公聚集区。', sortOrder: 10 })
  await upsertLocation(payload, { slug: 'changning', name: '长宁', immutableCode: 'SH-CHANGNING', type: 'district', parentId: shanghai?.id, centerLatitude: 31.22, centerLongitude: 121.424, description: '虹桥、古北等国际化商务办公区域。', sortOrder: 10 })
  await upsertLocation(payload, { slug: 'nanjing-west-road', name: '南京西路', immutableCode: 'SH-JINGAN-NJW', type: 'business_area', parentId: jingan?.id, centerLatitude: 31.229, centerLongitude: 121.459, description: '上海高端商务、零售与企业总部办公核心商圈。', sortOrder: 11 })
  await upsertLocation(payload, { slug: 'lujiazui', name: '陆家嘴', immutableCode: 'SH-PUDONG-LJZ', type: 'business_area', parentId: pudong?.id, centerLatitude: 31.239, centerLongitude: 121.499, description: '金融、专业服务与跨国企业总部办公核心区域。', sortOrder: 21 })

  // 新增 3 个 business_area（挂到对应 district）
  await upsertLocation(payload, { slug: 'bund', name: '外滩', immutableCode: 'SH-HUANGPU-BUND', type: 'business_area', parentId: huangpu?.id, centerLatitude: 31.2397, centerLongitude: 121.4905, description: '外滩金融集聚带，历史建筑与现代办公融合。', sortOrder: 11 })
  await upsertLocation(payload, { slug: 'xujiahui-area', name: '徐家汇', immutableCode: 'SH-XUHUI-XJH', type: 'business_area', parentId: xuhui?.id, centerLatitude: 31.1942, centerLongitude: 121.4365, description: '徐家汇商圈，商业与交通配套成熟。', sortOrder: 11 })
  await upsertLocation(payload, { slug: 'hongqiao-area', name: '虹桥', immutableCode: 'SH-CHANGNING-HQ', type: 'business_area', parentId: changning?.id, centerLatitude: 31.1965, centerLongitude: 121.4158, description: '虹桥商务区核心，近虹桥综合交通枢纽。', sortOrder: 11 })

  // 新增 2 条地铁线路（挂到 city）
  await upsertLocation(payload, { slug: 'metro-line-2', name: '上海地铁 2 号线', immutableCode: 'SH-METRO-L2', type: 'metro_line', parentId: shanghai?.id, sortOrder: 30 })
  await upsertLocation(payload, { slug: 'metro-line-1', name: '上海地铁 1 号线', immutableCode: 'SH-METRO-L1', type: 'metro_line', parentId: shanghai?.id, sortOrder: 31 })

  const line2 = await findBySlug(payload, 'locations', 'metro-line-2')
  const line1 = await findBySlug(payload, 'locations', 'metro-line-1')

  // 新增 5 个地铁站（挂到对应 metro_line）
  await upsertLocation(payload, { slug: 'metro-nanjing-west-road', name: '南京西路站', immutableCode: 'SH-M2-NJW', type: 'metro_station', parentId: line2?.id, centerLatitude: 31.229, centerLongitude: 121.459, sortOrder: 40 })
  await upsertLocation(payload, { slug: 'metro-nanjing-east-road', name: '南京东路站', immutableCode: 'SH-M2-NJE', type: 'metro_station', parentId: line2?.id, centerLatitude: 31.236, centerLongitude: 121.485, sortOrder: 41 })
  await upsertLocation(payload, { slug: 'metro-lujiazui', name: '陆家嘴站', immutableCode: 'SH-M2-LJZ', type: 'metro_station', parentId: line2?.id, centerLatitude: 31.239, centerLongitude: 121.499, sortOrder: 42 })
  await upsertLocation(payload, { slug: 'metro-xujiahui', name: '徐家汇站', immutableCode: 'SH-M1-XJH', type: 'metro_station', parentId: line1?.id, centerLatitude: 31.194, centerLongitude: 121.436, sortOrder: 43 })
  await upsertLocation(payload, { slug: 'metro-hongqiao', name: '虹桥 2 号航站楼站', immutableCode: 'SH-M2-HQ2T', type: 'metro_station', parentId: line2?.id, centerLatitude: 31.1965, centerLongitude: 121.4158, sortOrder: 44 })
  console.log('locations 补全完成（含 3 business_area / 2 metro_line / 5 metro_station）')

  // ===== 2. Amenities：新增 10 个 =====
  console.log('\n[2/7] 补全 amenities...')
  const amenityNames = [
    '前台服务', '7×24门禁', '打印文印', // office-service
    '独立电表', '茶水吧', // space
    '中央空调', '新风系统', '智能电梯', // building
    '餐饮配套', '银行网点', // lifestyle
  ]
  const amenityMap: Record<string, AnyDoc> = {}
  for (const name of amenityNames) {
    const category = name === '前台服务' || name === '7×24门禁' || name === '打印文印'
      ? 'office-service'
      : name === '独立电表' || name === '茶水吧'
        ? 'space'
        : name === '餐饮配套' || name === '银行网点'
          ? 'lifestyle'
          : 'building'
    amenityMap[name] = await upsertAmenity(payload, name, category as any)
  }
  // 把既有 4 个也收入 map（建筑 amenities 引用需要）
  for (const name of ['可即刻入驻', '精装带家具', '共享会议室', '近地铁']) {
    amenityMap[name] = await upsertAmenity(payload, name, name === '精装带家具' ? 'space' : name === '共享会议室' || name === '可即刻入驻' ? 'office-service' : 'lifestyle')
  }
  console.log(`amenities 共 ${Object.keys(amenityMap).length} 个`)

  // ===== 3. Media：6 封面 + 6 类目图 + 1 视频 =====
  console.log(`\n[3/7] 上传媒体（${SOURCE_LABEL}）...`)
  const coverSeeds: Record<string, { alt: string; seed: string }> = {
    'west-nanjing-premium-center': { alt: '南京西路高端商务中心外景', seed: 'shanghai-nanjing-west-road-tower' },
    'empty-building': { alt: '静安待租楼盘外景', seed: 'shanghai-jingan-office-tower' },
    'lujiazui-grade-a-river-view': { alt: '陆家嘴江景甲级写字楼外景', seed: 'shanghai-lujiazui-skyscraper-river' },
    'huangpu-bund': { alt: '外滩源大厦历史建筑外景', seed: 'shanghai-bund-historic-architecture' },
    'xuhui-xujiahui': { alt: '徐家汇国际大厦外景', seed: 'shanghai-xujiahui-office-tower' },
    'changning-hongqiao': { alt: '虹桥国际商务中心外景', seed: 'shanghai-hongqiao-business-center' },
  }
  const covers: Record<string, AnyDoc> = {}
  for (const [slug, info] of Object.entries(coverSeeds)) {
    covers[slug] = await ensureImage(payload, info.alt, info.seed, COVER_W, COVER_H, `cover-${slug}`)
  }
  const lobbyImg = await ensureImage(payload, '写字楼大堂接待区', 'premium-office-lobby-reception', GALLERY_W, GALLERY_H, 'lobby-reception')
  const commonAreaImg = await ensureImage(payload, '公共休息区', 'coworking-lounge-natural-light', GALLERY_W, GALLERY_H, 'common-lounge')
  const facilitiesImg = await ensureImage(payload, '楼宇机电设施', 'building-mep-facilities', GALLERY_W, GALLERY_H, 'building-facilities')
  const workspaceImg = await ensureImage(payload, '开放办公区', 'modern-open-plan-workspace', GALLERY_W, GALLERY_H, 'workspace-open')
  const meetingRoomImg = await ensureImage(payload, '精装会议室', 'premium-meeting-room-city-view', GALLERY_W, GALLERY_H, 'meeting-room')
  const floorPlanImg = await ensureImage(payload, '办公平面示意图', 'office-floor-plan-schematic', GALLERY_W, GALLERY_H, 'floor-plan')
  const videoMedia = await ensureVideo(payload)
  console.log('媒体上传完成')

  // ===== 4. Buildings：补全结构字段 + 媒体 + 认证 + metro + businessDistrict =====
  console.log('\n[4/7] 补全 buildings...')
  let buildingCount = 0
  for (const b of BUILDINGS) {
    const doc = await findBySlug(payload, 'buildings', b.slug)
    if (!doc) {
      payload.logger.warn(`未找到楼盘 ${b.slug}，跳过`)
      continue
    }
    const metro = await findBySlug(payload, 'locations', b.metroSlug)
    const businessDistrict = b.businessDistrictSlug ? await findBySlug(payload, 'locations', b.businessDistrictSlug) : null
    const amenityIds = b.amenityNames.map((n) => amenityMap[n]?.id).filter(Boolean)
    const cover = covers[b.slug]
    const gallery = [cover, lobbyImg, commonAreaImg].map((m) => ({ image: m.id }))
    const mediaItems = [
      { resource: cover.id, kind: 'image', category: 'exterior', alt: '楼宇外观' },
      { resource: lobbyImg.id, kind: 'image', category: 'lobby', alt: '大堂接待区' },
      { resource: commonAreaImg.id, kind: 'image', category: 'common-area', alt: '公共区域' },
      { resource: facilitiesImg.id, kind: 'image', category: 'facilities', alt: '楼宇设施' },
    ]
    await payload.update({
      collection: 'buildings',
      id: doc.id,
      data: {
        buildingType: b.buildingType,
        completionDate: b.completionDate,
        totalFloors: b.totalFloors,
        propertyCompany: b.propertyCompany,
        propertyFee: b.propertyFee,
        parkingSpaces: b.parkingSpaces,
        registrationCapability: b.registrationCapability,
        nearestMetro: metro?.id ?? null,
        businessDistrict: businessDistrict?.id ?? null,
        latitude: b.latitude,
        longitude: b.longitude,
        amenities: amenityIds,
        developerAndScale: b.developerAndScale,
        verticalTransport: b.verticalTransport,
        buildingServices: b.buildingServices,
        certifications: b.certifications,
        verificationStatus: 'verified',
        verificationInfo: { verifiedAt: past90, priceVerifiedAt: past30 },
        coverImage: cover.id,
        gallery,
        mediaItems,
        seo: b.seo,
      } as any,
      overrideAccess: true,
    })
    buildingCount++
    payload.logger.info(`楼盘已补全: ${b.slug}`)
  }
  console.log(`buildings 补全 ${buildingCount} 个`)

  // ===== 5. Listings：补全 price + 结构字段 + 媒体 =====
  console.log('\n[5/7] 补全 listings...')
  const brokersRes = await payload.find({ collection: 'brokers', limit: 20, overrideAccess: true })
  const brokers = brokersRes.docs as AnyDoc[]
  if (brokers.length === 0) payload.logger.warn('未找到 brokers，contactBroker 将留空')

  const listingGallery = [workspaceImg, meetingRoomImg, commonAreaImg].map((m) => ({ image: m.id }))
  const listingMediaItems = [
    { resource: workspaceImg.id, kind: 'image', category: 'workspace', alt: '开放办公区' },
    { resource: meetingRoomImg.id, kind: 'image', category: 'meeting-room', alt: '精装会议室' },
    { resource: commonAreaImg.id, kind: 'image', category: 'common-area', alt: '公共休息区' },
    { resource: floorPlanImg.id, kind: 'floor-plan', category: 'workspace', alt: '办公平面示意图', isSchematic: true },
    { resource: videoMedia.id, kind: 'video', category: 'common-area', alt: '空间视频导览样本' },
  ]

  let listingCount = 0
  for (let i = 0; i < LISTINGS.length; i++) {
    const f = LISTINGS[i]
    const doc = await findBySlug(payload, 'listings', f.slug)
    if (!doc) {
      payload.logger.warn(`未找到房源 ${f.slug}，跳过`)
      continue
    }
    // 取完整房源读 rent/rentUnit/listingType/seats/building
    const full = await payload.findByID({ collection: 'listings', id: doc.id, depth: 1, overrideAccess: true }) as any
    const price = priceFor(full.rent, full.rentUnit)
    const buildingId = typeof full.building === 'object' ? full.building?.id : full.building
    const building = buildingId ? await payload.findByID({ collection: 'buildings', id: buildingId, depth: 0, overrideAccess: true }) as any : null
    const coverId = building?.coverImage ?? workspaceImg.id

    const data: Record<string, unknown> = {
      decorationStatus: f.decoration,
      registrationStatus: f.registration,
      floor: f.floor,
      minimumLeaseMonths: f.minLease,
      paymentTerms: f.paymentTerms,
      spaceDetails: spaceDetailsFor(full.listingType, full.seats, f.orientation, f.decoration),
      costTerms: costTermsFor(full.listingType),
      verificationInfo: { verifiedAt: past90, priceVerifiedAt: price ? past30 : null },
      coverImage: coverId,
      gallery: listingGallery,
      mediaItems: listingMediaItems,
    }
    if (price) data.price = price
    if (brokers.length > 0) data.contactBroker = brokers[i % brokers.length].id

    await payload.update({ collection: 'listings', id: doc.id, data: data as any, overrideAccess: true })
    listingCount++
    payload.logger.info(`房源已补全: ${f.slug}`)
  }
  console.log(`listings 补全 ${listingCount} 个`)

  // ===== 5b. 为每个楼盘新增多个可租面积房源 + merchant 字段 =====
  console.log('\n[5b] 为每个楼盘新增可租面积房源 + merchant 字段...')

  // OPT-034 起精筛只看 listings.merchant，不再有关系表可查——改为沿用现有
  // 已设置 merchant 的房源（确保准入与服务城市覆盖一致）
  const sampleListingRes = await payload.find({ collection: 'listings', where: { merchant: { exists: true } }, limit: 1, depth: 0, sort: 'id', overrideAccess: true })
  const sampleListing = sampleListingRes.docs[0] as any
  const sharedMerchantId = sampleListing ? sampleListing.merchant : undefined
  if (!sharedMerchantId) payload.logger.warn('未找到已设置 merchant 的现有房源，新房源将无法建立有效供给')

  // 楼盘 slug -> {id, name, coverImage} 缓存
  const buildingCache: Record<string, { id: number; name: string; coverImage: number | null }> = {}
  for (const b of BUILDINGS) {
    const doc = await findBySlug(payload, 'buildings', b.slug)
    if (doc) {
      const full = await payload.findByID({ collection: 'buildings', id: doc.id, depth: 0, overrideAccess: true }) as any
      buildingCache[b.slug] = { id: doc.id, name: full?.name ?? b.slug, coverImage: full?.coverImage ?? null }
    }
  }

  let newCount = 0
  for (let i = 0; i < NEW_LISTINGS.length; i++) {
    const n = applySeedTestListingVisibilityPolicy(NEW_LISTINGS[i])
    const b = buildingCache[n.buildingSlug]
    if (!b) {
      payload.logger.warn(`未找到楼盘 ${n.buildingSlug}，跳过 ${n.slug}`)
      continue
    }
    const price = priceFor(n.rent, n.rentUnit)
    const data: Record<string, unknown> = {
      title: `${b.name} · ${n.area}㎡ ${TYPE_LABEL[n.listingType]}`,
      listingType: n.listingType,
      building: b.id,
      businessType: 'lease',
      decorationStatus: n.decoration,
      registrationStatus: n.registration,
      rent: n.rent,
      rentUnit: n.rentUnit,
      area: n.area,
      seats: n.seats,
      floor: n.floor,
      minimumLeaseMonths: n.minLease,
      paymentTerms: n.paymentTerms,
      spaceDetails: spaceDetailsFor(n.listingType, n.seats, n.orientation, n.decoration),
      costTerms: costTermsFor(n.listingType),
      verificationInfo: { verifiedAt: past90, priceVerifiedAt: price ? past30 : null },
      coverImage: b.coverImage ?? workspaceImg.id,
      gallery: listingGallery,
      mediaItems: listingMediaItems,
      reviewStatus: 'approved',
      publicationStatus: 'published',
      supplyVisibilityHold: n.supplyVisibilityHold,
    }
    if (price) data.price = price
    if (brokers.length > 0) data.contactBroker = brokers[(i + listingCount) % brokers.length].id
    // OPT-034 起精筛只看 listings.merchant 是否有值（§8 NO_SUPPLY_MERCHANT），
    // 不写这个字段新房源就进不了有效供给。
    if (sharedMerchantId) data.merchant = sharedMerchantId

    // 幂等：按 slug 查，存在则 update，不存在则 create
    const existing = await findBySlug(payload, 'listings', n.slug)
    if (existing) {
      await payload.update({ collection: 'listings', id: existing.id, data: data as any, overrideAccess: true })
    } else {
      await payload.create({ collection: 'listings', data: { ...data, slug: n.slug } as any, overrideAccess: true })
      payload.logger.info(`新房源已创建: ${n.slug}`)
    }
    newCount++
  }
  console.log(`新增可租面积房源 ${newCount} 个（含 merchant 字段）`)

  // ===== 6. AdvisorServiceHours global =====
  console.log('\n[6/7] 配置平台顾问服务时间 global...')
  await payload.updateGlobal({
    slug: 'advisor-service-hours',
    data: {
      timezone: 'Asia/Shanghai',
      weeklyHours: [
        { day: '1', start: '09:00', end: '18:00' },
        { day: '2', start: '09:00', end: '18:00' },
        { day: '3', start: '09:00', end: '18:00' },
        { day: '4', start: '09:00', end: '18:00' },
        { day: '5', start: '09:00', end: '18:00' },
        { day: '6', start: '10:00', end: '16:00' },
      ],
      holidays: [{ date: '2026-10-01', ranges: [] }],
      openMessage: '当前服务中，欢迎咨询',
      closedMessage: '当前非服务时段，工作日 09:00-18:00 恢复服务',
    } as any,
    overrideAccess: true,
  })
  console.log('advisor-service-hours 已配置（周一至五 09-18 / 周六 10-16 / 国庆休）')

  // ===== 7. 清理 3 张孤儿 dummy 图 =====
  console.log('\n[7/7] 清理占位 dummy 媒体...')
  for (const alt of ['dummy1', 'dummy2', 'dummy3']) {
    const res = await payload.find({ collection: 'media', where: { alt: { equals: alt } }, limit: 1, overrideAccess: true })
    if (res.docs[0]) {
      await payload.delete({ collection: 'media', id: res.docs[0].id, overrideAccess: true })
      payload.logger.info(`已删除 dummy 媒体: ${alt}`)
    }
  }

  console.log('\n--- seed-test-data 完成 ---')
  await payload.db?.destroy?.()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
