import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import HeroSummaryPanel from '@/components/frontend/building-detail/HeroSummaryPanel'
import BuildingSupplyBrowser from '@/components/frontend/BuildingSupplyBrowser'
import DetailGallery from '@/components/frontend/DetailGallery'
import BuildingSpecPanel from '@/components/frontend/detail/BuildingSpecPanel'
import DetailPanel from '@/components/frontend/detail/DetailPanel'
import ListingOverviewPanel from '@/components/frontend/detail/ListingOverviewPanel'
import LocationPanel, { type LocationPanelBuilding } from '@/components/frontend/LocationPanel'
import SpecTable, { type SpecRow } from '@/components/frontend/detail/SpecTable'
import StickyInquiryBar from '@/components/frontend/detail/StickyInquiryBar'
import InquiryModal from '@/components/frontend/InquiryModal'
import type {
  BuildingDetailViewModel,
  BuildingSummaryViewModel,
  BuildingSupplySnapshot,
  DetailMediaViewModel,
  FactGroupViewModel,
  FactValue,
  ListingCardViewModel,
  PriceViewModel,
  VerificationViewModel,
} from '@/domain/public-catalog/contracts'
import { buildBuildingSupplyCanonicalSearchParams, parseBuildingSupplySearchParams } from '@/domain/public-catalog'
import type { NearbyPoi } from '@/domain/location-services'
import type { PoiByCategory } from '@/lib/frontend/location-pois'
import { formatPublishedDate } from '@/lib/frontend/format'

/**
 * OPT-037 详情页组件预览（仅开发环境）
 *
 * 存在理由：详情页是本批的地基任务——后面十一个任务都要往这里加一个区块才能
 * 独立截图验收，不必等到整页接线完成。首页批次（OPT-035）与列表页批次
 * （OPT-036）都吃过同一个亏：组件只有接线后才能被看见，视觉缺陷压到批次
 * 最后一个任务才暴露。
 *
 * 追加区块的方式（后续任务照抄这三行即可，不要改本页其它部分）：
 *
 *   <PreviewSection id="detail-gallery" title="详情画廊（DetailGallery）"
 *     note="16:10 主图 · 5 格缩略图 · 无图替代构图">
 *     <DetailGallery … />
 *   </PreviewSection>
 *
 * 守护不变量（与既有 dev-story 页一致）：
 *   - 仅开发环境可用，生产环境直接 404（`process.env.NODE_ENV === 'production'`）；
 *   - metadata 标记 noindex,nofollow；
 *   - robots.ts 已 disallow `/dev-story`（前缀匹配，覆盖本子路由），
 *     sitemap.ts 只枚举白名单静态路由与查询得到的实体 URL，不会扫描本路由；
 *   - 所有数据为 fixture，不读取 Payload（避免预览页依赖 DB 状态）。
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'dev-story · OPT-037 详情页组件预览',
  description: '仅供开发环境使用的 OPT-037 详情页组件预览页',
  robots: { index: false, follow: false },
}

/** 预览区块外壳：统一标题/说明/分隔，使「加一个组件」= 加一个 <PreviewSection>。 */
function PreviewSection({ id, title, note, children }: Readonly<{
  id: string
  title: string
  note?: string
  children: React.ReactNode
}>) {
  return (
    <section
      id={id}
      data-preview={id}
      aria-labelledby={`${id}-title`}
      style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 24, borderTop: '1px solid var(--line)' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 id={`${id}-title`} style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>{title}</h2>
        {note ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.43, color: 'var(--ink-2)' }}>{note}</p> : null}
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Fixture：SpecTable（Task 1）—— 缺失值放在中间行而非末行，同一屏同时验证
// 两条不变量：①value:null 渲染 — 且不隐藏该行（前后仍有正常行夹住它）；
// ②只有真正的末行没有分隔线（不是「因为是 null 所以没有线」）。
// ---------------------------------------------------------------------------

const SPEC_FIXTURE_ROWS: readonly SpecRow[] = [
  { label: '建筑面积', value: '1,240', unit: '㎡' },
  { label: '装修状态', value: '精装带家具' },
  { label: '车位配比', value: null },
  { label: '可入驻时间', value: '2026-09-01' },
]

// ---------------------------------------------------------------------------
// Fixture：DetailGallery（Task 2）—— 画廊方案 A + 无图替代构图。
// 覆盖多图 / 单图 / 无图三态：
//   - 多图（7 张）：验证主图 16:10 cover、图上压暗 + 说明文字 + 计数 pill、
//     缩略图条 5 格等宽（第 6/7 张需横向滚动才能看到——保留既有翻页箭头，
//     稿子的静态 5 格截图不代表数量 >5 时不需要它）；capturedAt 故意只给
//     部分项，验证「无拍摄日期时不显示 · 商户上传」的条件渲染。
//   - 单图：验证缩略图条整段不渲染（既有行为，非本任务新增）——一张图不需要
//     选择器，强行摆一条只有一格的缩略图条没有意义。
//   - 无图：验证 NoImageHeroGrid 接管首屏；「装修状态」故意留 null，验证
//     缺失渲染为 — 而不是空白或 0（与 SpecTable 同一约定）。
// ---------------------------------------------------------------------------

// DetailGallery 的媒体 URL 经 normalizePublicMediaUrl 校验，data: URI 会被
// 判定为不安全来源直接拒收（这是刻意的防御行为，见
// detail-components-contract.test.ts「画廊防御性拒绝…不安全媒体 URL」）。
// 所以 fixture 必须是真实可达的站内路径——复用 building-detail-demo 预览页
// 已有的 public/dev-story/*.svg（4 张通用示例图，循环使用凑够 7 张）。
const DEMO_IMAGES = [
  { src: '/dev-story/detail-demo-lobby.svg', alt: '大堂示例图' },
  { src: '/dev-story/detail-demo-exterior.svg', alt: '外立面示例图' },
  { src: '/dev-story/detail-demo-night.svg', alt: '夜景示例图' },
  { src: '/dev-story/detail-demo-floorplan.svg', alt: '平面图示意' },
] as const

const MULTI_IMAGE_FIXTURE: readonly DetailMediaViewModel[] = [
  { id: 'm1', kind: 'image', category: '大堂与电梯厅', resource: DEMO_IMAGES[0], capturedAt: '2026-08-11T00:00:00.000Z', isSchematic: false },
  { id: 'm2', kind: 'image', category: '开放办公区', resource: DEMO_IMAGES[1], capturedAt: null, isSchematic: false },
  { id: 'm3', kind: 'image', category: '会议室', resource: DEMO_IMAGES[2], capturedAt: null, isSchematic: false },
  { id: 'm4', kind: 'image', category: '茶水间', resource: DEMO_IMAGES[3], capturedAt: '2026-07-02T00:00:00.000Z', isSchematic: false },
  { id: 'm5', kind: 'image', category: '前台', resource: DEMO_IMAGES[0], capturedAt: null, isSchematic: false },
  { id: 'm6', kind: 'image', category: '楼宇外观', resource: DEMO_IMAGES[1], capturedAt: null, isSchematic: false },
  { id: 'm7', kind: 'image', category: '楼层平面', resource: DEMO_IMAGES[3], capturedAt: null, isSchematic: false },
]

