/**
 * 前台测试 fixtures：Payload 文档样本
 *
 * 设计依据：FRONTEND_AGENT.md §13、specs/frontend-mvp/design.md §15
 *
 * 用途：
 *   - 给 mapper 单测提供已知输入；
 *   - 给 URL 解析、询盘 schema 提供边界值；
 *   - 覆盖三种租金单位、四种办公类型、各种失效供给场景。
 *
 * 不变量：
 *   - 固定 asOf 为 2026-07-25T00:00:00Z（上海 08:00）；
 *   - 所有时间字段以 UTC ISO 字符串存储；
 *   - 不包含真实个人信息（手机号、邮箱、姓名）；
 *   - 不向浏览器暴露审核、举报、商户资质、内部电话等字段；
 *   - 模拟 Payload depth≥1 已填充关系的文档形态。
 *
 * 命名约定：
 *   - LISTING_DOCS：键为 'case-<场景>'，值为 PopulatedListing 形态文档
 *   - BUILDING_DOCS：键为 'case-<场景>'，值为 PopulatedBuilding 形态文档
 */

import type { Building, Listing, Location, Media, Amenity } from '@/payload-types'

/** 固定 asOf 锚点：2026-07-25 00:00:00 UTC = 上海 08:00 */
export const AS_OF_ISO = '2026-07-25T00:00:00.000Z'

/** 上海时区标识 */
export const TIMEZONE = 'Asia/Shanghai'

/** 测试用媒体文档：alt 缺失时由调用方提供 fallback */
function makeMedia(overrides: Partial<Media> & { id: number }): Media {
  return {
    alt: '',
    updatedAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    url: `/media/test-${overrides.id}.jpg`,
    filename: `test-${overrides.id}.jpg`,
    mimeType: 'image/jpeg',
    width: 1280,
    height: 960,
    ...overrides,
  }
}