const SINGLE_IMAGE_FIXTURE: readonly DetailMediaViewModel[] = [
  { id: 's1', kind: 'image', category: '大堂与电梯厅', resource: DEMO_IMAGES[0], capturedAt: null, isSchematic: false },
]

const NO_IMAGE_KEY_SPECS: readonly SpecRow[] = [
  { label: '建筑面积', value: '1,240', unit: '㎡' },
  { label: '工位数', value: '86', unit: '个' },
  { label: '装修状态', value: null },
  { label: '房源类型', value: '整层办公' },
  { label: '可入驻', value: '2026年9月1日' },
  { label: '楼盘等级', value: '甲级' },
]

// ---------------------------------------------------------------------------
// Fixture：ListingOverviewPanel（Task 3）—— 三态：字段齐全 / 部分缺失 / 整组缺失。
// factGroups 直接仿 mapListingFactGroups 的既有事实标签（见 mappers.ts），
// ListingOverviewPanel 按标签查值再重新分组，标签必须逐字匹配才查得到。
// ---------------------------------------------------------------------------

function overviewFact(label: string, value: string | null, estimated = false): FactValue {
  return { label, value, estimated, critical: false }
}

const OVERVIEW_PRICE_FULL: PriceViewModel = {
  amount: 8.5,
  currency: 'CNY',
  businessType: 'lease',
  period: 'day',
  basis: 'sqm',
  displayUnit: 'rmb-sqm-day',
  text: '8.50 元/㎡/天',
}

const OVERVIEW_PRICE_GROUP_MISSING: PriceViewModel = {
  amount: 9.6,
  currency: 'CNY',
  businessType: 'lease',
  period: 'day',
  basis: 'sqm',
  displayUnit: 'rmb-sqm-day',
  text: '9.60 元/㎡/天',
}

// building 补映射（review 修正）：空调/网络/停车费三项来自
// BuildingSummaryViewModel，与 listing.building 同一 DTO 子对象。
// 齐全态三项都有值；部分缺失态故意留「网络」为 undefined，验证行不因值
// 缺失被隐藏；整组缺失态（费用明细）额外让「停车费」也缺失，与「物业费」
// 「发票」一起验证整组全 — 仍渲染组标签。
const OVERVIEW_BUILDING_FULL: BuildingSummaryViewModel = {
  id: 1,
  slug: 'jing-an-kerry-centre',
  name: '静安嘉里中心',
  address: '静安区南京西路 1515 号',
  citySlug: 'shanghai',
  cityName: '上海',
  airConditioning: 'VRV 分户计费',
  network: '双线光纤入户',
  parkingFee: '1,500 元/月/位',
}

const OVERVIEW_BUILDING_PARTIAL: BuildingSummaryViewModel = {
  id: 2,
  slug: 'yueyang-international-plaza',
  name: '越洋国际广场',
  address: '静安区威海路 511 号',
  citySlug: 'shanghai',
  cityName: '上海',
  airConditioning: '中央空调 · 工作日供应',
  parkingFee: '1,200 元/月/位',
}

const OVERVIEW_BUILDING_GROUP_MISSING: BuildingSummaryViewModel = {
  id: 3,
  slug: 'huidefeng-international-plaza',
  name: '会德丰国际广场',
  address: '黄浦区西藏中路 168 号',
  citySlug: 'shanghai',
  cityName: '上海',
  airConditioning: 'VRV 分户计费',
  network: '双线光纤入户',
}

// 字段齐全：四组全部字段都有值，验证正常展示不误伤。
const OVERVIEW_FULL_GROUPS: readonly FactGroupViewModel[] = [
  {
    id: 'space',
    title: '空间信息',
    facts: [
      overviewFact('建筑面积', '1,240 ㎡'),
      overviewFact('套内参考面积', '892.8 ㎡'),
      overviewFact('得房率', '72%'),
      overviewFact('工位数', '112–124', true),
      overviewFact('净层高', '4.20 m'),
    ],
  },
  {
    id: 'delivery',
    title: '装修与交付',
    facts: [overviewFact('装修', '精装带家具'), overviewFact('注册', '可注册')],
  },
  {
    id: 'cost',
    title: '费用条款',
    facts: [
      overviewFact('最短租期', '36 个月'),
      overviewFact('押金月数', '2 个月'),
      overviewFact('付款方式', '按季度付款'),
      overviewFact('物业费金额', '28.00 元/㎡/月'),
      overviewFact('物业费', '包含'),
      overviewFact('发票', '含发票'),
    ],
  },
]

// 部分缺失：每组内都夹杂 null，验证行不因值缺失被隐藏——「可入驻」走
// formatAvailableDate 既有「面议」兜底，不是本面板的「—」，两套文案在
// 同一预览区块里刻意并存。「物业费」验证金额缺失时退回类别事实「不包含」。
const OVERVIEW_PARTIAL_GROUPS: readonly FactGroupViewModel[] = [
  {
    id: 'space',
    title: '空间信息',
    facts: [
      overviewFact('建筑面积', '860 ㎡'),
      overviewFact('套内参考面积', null),
      overviewFact('得房率', '68%'),
      overviewFact('工位数', null),
      overviewFact('净层高', '3.60 m'),
    ],
  },
  {
    id: 'delivery',
    title: '装修与交付',
    facts: [overviewFact('装修', '简装'), overviewFact('注册', null)],
  },
  {
    id: 'cost',
    title: '费用条款',
    facts: [
      overviewFact('最短租期', '12 个月'),
      overviewFact('押金月数', null),
      overviewFact('付款方式', null),
      overviewFact('物业费金额', null),
      overviewFact('物业费', '不包含'),
      overviewFact('发票', null),
    ],
  },
]

// 整组缺失：「费用明细」两行（物业费金额/物业费、发票）全部为 null，
// 其余三组正常——验证整组全缺时该组仍渲染（组标签 + 全 — 行），不整组隐藏。
const OVERVIEW_GROUP_MISSING_GROUPS: readonly FactGroupViewModel[] = [
  {
    id: 'space',
    title: '空间信息',
    facts: [
      overviewFact('建筑面积', '1,050 ㎡'),
      overviewFact('套内参考面积', '780 ㎡', true),
      overviewFact('得房率', '74%'),
      overviewFact('工位数', '95–105', true),
      overviewFact('净层高', '4.00 m'),
    ],
  },
  {
    id: 'delivery',
    title: '装修与交付',
    facts: [overviewFact('装修', '拎包入住'), overviewFact('注册', '有条件注册')],
  },
  {
    id: 'cost',
    title: '费用条款',
    facts: [
      overviewFact('最短租期', '36 个月'),
      overviewFact('押金月数', '2 个月'),
      overviewFact('付款方式', '按季度付款'),
      overviewFact('物业费金额', null),
      overviewFact('物业费', null),
      overviewFact('发票', null),
    ],
  },
]

// ---------------------------------------------------------------------------
// Fixture：决策卡 + 吸附询价条（Task 4）—— 与 ListingOverviewPanel 用同一套
// 静安嘉里中心 fixture（OVERVIEW_PRICE_FULL / OVERVIEW_BUILDING_FULL /
// OVERVIEW_FULL_GROUPS），保证这个滚动测试场景里"画廊 + 决策卡 + 概况"
// 三块拼出的是同一套真实存在的房源，不是三份互不相关的占位数据。
// ---------------------------------------------------------------------------

const STICKY_LISTING_TITLE = '静安嘉里中心 · 12 层整层'

// VerificationViewModel 是 ListingDetailViewModel.verification 的真实类型
// （见 mappers.ts mapVerification），不是为本预览臆造的形状。
const STICKY_VERIFICATION_FIXTURE: VerificationViewModel = {
  verifiedAt: '2026-08-11T00:00:00.000Z',
  priceVerifiedAt: '2026-08-15T00:00:00.000Z',
}

// 与 CityListingDetailView.tsx inquiryPriceSnapshot 同一套字段变换
// （amount/currency/period/unit），复用既有价格 fixture 派生，不重新编数字。
const STICKY_PRICE_SNAPSHOT = {
  amount: OVERVIEW_PRICE_FULL.amount,
  currency: OVERVIEW_PRICE_FULL.currency,
  period: OVERVIEW_PRICE_FULL.period,
  unit: OVERVIEW_PRICE_FULL.displayUnit,
} as const

/** 核验行前的勾选图标——单色 currentColor，不引入 comp 字面量的双色 hex。 */
function VerifyCheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true" className="dt-decision__verify-icon">
      <circle cx="7.5" cy="7.5" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.4 7.7l2.1 2.1 4.1-4.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Fixture：LocationPanel + AmapMapCanvas（Task 5）—— 三态：有坐标 / 无坐标 /
// 有坐标但 mapEnabled=false（对应生产里「有坐标但高德 JS Key 未配置」的分支，
// 与「有 Key 但脚本网络失败」是 AmapMapCanvas 内部的另一种降级，两者代码路径
// 不同——前者 AmapMapCanvas 直接返回 null，后者渲染出「地图暂时不可用」。
// 本预览页只能摆出前一种（不读 Payload、不能真的让网络失败一次性复现），
// 后一种在 task-5-report.md 里用 Playwright 拦截 webapi.amap.com 验证）。
// ---------------------------------------------------------------------------

const LOCATION_BUILDING_FULL: LocationPanelBuilding = {
  id: 1,
  name: '静安嘉里中心 · 12 层整层',
  address: '静安区南京西路 1515 号',
  coordinates: { latitude: 31.2246, longitude: 121.4467 },
  nearestMetro: { name: '南京西路站' },
}

const LOCATION_BUILDING_NO_COORDS: LocationPanelBuilding = {
  id: 2,
  name: '越洋国际广场',
  address: '静安区威海路 511 号',
  coordinates: undefined,
  nearestMetro: undefined,
}

function fixturePoi(overrides: Partial<NearbyPoi> & Pick<NearbyPoi, 'id' | 'category' | 'name'>): NearbyPoi {
  return {
    coordinates: { latitude: 31.225, longitude: 121.447 },
    distanceMeters: 340,
    direction: null,
    source: 'amap-location-service',
    fetchedAt: '2026-08-11T00:00:00.000Z',
    subCategory: null,
    metroLines: [],
    ...overrides,
  }
}

// 交通类混合地铁/公交，验证二级 tab 与地图图钉字母对应「当前列表正在展示的」
// 那一份数据（见 LocationPanel.tsx 文件头说明），不是恒画全量。
const LOCATION_POIS_FULL: PoiByCategory = {
  transport: [
    fixturePoi({ id: 't1', category: 'transport', name: '南京西路站', distanceMeters: 340, subCategory: 'subway', metroLines: ['2号线', '12号线', '13号线'] }),
    fixturePoi({ id: 't2', category: 'transport', name: '静安寺站', distanceMeters: 890, subCategory: 'subway', metroLines: ['2号线', '7号线', '14号线'] }),
    fixturePoi({ id: 't3', category: 'transport', name: '南京西路石门一路', distanceMeters: 210, subCategory: 'bus' }),
    fixturePoi({ id: 't4', category: 'transport', name: '成都北路延安中路', distanceMeters: 560, subCategory: 'bus' }),
  ],
  restaurant: [
    fixturePoi({ id: 'r1', category: 'restaurant', name: '嘉里中心 B1 美食区', distanceMeters: 0, direction: '同楼' }),
    fixturePoi({ id: 'r2', category: 'restaurant', name: '恒隆广场 5F', distanceMeters: 340 }),
    fixturePoi({ id: 'r3', category: 'restaurant', name: '兴业太古汇', distanceMeters: 620 }),
  ],
  bank: [
    fixturePoi({ id: 'b1', category: 'bank', name: '中国银行 南京西路支行', distanceMeters: 180 }),
    fixturePoi({ id: 'b2', category: 'bank', name: '招商银行 静安支行', distanceMeters: 260 }),
  ],
  // 故意留空：验证「酒店」一级 tab 因 count===0 不渲染（既有行为，未因改版丢失）
  hotel: [],
}

const LOCATION_POIS_EMPTY: PoiByCategory = {
  transport: [],
  restaurant: [],
  bank: [],
  hotel: [],
}

// ---------------------------------------------------------------------------
// Fixture：楼盘信息面板 + 规格参数表（Task 6）
//
// HeroSummaryPanel（信息面板）：核心区 776 画廊 + 372 面板，`factGroups` 沿用
// `mapBuildingFactGroups` 真实产出的标签，供 `pickHeroFacts` 按既有优先级
// 清单挑选——与 BuildingSpecPanel 复用同一份，两者读的是同一栋楼的同一批
// 事实，不是两份互相矛盾的 fixture。
//
// BuildingSpecPanel（规格参数表）三态：字段齐全 / 部分缺失（组内夹杂 null）/
// 整组缺失（「机电与设施」客梯·货梯·空调·供电·网络全 null，组标签仍渲染）。
// ---------------------------------------------------------------------------

function buildingFact(label: string, value: string | null, estimated = false): FactValue {
  return overviewFact(label, value, estimated)
}