/** 测试用区域文档 */
function makeLocation(overrides: Partial<Location> & { id: number; type: Location['type'] }): Location {
  return {
    name: `测试区域${overrides.id}`,
    immutableCode: `TEST-${overrides.id}`,
    slug: `test-district-${overrides.id}`,
    status: 'active',
    updatedAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 测试用配套文档 */
function makeAmenity(overrides: Partial<Amenity> & { id: number }): Amenity {
  return {
    name: `配套${overrides.id}`,
    updatedAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Location fixtures
// ---------------------------------------------------------------------------

export const DISTRICT_JINGAN: Location = makeLocation({
  id: 1,
  name: '静安',
  slug: 'jingan',
  type: 'district',
  parent: 100,
})

export const DISTRICT_PUDONG: Location = makeLocation({
  id: 2,
  name: '浦东',
  slug: 'pudong',
  type: 'district',
  parent: 100,
})

export const CITY_SHANGHAI: Location = makeLocation({
  id: 100,
  name: '上海',
  slug: 'shanghai',
  type: 'city',
  immutableCode: 'CITY-SH',
})

// ---------------------------------------------------------------------------
// Media fixtures
// ---------------------------------------------------------------------------

export const MEDIA_COVER_A: Media = makeMedia({
  id: 1001,
  alt: '静安中心封面图',
  url: '/media/cover-jingan-center.jpg',
})

export const MEDIA_COVER_B: Media = makeMedia({
  id: 1002,
  alt: '浦东大厦封面图',
  url: '/media/cover-pudong-tower.jpg',
})

export const MEDIA_GALLERY_1: Media = makeMedia({
  id: 2001,
  alt: '大厅',
  url: '/media/lobby.jpg',
})

export const MEDIA_GALLERY_2: Media = makeMedia({
  id: 2002,
  alt: '会议室',
  url: '/media/meeting-room.jpg',
})

/** 缺失 url 的媒体：用于测试 mapper 安全回退 */
export const MEDIA_BROKEN: Media = makeMedia({
  id: 3001,
  alt: '损坏图片',
  url: undefined,
})

// ---------------------------------------------------------------------------
// Amenity fixtures
// ---------------------------------------------------------------------------

export const AMENITY_PARKING: Amenity = makeAmenity({
  id: 501,
  name: '停车场',
  category: 'building',
})

export const AMENITY_CAFE: Amenity = makeAmenity({
  id: 502,
  name: '咖啡厅',
  category: 'lifestyle',
})

// ---------------------------------------------------------------------------
// Building fixtures
// ---------------------------------------------------------------------------

/** 完整填充的甲级写字楼 */
export const BUILDING_JINGAN_CENTER: Building = {
  id: 200,
  name: '静安中心',
  slug: 'jingan-center',
  status: 'published',
  operationalStatus: 'active',
  buildingType: 'office_building',
  grade: 'grade-a',
  verificationStatus: 'verified',
  city: CITY_SHANGHAI,
  district: DISTRICT_JINGAN,
  businessDistrict: makeLocation({
    id: 11,
    name: '南京西路商圈',
    slug: 'nanjing-west',
    type: 'business_area',
    parent: 1,
  }),
  address: '上海市静安区南京西路 1788 号',
  nearestMetro: makeLocation({
    id: 21,
    name: '静安寺站',
    slug: 'jingan-temple',
    type: 'metro_station',
    parent: 31,
  }),
  coverImage: MEDIA_COVER_A,
  gallery: [
    { image: MEDIA_GALLERY_1, id: 'g1' },
    { image: MEDIA_GALLERY_2, id: 'g2' },
  ],
  amenities: [AMENITY_PARKING, AMENITY_CAFE],
  summary: '南京西路核心地段甲级写字楼',
  description: null,
  updatedAt: '2026-07-10T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
}

/** 仅基础字段的楼盘：district 为 id 而非对象（depth=0 模拟） */
export const BUILDING_PUDONG_FLAT: Building = {
  id: 201,
  name: '浦东大厦',
  slug: 'pudong-tower',
  status: 'published',
  operationalStatus: 'active',
  buildingType: 'office_building',
  grade: 'grade-a',
  city: 100, // depth=0 时的 id 形式
  district: 2, // depth=0 时的 id 形式
  address: '上海市浦东新区世纪大道 100 号',
  coverImage: 1002, // depth=0 时的 id 形式
  gallery: null,
  amenities: null,
  summary: '',
  description: null,
  updatedAt: '2026-07-10T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
}

/** 已停用楼盘：不应在公开页面展示 */
export const BUILDING_DISABLED: Building = {
  id: 202,
  name: '已停用楼盘',
  slug: 'disabled-building',
  status: 'archived',
  operationalStatus: 'disabled',
  city: CITY_SHANGHAI,
  district: DISTRICT_PUDONG,
  address: '不应出现',
  gallery: null,
  amenities: null,
  summary: '',
  description: null,
  updatedAt: '2026-07-10T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
}

// ---------------------------------------------------------------------------
// Listing fixtures
// ---------------------------------------------------------------------------

/** 标准月租房源：传统办公 + 元/月 */
export const LISTING_MONTHLY_STANDARD: Listing = {
  id: 1001,
  title: '静安中心 100㎡ 精装办公室',
  slug: 'jingan-center-100-monthly',
  status: 'available',
  listingType: 'traditional-office',
  building: BUILDING_JINGAN_CENTER,
  rent: 25000,
  rentUnit: 'rmb-month',
  area: 100,
  seats: 12,
  availableFrom: '2026-08-01',
  isFeatured: true,
  coverImage: MEDIA_COVER_A,
  highlights: [
    { text: '落地窗江景', id: 'h1' },
    { text: '精装修交付', id: 'h2' },
    { text: '24h 空调', id: 'h3' },
    { text: '第四条亮点应被截断', id: 'h4' },
  ],
  description: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
}

/** 按平米/天计价的房源：服务式办公 */
export const LISTING_DAILY_PER_SQM: Listing = {
  id: 1002,
  title: '浦东 80㎡ 服务式办公',
  slug: 'pudong-80-serviced-daily',
  status: 'available',
  listingType: 'serviced-office',
  building: BUILDING_PUDONG_FLAT,
  rent: 8.5,
  rentUnit: 'rmb-sqm-day',
  area: 80,
  seats: 8,
  availableFrom: null,
  isFeatured: false,
  coverImage: null,
  highlights: [],
  description: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
}

/** 按工位/月计价：共享办公 */
export const LISTING_SEAT_PER_MONTH: Listing = {
  id: 1003,
  title: '人民广场共享工位',
  slug: 'people-square-coworking-seats',
  status: 'available',
  listingType: 'coworking',
  building: BUILDING_JINGAN_CENTER,
  rent: 2800,
  rentUnit: 'rmb-seat-month',
  area: null,
  seats: 30,
  availableFrom: '2026-09-01',
  isFeatured: false,
  coverImage: MEDIA_COVER_A,
  highlights: [{ text: '含咖啡茶水', id: 'h1' }],
  description: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
}

/** 整层办公：极值价格（大数值） */
export const LISTING_FULL_FLOOR_LARGE: Listing = {
  id: 1004,
  title: '陆家嘴整层 1200㎡',
  slug: 'lujiazui-full-floor-1200',
  status: 'available',
  listingType: 'full-floor',
  building: BUILDING_JINGAN_CENTER,
  rent: 450000,
  rentUnit: 'rmb-month',
  area: 1200,
  seats: 120,
  availableFrom: '2026-10-01',
  isFeatured: true,
  coverImage: MEDIA_COVER_B,
  highlights: [
    { text: '整层独立使用', id: 'h1' },
    { text: '可分割租赁', id: 'h2' },
  ],
  description: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
}

// ---------------------------------------------------------------------------
// 失效供给 fixtures
// ---------------------------------------------------------------------------

/** 草稿状态房源：未上线，不应出现在公开列表 */
export const LISTING_DRAFT: Listing = {
  id: 2001,
  title: '草稿房源不应被公开',
  slug: 'draft-listing',
  status: 'archived',
  listingType: 'traditional-office',
  building: BUILDING_JINGAN_CENTER,
  rent: 8000,
  rentUnit: 'rmb-month',
  area: 60,
  isFeatured: false,
  highlights: [],
  description: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
}

/** 已出租房源：仍可看详情但不在列表 */
export const LISTING_LEASED: Listing = {
  id: 2002,
  title: '已出租办公室',
  slug: 'leased-office',
  status: 'leased',
  listingType: 'traditional-office',
  building: BUILDING_JINGAN_CENTER,
  rent: 18000,
  rentUnit: 'rmb-month',
  area: 90,
  isFeatured: false,
  highlights: [],
  description: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
}

/** 价格非法（负数）：mapper 应返回 price=null */
export const LISTING_NEGATIVE_PRICE: Listing = {
  id: 2003,
  title: '非法价格房源',
  slug: 'negative-price',
  status: 'available',
  listingType: 'traditional-office',
  building: BUILDING_JINGAN_CENTER,
  rent: -100,
  rentUnit: 'rmb-month',
  area: 50,
  isFeatured: false,
  highlights: [],
  description: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
}

/** 价格单位缺失：mapper 应返回 price=null */
export const LISTING_MISSING_UNIT: Listing = {
  id: 2004,
  title: '缺少价格单位房源',
  slug: 'missing-unit',
  status: 'available',
  listingType: 'traditional-office',
  building: BUILDING_JINGAN_CENTER,
  rent: 12000,
  rentUnit: null,
  area: 60,
  isFeatured: false,
  highlights: [],
  description: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
}

/** 逻辑删除房源：deletedAt 非空 */
export const LISTING_DELETED: Listing = {
  id: 2005,
  title: '逻辑删除房源',
  slug: 'deleted-listing',
  status: 'archived',
  listingType: 'traditional-office',
  building: BUILDING_JINGAN_CENTER,
  rent: 9000,
  rentUnit: 'rmb-month',
  area: 70,
  isFeatured: false,
  highlights: [],
  description: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
  deletedAt: '2026-07-20T00:00:00.000Z',
}

/** 极长标题：测试 UI 容错 */
export const LISTING_LONG_TITLE: Listing = {
  id: 2006,
  title:
    '南京西路核心商圈甲级写字楼精装交付带家具可直接入驻静安寺地铁上盖落地窗江景整层可分割租赁第四季度可入住含物业管理费',
  slug: 'long-title',
  status: 'available',
  listingType: 'traditional-office',
  building: BUILDING_JINGAN_CENTER,
  rent: 35000,
  rentUnit: 'rmb-month',
  area: 150,
  isFeatured: false,
  highlights: [],
  description: null,
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
}

// ---------------------------------------------------------------------------
// 未知/不完整输入 fixtures（测试 mapper 类型守卫）
// ---------------------------------------------------------------------------

/** 非对象输入：mapper 应返回 null */
export const INVALID_INPUTS: ReadonlyArray<unknown> = [
  null,
  undefined,
  'string',
  42,
  true,
  [],
  {},
  { id: 'not-a-number' },
  { id: 1, slug: 'missing-title' },
  { id: 1, slug: 's', title: 't', listingType: 'unknown-type', rent: 'not-a-number' },
]

// ---------------------------------------------------------------------------
// 询盘测试用例
// ---------------------------------------------------------------------------

/** 合法的询盘输入 */
export const VALID_INQUIRY_INPUT = {
  name: '测试用户',
  phone: '13800001111',
  message: '想约看这套房源',
  listingSlug: 'jingan-center-100-monthly',
} as const

/** 含真实手机号格式但不存在的号码 */
export const INQUIRY_INVALID_PHONES: ReadonlyArray<string> = [
  '',
  '   ',
  '123',
  '1234567890', // 10 位
  '23000001111', // 第二位非 3-9
  '12345678901', // 第二位 2
  '1380000111', // 10 位
  '138000011112', // 12 位
  'abcdefghijk', // 字母
  '138-0000-1111', // 含分隔符
  '+8613800001111', // 含国际码
]

/** 超长字段输入 */
export const INQUIRY_LONG_INPUTS = {
  name_51: '测'.repeat(51),
  message_501: '测'.repeat(501),
} as const