const HERO_BUILDING_FACT_GROUPS: readonly FactGroupViewModel[] = [
  {
    id: 'identity',
    title: '身份与注册',
    facts: [
      buildingFact('物业类型', '写字楼'),
      buildingFact('楼宇等级', '超甲级'),
      buildingFact('注册能力', '支持注册'),
    ],
  },
  {
    id: 'building',
    title: '建筑信息',
    facts: [
      buildingFact('竣工时间', '2013-01-01T00:00:00.000Z'),
      buildingFact('总楼层', '46 层'),
      buildingFact('总建筑面积', '108,000 ㎡'),
      buildingFact('标准层面积', '2,400 ㎡'),
      buildingFact('标准层高', '4.2 m'),
      buildingFact('净层高', '2.85 m'),
      buildingFact('得房率', '72%'),
    ],
  },
  {
    id: 'property',
    title: '开发物业',
    facts: [
      buildingFact('开发商', '嘉里建设'),
      buildingFact('物业公司', '嘉里物业'),
      buildingFact('物业费', '28 元/㎡/月'),
    ],
  },
  {
    id: 'transport',
    title: '电梯与停车',
    facts: [
      buildingFact('客梯', '18 部'),
      buildingFact('货梯', '2 部'),
      buildingFact('分区说明', '1–20 层 / 21–46 层分区运行'),
      buildingFact('停车位', '620 个'),
      buildingFact('停车费', '1,500 元/月/位'),
    ],
  },
  {
    id: 'services',
    title: '楼宇服务',
    facts: [
      buildingFact('空调', 'VAV + VRV 分户'),
      buildingFact('网络', '三网入楼 · 双路光纤'),
      buildingFact('供电', '双路市电 + 柴发'),
      buildingFact('门禁', '人脸识别门禁'),
      buildingFact('服务时间', '工作日 8:00–22:00'),
    ],
  },
]

const HERO_BUILDING_AMENITY_GROUPS = [
  { id: 'amenities', title: '配套', items: ['双首层大堂', '24 小时空调可申请'] },
  { id: 'certifications', title: '认证', items: ['LEED 金级', '绿色建筑三星'] },
] as const

const HERO_BUILDING_FULL: BuildingDetailViewModel = {
  citySlug: 'shanghai',
  cityName: '上海',
  id: 10,
  slug: 'jing-an-kerry-centre',
  name: '静安嘉里中心',
  address: '静安区南京西路 1515 号',
  buildingType: 'office_building',
  grade: 'super-grade-a',
  district: { id: 1, slug: 'jing-an', name: '静安区' },
  businessDistrict: { id: 2, slug: 'nanjing-xi-lu', name: '南京西路' },
  nearestMetro: { id: 3, slug: 'nanjing-xi-lu-station', name: '南京西路站' },
  coverImage: null,
  gallery: [],
  // HeroSummaryPanel 不读 mediaItems（画廊由 DetailGallery 独立渲染），留空。
  mediaItems: [],
  factGroups: HERO_BUILDING_FACT_GROUPS,
  amenityGroups: HERO_BUILDING_AMENITY_GROUPS,
  verification: { verifiedAt: '2026-08-11T00:00:00.000Z', priceVerifiedAt: '2026-08-15T00:00:00.000Z' },
  amenities: ['双首层大堂', '24 小时空调可申请'],
  summary: '静安核心地标甲级写字楼',
  description: null,
  coordinates: { latitude: 31.2246, longitude: 121.4467 },
}

const HERO_SUPPLY_FULL: BuildingSupplySnapshot = {
  asOf: '2026-08-20T00:00:00.000Z',
  // HeroSummaryPanel 只读 availableGroups / totalEffectiveListings，groups
  // 是当前 query 结果（供给密度表用），预览信息面板时留空不影响渲染。
  groups: [],
  availableGroups: [
    {
      key: 'lease',
      totalEffectiveListings: 51,
      areaRange: { min: 320, max: 1860 },
      immediateAvailabilityCount: 19,
      priceRanges: [
        {
          key: 'lease:CNY:day:sqm:rmb-sqm-day',
          businessType: 'lease',
          currency: 'CNY',
          period: 'day',
          basis: 'sqm',
          displayUnit: 'rmb-sqm-day',
          min: 7.2,
          max: 12,
          count: 51,
        },
      ],
    },
  ],
  totalEffectiveListings: 51,
  resultCount: 51,
  validationErrors: [],
}

// 字段齐全：BuildingSpecPanel 4 组全部字段都有值 + 认证列表命中两条（拼接展示，非按名称匹配）+ 最小可租面积可算。
const BUILDING_SPEC_FULL_AMENITIES = HERO_BUILDING_AMENITY_GROUPS

// 部分缺失：组内夹杂 null（标准层高缺失 → 「层高 / 净高」显示「— / 2.85 m」；
// 网络、停车费缺失），认证列表只有「绿色建筑三星」（不含"LEED"字样）——验证
// review 修正后的行为：不做名称匹配，原样展示持有的认证，不因为不叫"LEED"
// 就渲染 —（这正是本次修正要杜绝的静默误导）。
const BUILDING_SPEC_PARTIAL_GROUPS: readonly FactGroupViewModel[] = [
  HERO_BUILDING_FACT_GROUPS[0],
  {
    id: 'building',
    title: '建筑信息',
    facts: [
      buildingFact('竣工时间', '2013-01-01T00:00:00.000Z'),
      buildingFact('总楼层', '46 层'),
      buildingFact('总建筑面积', '108,000 ㎡'),
      buildingFact('标准层面积', '2,400 ㎡'),
      buildingFact('标准层高', null),
      buildingFact('净层高', '2.85 m'),
      buildingFact('得房率', '72%'),
    ],
  },
  HERO_BUILDING_FACT_GROUPS[2],
  {
    id: 'transport',
    title: '电梯与停车',
    facts: [
      buildingFact('客梯', '18 部'),
      buildingFact('货梯', '2 部'),
      buildingFact('分区说明', '1–20 层 / 21–46 层分区运行'),
      buildingFact('停车位', '620 个'),
      buildingFact('停车费', null),
    ],
  },
  {
    id: 'services',
    title: '楼宇服务',
    facts: [
      buildingFact('空调', 'VAV + VRV 分户'),
      buildingFact('网络', null),
      buildingFact('供电', '双路市电 + 柴发'),
      buildingFact('门禁', '人脸识别门禁'),
      buildingFact('服务时间', '工作日 8:00–22:00'),
    ],
  },
]
const BUILDING_SPEC_PARTIAL_AMENITIES = [
  { id: 'amenities', title: '配套', items: ['双首层大堂'] },
  { id: 'certifications', title: '认证', items: ['绿色建筑三星'] },
] as const

// 整组缺失：「机电与设施」对应的原始事实（客梯/货梯/空调/供电/网络）全部为
// null，其余三组正常——验证该组仍渲染组标签 + 全 — 行，不整组隐藏；认证列表
// 换成真正的空数组（这栋楼确实没有公开认证），验证「认证」行此时渲染 — 且
// 这个 — 是真的"没有"，不是"没匹配到某个名字"。
const BUILDING_SPEC_GROUP_MISSING_GROUPS: readonly FactGroupViewModel[] = [
  HERO_BUILDING_FACT_GROUPS[0],
  HERO_BUILDING_FACT_GROUPS[1],
  HERO_BUILDING_FACT_GROUPS[2],
  {
    id: 'transport',
    title: '电梯与停车',
    facts: [
      buildingFact('客梯', null),
      buildingFact('货梯', null),
      buildingFact('分区说明', null),
      buildingFact('停车位', '620 个'),
      buildingFact('停车费', '1,500 元/月/位'),
    ],
  },
  {
    id: 'services',
    title: '楼宇服务',
    facts: [
      buildingFact('空调', null),
      buildingFact('网络', null),
      buildingFact('供电', null),
      buildingFact('门禁', null),
      buildingFact('服务时间', null),
    ],
  },
]
const BUILDING_SPEC_GROUP_MISSING_AMENITIES = [
  { id: 'amenities', title: '配套', items: ['双首层大堂', '24 小时空调可申请'] },
  // 真正没有认证（空数组），与「有认证但不叫 LEED」是两种不同状态，
  // 分别由「整组缺失」态与「部分缺失」态覆盖。
  { id: 'certifications', title: '认证', items: [] },
] as const

// ---------------------------------------------------------------------------
// Fixture：供给密度表（BuildingSupplyBrowser，Task 7）——三组齐全 / 某组为空 /
// 全空三态。listing 字段刻意留一条 price:null（验证「—」而非「面议」/「0」）
// 与一条 availableFrom 落在 asOf 之后（验证「可入驻」列显示具体日期而非「可即刻」）。
// ---------------------------------------------------------------------------

function supplyListing(
  overrides: Partial<ListingCardViewModel> & { id: number; slug: string; title: string },
): ListingCardViewModel {
  return {
    citySlug: 'shanghai',
    cityName: '上海市',
    price: null,
    area: null,
    floor: null,
    seats: null,
    businessType: 'lease',
    decorationStatus: null,
    listingType: 'traditional-office',
    availableFrom: null,
    isFeatured: false,
    building: null,
    coverImage: null,
    highlights: [],
    stableSortKey: `listing-${overrides.id}`,
    ...overrides,
  }
}

function supplyPrice(overrides: Partial<PriceViewModel> = {}): PriceViewModel {
  return {
    amount: 8.2,
    currency: 'CNY',
    businessType: 'lease',
    period: 'day',
    basis: 'sqm',
    displayUnit: 'rmb-sqm-day',
    text: '8.20 元/㎡/天',
    ...overrides,
  }
}

const SUPPLY_ASOF = '2026-08-19T09:30:00.000Z'

const SUPPLY_LEASE_LISTINGS: readonly ListingCardViewModel[] = [
  supplyListing({
    id: 901, slug: 'jingan-kerry-9f-full-floor', title: '9 层 · 整层',
    floor: '9', decorationStatus: 'furnished', area: 860,
    price: supplyPrice({ amount: 8.2, text: '8.20 元/㎡/天' }),
    availableFrom: '2026-08-01',
  }),
  supplyListing({
    id: 902, slug: 'jingan-kerry-18f-full-floor', title: '18 层 · 整层',
    floor: '18', decorationStatus: 'rough', area: 1240,
    price: supplyPrice({ amount: 7.2, text: '7.20 元/㎡/天' }),
    availableFrom: '2026-11-01',
  }),
  // 价格面议：验证「—」而不是「面议」/「0」（表格数字缺失口径）
  supplyListing({
    id: 903, slug: 'jingan-kerry-22f-half', title: '22 层 · 半层 B 区',
    floor: '22', decorationStatus: 'furnished', area: 580,
    price: null,
    availableFrom: '2026-08-01',
  }),
]

const SUPPLY_SALE_LISTINGS: readonly ListingCardViewModel[] = [
  supplyListing({
    id: 911, slug: 'jingan-kerry-11f-sale', title: '11 层 · 整层',
    floor: '11', decorationStatus: 'fully_fitted', area: 1240, businessType: 'sale',
    price: supplyPrice({
      amount: 114_080_000, businessType: 'sale', period: 'one-time', basis: 'total',
      displayUnit: 'rmb-total', text: '11,408 万元',
    }),
  }),
]

const SUPPLY_COWORKING_LISTINGS: readonly ListingCardViewModel[] = [
  supplyListing({
    id: 921, slug: 'jingan-kerry-7f-private-office', title: '7 层 · 独立办公室',
    floor: '7', seats: 12, listingType: 'coworking',
    price: supplyPrice({
      amount: 2880, period: 'month', basis: 'seat', displayUnit: 'rmb-seat-month', text: '2,880 元/工位/月',
    }),
    availableFrom: '2026-08-01',
  }),
  supplyListing({
    id: 922, slug: 'jingan-kerry-19f-suite', title: '19 层 · 整间套房',
    floor: '19', seats: 48, listingType: 'coworking',
    price: supplyPrice({
      amount: 3600, period: 'month', basis: 'seat', displayUnit: 'rmb-seat-month', text: '3,600 元/工位/月',
    }),
    availableFrom: '2026-08-01',
  }),
]

const SUPPLY_FULL_SNAPSHOT: BuildingSupplySnapshot = {
  asOf: SUPPLY_ASOF,
  groups: [
    {
      key: 'lease', listings: SUPPLY_LEASE_LISTINGS, areaRange: { min: 580, max: 1240 },
      immediateAvailabilityCount: 2,
      priceRanges: [{
        key: 'lease:CNY:day:sqm:rmb-sqm-day', businessType: 'lease', currency: 'CNY', period: 'day',
        basis: 'sqm', displayUnit: 'rmb-sqm-day', min: 7.2, max: 8.2, count: 2,
      }],
    },
    {
      key: 'sale', listings: SUPPLY_SALE_LISTINGS, areaRange: { min: 1240, max: 1240 },
      immediateAvailabilityCount: 1,
      priceRanges: [{
        key: 'sale:CNY:one-time:total:rmb-total', businessType: 'sale', currency: 'CNY', period: 'one-time',
        basis: 'total', displayUnit: 'rmb-total', min: 114_080_000, max: 114_080_000, count: 1,
      }],
    },
    {
      key: 'coworking', listings: SUPPLY_COWORKING_LISTINGS, areaRange: null,
      immediateAvailabilityCount: 2,
      priceRanges: [{
        key: 'coworking:CNY:month:seat:rmb-seat-month', businessType: 'lease', currency: 'CNY', period: 'month',
        basis: 'seat', displayUnit: 'rmb-seat-month', min: 2880, max: 3600, count: 2,
      }],
    },
  ],
  availableGroups: [
    { key: 'lease', totalEffectiveListings: 42, areaRange: { min: 320, max: 1860 }, immediateAvailabilityCount: 19,
      priceRanges: [{ key: 'lease:CNY:day:sqm:rmb-sqm-day', businessType: 'lease', currency: 'CNY', period: 'day', basis: 'sqm', displayUnit: 'rmb-sqm-day', min: 7.2, max: 12, count: 42 }] },
    { key: 'sale', totalEffectiveListings: 6, areaRange: { min: 620, max: 1860 }, immediateAvailabilityCount: 4,
      priceRanges: [{ key: 'sale:CNY:one-time:total:rmb-total', businessType: 'sale', currency: 'CNY', period: 'one-time', basis: 'total', displayUnit: 'rmb-total', min: 63_240_000, max: 219_480_000, count: 6 }] },
    { key: 'coworking', totalEffectiveListings: 3, areaRange: null, immediateAvailabilityCount: 3,
      priceRanges: [{ key: 'coworking:CNY:month:seat:rmb-seat-month', businessType: 'lease', currency: 'CNY', period: 'month', basis: 'seat', displayUnit: 'rmb-seat-month', min: 1880, max: 3600, count: 3 }] },
  ],
  totalEffectiveListings: 51,
  resultCount: 6,
  validationErrors: [],
}

// 某组为空：楼盘目前没有出售供给——sale 既不出现在 groups 也不出现在
// availableGroups（domain 的 buildBuildingSupplySnapshot 就是这样产出的，
// 见 building-supply.ts `if (availableCards.length > 0)`），组 tab 应整条不渲染。
const SUPPLY_SALE_EMPTY_SNAPSHOT: BuildingSupplySnapshot = {
  ...SUPPLY_FULL_SNAPSHOT,
  groups: SUPPLY_FULL_SNAPSHOT.groups.filter((g) => g.key !== 'sale'),
  availableGroups: SUPPLY_FULL_SNAPSHOT.availableGroups.filter((g) => g.key !== 'sale'),
  totalEffectiveListings: 45,
  resultCount: 5,
}

// 全空：楼盘当前没有任何公开有效供给——整个供给区应只剩一行「当前暂无公开可选空间」。
const SUPPLY_EMPTY_SNAPSHOT: BuildingSupplySnapshot = {
  asOf: SUPPLY_ASOF,
  groups: [],
  availableGroups: [],
  totalEffectiveListings: 0,
  resultCount: 0,
  validationErrors: [],
}

export default async function Opt037PreviewPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  // 生产环境直接 404，保证该路由只在开发环境可见
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  // 供给密度表预览（Task 7）需要真实的组切换/筛选/排序往返验证：与生产页
  // 用同一套 parseBuildingSupplySearchParams / buildBuildingSupplyCanonicalSearchParams，
  // 点击组 tab 会真的把本页 URL 换成 ?group=sale，刷新后仍是同一视图。
  const supplyCurrentSearch = buildBuildingSupplyCanonicalSearchParams(
    parseBuildingSupplySearchParams(await searchParams),
  ).toString()

  return (
    <div className="dt-page">
      <div className="dt-container" style={{ paddingBlock: 32, display: 'flex', flexDirection: 'column', gap: 48 }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, lineHeight: 1.2, color: 'var(--ink)' }}>
            OPT-037 详情页组件预览
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.47, color: 'var(--ink-2)' }}>
            仅开发环境可见。组件任务完成即在此追加一个 <code>&lt;PreviewSection&gt;</code>，
            无需等待页面接线就能截图验收。详情页面板 <code>.dt-panel</code> 是独立于
            <code> .sf-card</code> 的另一种表面（白底零边框、无 hover），不要合并两者。
          </p>
        </header>

        <PreviewSection
          id="detail-panel"
          title="详情面板（DetailPanel）"
          note="通栏 padding 40（.dt-panel--full）· 侧栏 padding 32（.dt-panel--side）——虚线框标出内容区，与面板边缘的留白差即 padding 差"
        >
          <div className="dt-core">
            <DetailPanel variant="full">
              <div style={{ border: '1px dashed var(--line)', padding: 12, fontSize: 13, color: 'var(--ink-2)' }}>
                通栏面板（variant=&quot;full&quot;）· padding 40px
              </div>
            </DetailPanel>
            <DetailPanel variant="side">
              <div style={{ border: '1px dashed var(--line)', padding: 12, fontSize: 13, color: 'var(--ink-2)' }}>
                侧栏面板（variant=&quot;side&quot;）· padding 32px
              </div>
            </DetailPanel>
          </div>
        </PreviewSection>

        <PreviewSection
          id="spec-table"
          title="规格表（SpecTable）"
          note="右列右对齐 + tabular-nums + 500；「车位配比」值为 null 仍保留整行并渲染 —（不隐藏）；只有真正的末行「可入驻时间」没有底部分隔线"
        >
          <DetailPanel variant="full">
            <SpecTable rows={SPEC_FIXTURE_ROWS} />
          </DetailPanel>
        </PreviewSection>

        <PreviewSection
          id="detail-gallery-multi"
          title="详情画廊 · 多图（DetailGallery）"
          note="16:10 主图 · 图上压暗复用 .sf-scrim · 说明文字 + 计数 pill · 5 格等宽缩略图条（第 6/7 张需滚动）"
        >
          <div style={{ maxWidth: 776 }}>
            <DetailGallery media={MULTI_IMAGE_FIXTURE} title="静安嘉里中心 · 12 层整层" pageType="listing" />
          </div>
        </PreviewSection>

        <PreviewSection
          id="detail-gallery-single"
          title="详情画廊 · 单图"
          note="缩略图条整段不渲染（既有行为）——一张图没有可选项，摆一条只有一格的缩略图条没有意义"
        >
          <div style={{ maxWidth: 776 }}>
            <DetailGallery media={SINGLE_IMAGE_FIXTURE} title="静安嘉里中心 · 12 层整层" pageType="listing" />
          </div>
        </PreviewSection>

        <PreviewSection
          id="detail-gallery-no-media"
          title="详情画廊 · 无图替代构图（NoImageHeroGrid）"
          note="mediaItems 为 0，画廊整段不渲染，关键规格 3×2 宫格 + 地址交通条接管首屏；「装修状态」故意为 null，验证渲染为 — 而非空白或 0"
        >
          <div style={{ maxWidth: 776 }}>
            <DetailGallery
              media={[]}
              title="静安嘉里中心 · 12 层整层"
              pageType="listing"
              noMediaFallback={{
                keySpecs: NO_IMAGE_KEY_SPECS,
                address: '静安区南京西路 1515 号 · 嘉里中心南楼',
                transit: '近静安寺站',
              }}
            />
          </div>
        </PreviewSection>

        <PreviewSection
          id="listing-overview"
          title="房源概况面板（ListingOverviewPanel）"
          note="通栏 · 组间距 40 · 组区分只用间距 + 组标签（不用顶线不用色块）；含 review 补映射的空调/网络/停车费（取自 listing.building）与漏查修正后的「付款方式」（取自既有 listing.factGroups「付款方式」事实，与「押金」并列两行）；三态：字段齐全 / 组内部分缺失（含「可入驻」的既有「面议」兜底、「物业费」金额→类别的退回、「网络」「付款方式」缺失）/ 整组缺失（费用明细三行全 —，组仍渲染）"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>字段齐全</span>
              <ListingOverviewPanel
                listing={{ factGroups: OVERVIEW_FULL_GROUPS, price: OVERVIEW_PRICE_FULL, availableFrom: '2026-09-01T00:00:00.000Z', building: OVERVIEW_BUILDING_FULL }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>部分缺失（组内夹杂 null）</span>
              <ListingOverviewPanel
                listing={{ factGroups: OVERVIEW_PARTIAL_GROUPS, price: null, availableFrom: null, building: OVERVIEW_BUILDING_PARTIAL }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>整组缺失（费用明细）</span>
              <ListingOverviewPanel
                listing={{
                  factGroups: OVERVIEW_GROUP_MISSING_GROUPS,
                  price: OVERVIEW_PRICE_GROUP_MISSING,
                  availableFrom: '2026-10-15T00:00:00.000Z',
                  building: OVERVIEW_BUILDING_GROUP_MISSING,
                }}
              />
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          id="decision-sticky-bar"
          title="决策卡 + 吸附询价条（StickyInquiryBar）"
          note="决策卡 sticky top 116（.dt-decision），粘附区间限定在核心区第 1 行（画廊高度）——纯 CSS Grid 机制，行末即释放；吸附询价条 sticky top 44 · 高 56，由 StickyInquiryBar 的 IntersectionObserver 在决策卡（.dt-decision）与视口零相交时才挂载，两者不会同屏重叠。滚动验证见 artifacts/verification/OPT-037/sticky-*.png。CTA 复用同一个 InquiryModal（询价 / 预约看房），不存在第二套询价逻辑。"
        >
          {/* 吸附条放在 .dt-core 网格之前（而不是整页最顶部）：它只在决策卡
              离屏后才挂载，而决策卡在下方的核心区网格里——挂载那一刻早已
              滚过本条自身的静态流位置，天然满足 sticky 的"已滚过阈值"条件，
              不需要把它挪到整页最顶端就能验证接管行为。 */}
          <StickyInquiryBar
            title={STICKY_LISTING_TITLE}
            priceText={String(OVERVIEW_PRICE_FULL.amount.toFixed(2))}
            priceUnit="元/㎡/天"
            summaryText="1,240 ㎡ · 月租 316,200 元/月"
            cta={
              <InquiryModal
                pageType="listing"
                targetListingSlug="jing-an-kerry-centre-12f"
                targetBuildingSlug={OVERVIEW_BUILDING_FULL.slug}
                targetSummary={STICKY_LISTING_TITLE}
                triggerLabel="预约看房"
                // btn--lg：56 高的吸附条放得下，且要和决策卡的 CTA（同样
                // btn--lg）视觉分量一致——不传 triggerClassName 会退回
                // InquiryModal 内部拼的默认 'btn btn--primary'（无尺寸修饰符），
                // 比决策卡的按钮明显小一号，且没有显式核对过是否达到
                // ≥44px 触控目标线，故不留隐式默认。
                triggerClassName="btn--lg"
                // 'sticky-card' 是 domain/inquiry/schema.ts SOURCE_SECTIONS 里
                // 唯一贴合"吸附态询价入口"的枚举值（标签"侧边悬浮卡"）；schema
                // 没有为"顶部吸附条"单开一个值。决策卡与吸附条本来就是同一个
                // 询价入口在滚动过程中的两种呈现形态，不是两个产品位——沿用
                // 同一枚举如实反映这一点，不为了区分而新造枚举（新增枚举要
                // 连带改 Leads collection 校验，超出本任务范围）。
                sourceSection="sticky-card"
                priceSnapshot={STICKY_PRICE_SNAPSHOT}
                activeSupplyGroup="lease"
                currentFilters={{ group: 'lease', priceUnit: STICKY_PRICE_SNAPSHOT.unit }}
              />
            }
          />

          <div className="dt-container">
            <div className="dt-core">
              <DetailGallery media={MULTI_IMAGE_FIXTURE} title={STICKY_LISTING_TITLE} pageType="listing" />

              <div className="dt-decision">
                <DetailPanel variant="side">
                  <span className="dt-decision__label">租金单价</span>
                  <div className="dt-decision__price-row">
                    <span className="dt-decision__price-num">{OVERVIEW_PRICE_FULL.amount.toFixed(2)}</span>
                    <span className="dt-decision__price-unit">元/㎡/天</span>
                  </div>
                  <p className="dt-decision__summary">1,240 ㎡ · 月租 316,200 元/月</p>

                  <div className="dt-decision__verify">
                    {STICKY_VERIFICATION_FIXTURE.verifiedAt && (
                      <div className="dt-decision__verify-row">
                        <VerifyCheckIcon />
                        <span className="dt-decision__verify-label">信息核验</span>
                        <span className="dt-decision__verify-when" title={STICKY_VERIFICATION_FIXTURE.verifiedAt}>
                          {formatPublishedDate(STICKY_VERIFICATION_FIXTURE.verifiedAt)}
                        </span>
                      </div>
                    )}
                    {STICKY_VERIFICATION_FIXTURE.priceVerifiedAt && (
                      <div className="dt-decision__verify-row">
                        <VerifyCheckIcon />
                        <span className="dt-decision__verify-label">价格核验</span>
                        <span className="dt-decision__verify-when" title={STICKY_VERIFICATION_FIXTURE.priceVerifiedAt}>
                          {formatPublishedDate(STICKY_VERIFICATION_FIXTURE.priceVerifiedAt)}
                        </span>
                      </div>
                    )}
                  </div>

                  <InquiryModal
                    pageType="listing"
                    targetListingSlug="jing-an-kerry-centre-12f"
                    targetBuildingSlug={OVERVIEW_BUILDING_FULL.slug}
                    targetSummary={STICKY_LISTING_TITLE}
                    triggerLabel="预约看房"
                    triggerClassName="btn--lg btn--block dt-decision__cta"
                    sourceSection="sticky-card"
                    priceSnapshot={STICKY_PRICE_SNAPSHOT}
                    activeSupplyGroup="lease"
                    currentFilters={{ group: 'lease', priceUnit: STICKY_PRICE_SNAPSHOT.unit }}
                  />
                  {/* 生产接线（非本任务范围）：这里应换成
                      <AdvisorCard cta={<InquiryModal .../>} />，与
                      CityListingDetailView.tsx 现有 .detail__decision 同款
                      组合——AdvisorCard 内部会读 Payload global（服务时段），
                      与本预览页"不读 Payload"的约定冲突，故预览页里只演示
                      价格/核验/CTA 三块，不拉入 AdvisorCard。 */}
                  {/* comp 在决策卡与吸附条里都还有一个次要的"电话咨询"按钮，
                      本组件只渲染了一个 CTA 槽——这不是漏做，是没有字段可填：
                      仓库里没有任何"平台客服热线/门店座机"配置（搜过
                      site-config.ts 与全部 *Phone* 字段，只有用户提交表单里
                      的联系电话，没有一个能公开展示的号码），而
                      AdvisorCard.tsx 文件头本就明令"不展示个人顾问手机号"——
                      两条路都走不通。CityListingDetailView.tsx:165-169 现有
                      的 .detail__decision 同样只有一个 InquiryModal CTA，
                      从未渲染过 tel: 链接，这不是巧合，是同一个字段缺口。
                      Task 9（或任何后续任务）如果想"补回"这个按钮，必须先
                      有一个真实、可公开、非个人的号码字段落地，而不是照抄
                      comp 的字面量。 */}
                </DetailPanel>
              </div>

              <ListingOverviewPanel
                listing={{
                  factGroups: OVERVIEW_FULL_GROUPS,
                  price: OVERVIEW_PRICE_FULL,
                  availableFrom: '2026-09-01T00:00:00.000Z',
                  building: OVERVIEW_BUILDING_FULL,
                }}
              />
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--ink-2)' }}>
            以下为滚动测试留白（模拟房源描述 / 周边与交通等后续区块），确保核心区完全离屏后仍有余量验证吸附询价条常驻。
          </p>
          <div style={{ height: 900 }} aria-hidden="true" />
        </PreviewSection>

        <PreviewSection
          id="location-panel-full"
          title="周边与交通 · 有坐标（LocationPanel）"
          note="地图 776×460 · 圆角 18 · 本房源图钉常驻标签 · 交通类含地铁/公交二级 tab（图钉字母与清单一一对应）· 「酒店」因 count=0 不渲染一级 tab（既有行为）"
        >
          <LocationPanel building={LOCATION_BUILDING_FULL} pois={LOCATION_POIS_FULL} mapEnabled />
        </PreviewSection>

        <PreviewSection
          id="location-panel-map-disabled"
          title="周边与交通 · 有坐标但 mapEnabled=false"
          note="对应生产「有坐标但高德 JS Key 未配置」——AmapMapCanvas 直接返回 null，地图区域不留空容器；清单面板（地址/地铁/POI）不受影响，照常展示"
        >
          <LocationPanel building={LOCATION_BUILDING_FULL} pois={LOCATION_POIS_FULL} mapEnabled={false} />
        </PreviewSection>

        <PreviewSection
          id="location-panel-no-coords"
          title="周边与交通 · 无坐标（整段不渲染）"
          note="building.coordinates 为 undefined 时 LocationPanel 返回 null——本区块标题下方应该空白一片，data-testid=location-panel-no-coords-probe 之后没有任何 .location-panel 元素（Playwright 用 DOM 断言而非目视验证，见 task-5-report.md）"
        >
          <div data-testid="location-panel-no-coords-probe" />
          <LocationPanel building={LOCATION_BUILDING_NO_COORDS} pois={LOCATION_POIS_EMPTY} mapEnabled={false} />
        </PreviewSection>

        <PreviewSection
          id="hero-summary-panel"
          title="楼盘信息面板（HeroSummaryPanel）"
          note="核心区 776 画廊 + 372 信息面板（DetailPanel variant=side，padding 32）；关键参数行改用 SpecTable（原手写 dl）；单列断点下面板应随 .dt-core 满宽下沉，不得保留 372 定宽"
        >
          <div className="dt-container">
            <div className="dt-core">
              <DetailGallery media={MULTI_IMAGE_FIXTURE} title={HERO_BUILDING_FULL.name} pageType="building" />
              <HeroSummaryPanel building={HERO_BUILDING_FULL} supply={HERO_SUPPLY_FULL} />
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          id="building-spec-panel"
          title="楼盘参数面板（BuildingSpecPanel）"
          note="通栏 · 4 组 2 列 gap 40/72，每列内部仍是 SpecTable 的行结构；三态：字段齐全（认证列表拼接展示两条 + 最小可租面积）/ 部分缺失（组内夹杂 null，含「层高 / 净高」两值只缺一半的组合行，认证列表只有非 LEED 命名的一条仍如实展示）/ 整组缺失（「机电与设施」对应原始事实全 null 且认证列表为空数组，两者组标签均仍渲染）"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>字段齐全</span>
              <BuildingSpecPanel
                building={{ factGroups: HERO_BUILDING_FACT_GROUPS, amenityGroups: BUILDING_SPEC_FULL_AMENITIES }}
                minLeasableArea={320}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>部分缺失（组内夹杂 null）</span>
              <BuildingSpecPanel
                building={{ factGroups: BUILDING_SPEC_PARTIAL_GROUPS, amenityGroups: BUILDING_SPEC_PARTIAL_AMENITIES }}
                minLeasableArea={null}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>整组缺失（机电与设施）</span>
              <BuildingSpecPanel
                building={{ factGroups: BUILDING_SPEC_GROUP_MISSING_GROUPS, amenityGroups: BUILDING_SPEC_GROUP_MISSING_AMENITIES }}
                minLeasableArea={320}
              />
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          id="building-supply-browser"
          title="供给密度表（BuildingSupplyBrowser，方案 A：分组切换 + 密度表）"
          note="组聚合（3 列 gap 24）→ 筛选 + 排序 → 表头 → 行，网格 1fr/130/150/176/120/44。组切换/筛选/排序状态在 URL 上（本页真的会因为点击而跳转 querystring，刷新后视图复现）；三态：三组齐全 / 出售组为空（tab 整条不渲染）/ 全空（仅一行提示）"
        >
          {/* minWidth:0：本预览页用 flex column 并排三个 fixture 实例（生产页
             .detail-v2__supply-main 本就有 min-width:0，见 styles.css），这个
             fixture 外壳自己也要显式声明，否则密度表 920px min-width 会撑开
             flex item 导致整页横向溢出——只是预览壳的责任，不是组件本身的缺陷。 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32, minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>三组齐全（租赁 / 出售 / 联合办公）</span>
              <BuildingSupplyBrowser
                snapshot={SUPPLY_FULL_SNAPSHOT}
                buildingId={1}
                citySlug="shanghai"
                basePath="/dev-story/opt037"
                currentSearch={supplyCurrentSearch}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>某组为空（出售）</span>
              <BuildingSupplyBrowser
                snapshot={SUPPLY_SALE_EMPTY_SNAPSHOT}
                buildingId={2}
                citySlug="shanghai"
                basePath="/dev-story/opt037"
                currentSearch=""
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>全空（当前暂无公开可选空间）</span>
              <BuildingSupplyBrowser
                snapshot={SUPPLY_EMPTY_SNAPSHOT}
                buildingId={3}
                citySlug="shanghai"
                basePath="/dev-story/opt037"
                currentSearch=""
              />
            </div>
          </div>
        </PreviewSection>

        {/* 后续任务在此追加 <PreviewSection id="..." title="..."> 区块 */}
      </div>
    </div>
  )
}
