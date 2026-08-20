import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import BuildingCompactRow from '@/components/frontend/listing/BuildingCompactRow'
import BuildingResultCard from '@/components/frontend/listing/BuildingResultCard'
import FilterFormC, { type FilterRow } from '@/components/frontend/listing/FilterFormC'
import FilterPill from '@/components/frontend/listing/FilterPill'
import ListingResultCard from '@/components/frontend/listing/ListingResultCard'
import type { BuildingSummaryViewModel, ListingCardViewModel, PriceViewModel } from '@/domain/public-catalog'

/**
 * OPT-036 列表页组件预览（仅开发环境）
 *
 * 存在理由：列表页组件多、状态多，等接线完成再截图会把视觉问题压到批次末尾——
 * 首页批次（OPT-035）正是这样让「数据带渲染 0 / 价值点整段隐形 / Hero 没出血」
 * 拖到最后才暴露。每个组件任务完成后往这里加一个区块，任务自己就能截图验收。
 *
 * 追加区块的方式（后续任务照抄这三行即可，不要改本页其它部分）：
 *
 *   <PreviewSection id="listing-card" title="房源卡（ListingResultCard）"
 *     note="4:3 · 定宽价格盒 · 无图/无价/长标题">
 *     <ListingResultCard … />
 *   </PreviewSection>
 *
 * 守护不变量（与既有 dev-story 页一致）：
 *   - 仅开发环境可用，生产环境直接 404（`process.env.NODE_ENV === 'production'`）；
 *   - metadata 标记 noindex,nofollow；
 *   - robots.ts 已 disallow `/dev-story`，sitemap.ts 只枚举白名单静态路由，收不到本页；
 *   - 所有数据为 fixture，不读取 Payload（避免预览页依赖 DB 状态）。
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'dev-story · OPT-036 列表页组件预览',
  description: '仅供开发环境使用的 OPT-036 列表页组件预览页',
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
// Fixture：ListingResultCard（Task 4）—— 覆盖两位小数 / 六位数元月 / 元工位月 /
// 缺图 / 缺价格 / 超长标题，六种情形与「跨卡小数点对齐」验收现场一一对应。
// ---------------------------------------------------------------------------

const CARD_COVER_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
      <rect width="400" height="300" fill="#c7c7cc"/>
      <text x="50%" y="50%" font-family="sans-serif" font-size="22" fill="#3a3a3c" text-anchor="middle" dominant-baseline="middle">封面示例</text>
    </svg>`,
  )

function cardPrice(
  amount: number,
  displayUnit: 'rmb-sqm-day' | 'rmb-month' | 'rmb-seat-month',
  text: string,
): PriceViewModel {
  const key = displayUnit === 'rmb-sqm-day'
    ? { period: 'day' as const, basis: 'sqm' as const }
    : displayUnit === 'rmb-seat-month'
      ? { period: 'month' as const, basis: 'seat' as const }
      : { period: 'month' as const, basis: 'total' as const }
  return { amount, currency: 'CNY', businessType: 'lease', ...key, displayUnit, text }
}

function makeCardFixture(
  overrides: Partial<ListingCardViewModel> & { id: number; slug: string; title: string },
): ListingCardViewModel {
  return {
    citySlug: 'shanghai',
    cityName: '上海市',
    price: cardPrice(8.5, 'rmb-sqm-day', '8.5 元/㎡/天'),
    area: 320,
    businessType: 'lease',
    decorationStatus: null,
    listingType: 'traditional-office',
    availableFrom: '2026-09-01',
    isFeatured: false,
    building: {
      citySlug: 'shanghai',
      cityName: '上海市',
      id: 1,
      slug: 'jing-an-center',
      name: '静安中心',
      address: '上海市静安区南京西路 1788 号',
      grade: 'grade-a',
      district: { id: 1, slug: 'jing-an', name: '静安区' },
      coverImage: { src: CARD_COVER_IMAGE, alt: '静安中心封面', width: 400, height: 300 },
    },
    coverImage: { src: CARD_COVER_IMAGE, alt: '示例房源封面', width: 400, height: 300 },
    highlights: ['可分割', '带家具'],
    stableSortKey: `${overrides.id}`.padStart(6, '0'),
    ...overrides,
  }
}

const CARD_FIXTURES: readonly Readonly<{ label: string; listing: ListingCardViewModel }>[] = [
  {
    label: '元/㎡/天 · 两位小数',
    listing: makeCardFixture({
      id: 101,
      slug: 'card-day-rate',
      title: '静安中心 12F 整层办公',
      price: cardPrice(8.5, 'rmb-sqm-day', '8.5 元/㎡/天'),
    }),
  },
  {
    label: '元/月 · 六位数（316,200）',
    listing: makeCardFixture({
      id: 102,
      slug: 'card-month-six-digit',
      title: '陆家嘴中心 8F 整层办公',
      price: cardPrice(316200, 'rmb-month', '316200 元/月'),
      listingType: 'full-floor',
    }),
  },
  {
    label: '元/工位/月',
    listing: makeCardFixture({
      id: 103,
      slug: 'card-seat-month',
      title: '共享办公 · 独立工位',
      price: cardPrice(2200, 'rmb-seat-month', '2200 元/工位/月'),
      listingType: 'coworking',
    }),
  },
  {
    label: '缺图（aspect-ratio 撑住 4:3）',
    listing: makeCardFixture({
      id: 104,
      slug: 'card-no-image',
      title: '无封面房源（占位灰底测试）',
      price: cardPrice(12.8, 'rmb-sqm-day', '12.8 元/㎡/天'),
      coverImage: null,
    }),
  },
  {
    label: '缺价格（整行省略定宽盒）',
    listing: makeCardFixture({
      id: 105,
      slug: 'card-no-price',
      title: '价格待面议房源',
      price: null,
    }),
  },
  {
    label: '超长标题（单行省略号）',
    listing: makeCardFixture({
      id: 106,
      slug: 'card-long-title',
      title: '陆家嘴金融核心区超甲级写字楼整层大面积精装修带独立电梯与全景落地窗房源出租',
      price: cardPrice(6.88, 'rmb-sqm-day', '6.88 元/㎡/天'),
    }),
  },
]

// ---------------------------------------------------------------------------
// Fixture：BuildingResultCard + BuildingCompactRow（Task 5）—— 覆盖有在租/无在租/
// 缺封面/超长楼名/缺地铁/缺等级（卡）与超长楼名/缺资料（紧凑行）。
// ---------------------------------------------------------------------------

const BUILDING_COVER_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250">
      <rect width="400" height="250" fill="#b8b8bd"/>
      <text x="50%" y="50%" font-family="sans-serif" font-size="20" fill="#3a3a3c" text-anchor="middle" dominant-baseline="middle">楼盘封面示例</text>
    </svg>`,
  )

function makeBuildingFixture(
  overrides: Partial<BuildingSummaryViewModel> & { id: number; slug: string; name: string },
): BuildingSummaryViewModel {
  return {
    citySlug: 'shanghai',
    cityName: '上海市',
    address: '上海市静安区南京西路 1266 号',
    grade: 'super-grade-a',
    district: { id: 1, slug: 'jing-an', name: '静安区' },
    nearestMetro: { id: 21, slug: 'jing-an-si', name: '静安寺站' },
    coverImage: { src: BUILDING_COVER_IMAGE, alt: '楼盘封面示例', width: 400, height: 250 },
    leasableArea: 18640,
    listingCount: 42,
    completionDate: '2001-06-01',
    typicalFloorArea: 1800,
    ...overrides,
  }
}

const BUILDING_CARD_FIXTURES: readonly Readonly<{ label: string; building: BuildingSummaryViewModel }>[] = [
  {
    label: '有在租（超甲级 · 套数两位数 42，定宽盒右对齐）',
    building: makeBuildingFixture({
      id: 201,
      slug: 'jing-an-kerry-centre',
      name: '静安嘉里中心',
      leasableArea: 18640,
      listingCount: 42,
    }),
  },
  {
    label: '无在租（防御性：套数与面积都缺，卡底数据行整行省略）',
    building: makeBuildingFixture({
      id: 202,
      slug: 'no-stock-building',
      name: '暂无在租楼盘示例',
      grade: 'grade-a',
      leasableArea: undefined,
      listingCount: undefined,
    }),
  },
  {
    label: '缺封面（16:10 撑住不塌陷 · 套数三位数 128 测试 36px 定宽盒）',
    building: makeBuildingFixture({
      id: 203,
      slug: 'no-cover-building',
      name: '无封面楼盘（占位灰底测试）',
      coverImage: undefined,
      leasableArea: 9720,
      listingCount: 128,
    }),
  },
  {
    label: '超长楼名（单行省略号，不撑宽同列）',
    building: makeBuildingFixture({
      id: 204,
      slug: 'long-name-building',
      name: '陆家嘴金融核心区超甲级综合体写字楼超长楼盘全称示例测试用例',
      grade: 'super-grade-a',
      leasableArea: 24180,
      listingCount: 8,
    }),
  },
  {
    label: '缺地铁（该行整行省略）',
    building: makeBuildingFixture({
      id: 205,
      slug: 'no-metro-building',
      name: '虹桥天地',
      nearestMetro: undefined,
      leasableArea: 21900,
      listingCount: 47,
    }),
  },
  {
    label: '缺等级（标签整个省略，不渲染空 pill）',
    building: makeBuildingFixture({
      id: 206,
      slug: 'no-grade-building',
      name: '西岸智慧谷',
      grade: undefined,
      leasableArea: 26410,
      listingCount: 51,
    }),
  },
]

const BUILDING_COMPACT_FIXTURES: readonly Readonly<{ label: string; building: BuildingSummaryViewModel }>[] = [
  {
    label: '暂无在租 · 资料齐全（等级 · 竣工年份 · 标准层面积）',
    building: makeBuildingFixture({
      id: 301,
      slug: 'vacant-hengrong-plaza',
      name: '恒隆广场',
      grade: 'super-grade-a',
      leasableArea: undefined,
      listingCount: undefined,
      completionDate: '2001-01-01',
      typicalFloorArea: 1800,
    }),
  },
  {
    label: '暂无在租 · 缺封面（占位色 #a1a1a6）',
    building: makeBuildingFixture({
      id: 302,
      slug: 'vacant-no-cover',
      name: '中信泰富广场',
      coverImage: undefined,
      grade: 'grade-a',
      leasableArea: undefined,
      listingCount: undefined,
      completionDate: '1996-01-01',
      typicalFloorArea: 1450,
    }),
  },
  {
    label: '暂无在租 · 超长楼名（单行省略号）',
    building: makeBuildingFixture({
      id: 303,
      slug: 'vacant-long-name',
      name: '浦东新区世纪大道超甲级综合体金融大厦超长楼盘全称示例测试用例',
      grade: 'grade-a',
      district: { id: 2, slug: 'pudong', name: '浦东新区' },
      leasableArea: undefined,
      listingCount: undefined,
      completionDate: '1999-01-01',
      typicalFloorArea: 2000,
    }),
  },
  {
    label: '暂无在租 · 缺资料（等级/竣工/标准层面积全缺，资料行整行省略）',
    building: makeBuildingFixture({
      id: 304,
      slug: 'vacant-no-meta',
      name: '资料待补充楼盘示例',
      grade: undefined,
      district: undefined,
      nearestMetro: undefined,
      leasableArea: undefined,
      listingCount: undefined,
      completionDate: undefined,
      typicalFloorArea: undefined,
    }),
  },
]

// ---------------------------------------------------------------------------
// Fixture：FilterFormC + FilterPill（Task 6）—— 覆盖全未选 / 多行已选（含底栏
// chip 与计数，且保留无关参数验证 href 只改一个参数）/ 单候选行 / 候选带
// count / 楼盘版 5 行（4 字标签，验证列宽自动收敛到约 70px，不靠硬编码 prop）/
// 多候选换行 / 隐藏行（0 候选）+ 清除全部彻底清空残留参数。
// ---------------------------------------------------------------------------

/**
 * 与楼盘列表.dc.html FG.loc 同一份 16 区数据（上海全部行政区，已是完整列表，
 * 不能再加「真实」候选项）。带上 count：验证换行不破版的同时，16 个纯 2 字
 * label（无 count）在标准容器宽度下量出来其实正好不换行——加 count 数字段
 * 才会稳定推过容器宽度触发换行，这本身也是「候选带 count」的另一个真实形态。
 */
const MANY_DISTRICT_OPTIONS: FilterRow['options'] = [
  { value: 'jingan', label: '静安', count: 42 },
  { value: 'huangpu', label: '黄浦', count: 28 },
  { value: 'xuhui', label: '徐汇', count: 33 },
  { value: 'changning', label: '长宁', count: 19 },
  { value: 'pudong', label: '浦东', count: 61 },
  { value: 'putuo', label: '普陀', count: 14 },
  { value: 'hongkou', label: '虹口', count: 9 },
  { value: 'yangpu', label: '杨浦', count: 22 },
  { value: 'minhang', label: '闵行', count: 17 },
  { value: 'baoshan', label: '宝山', count: 11 },
  { value: 'jiading', label: '嘉定', count: 8 },
  { value: 'songjiang', label: '松江', count: 13 },
  { value: 'qingpu', label: '青浦', count: 6 },
  { value: 'fengxian', label: '奉贤', count: 5 },
  { value: 'jinshan', label: '金山', count: 3 },
  { value: 'chongming', label: '崇明', count: 2 },
]

const LISTING_TYPE_ROW_OPTIONS: FilterRow['options'] = [
  { value: 'traditional-office', label: '传统办公', count: 86 },
  { value: 'full-floor', label: '整层办公', count: 24 },
  { value: 'coworking', label: '共享办公', count: 41 },
  { value: 'serviced-office', label: '独栋办公', count: 7 },
]

function listingFilterRows(overrides: Readonly<{
  district?: string
  type?: string
  priceBucket?: string
  areaBucket?: string
  decoration?: string
}>): readonly FilterRow[] {
  return [
    {
      key: 'district',
      label: '位置',
      activeValue: overrides.district,
      options: [
        { value: 'jingan', label: '静安' },
        { value: 'huangpu', label: '黄浦' },
        { value: 'xuhui', label: '徐汇' },
        { value: 'pudong', label: '浦东' },
      ],
    },
    {
      key: 'type',
      label: '类型',
      activeValue: overrides.type,
      options: LISTING_TYPE_ROW_OPTIONS,
    },
    {
      key: 'priceBucket',
      label: '价格',
      activeValue: overrides.priceBucket,
      options: [
        { value: 'lt-3', label: '3 元以下' },
        { value: '3-5', label: '3-5 元' },
        { value: '5-8', label: '5-8 元' },
        { value: 'gt-8', label: '8 元以上' },
      ],
    },
    {
      key: 'areaBucket',
      label: '面积',
      activeValue: overrides.areaBucket,
      options: [
        { value: 'lt-500', label: '500 ㎡以下' },
        { value: '500-2000', label: '500-2000 ㎡' },
        { value: 'gt-2000', label: '2000 ㎡以上' },
      ],
    },
    {
      // 只给一个候选：验证「某行只有一个候选」不会破版，也不需要特殊分支
      key: 'decoration',
      label: '装修',
      activeValue: overrides.decoration,
      options: [{ value: 'furnished', label: '精装带家具' }],
    },
  ]
}

const FILTER_FORM_C_LISTING_FIXTURES: readonly Readonly<{
  label: string
  rows: readonly FilterRow[]
  currentParams: URLSearchParams
  totalCount: number
}>[] = [
  {
    label: '全未选',
    rows: listingFilterRows({}),
    currentParams: new URLSearchParams(),
    totalCount: 168,
  },
  {
    label: '多行已选（底栏 chip + 计数；混入 sort=newest 与 page=3——验证选项 href 只改本行参数、且都删除 page）',
    rows: listingFilterRows({ district: 'jingan', type: 'coworking', priceBucket: '3-5' }),
    currentParams: new URLSearchParams([
      ['district', 'jingan'],
      ['type', 'coworking'],
      ['priceBucket', '3-5'],
      ['sort', 'newest'],
      ['page', '3'],
    ]),
    totalCount: 12,
  },
  {
    label: '装修行只有一个候选（精装带家具）',
    rows: listingFilterRows({}),
    currentParams: new URLSearchParams(),
    totalCount: 168,
  },
  {
    label: '类型行候选带 count（86 / 24 / 41 / 7）',
    rows: listingFilterRows({ type: 'traditional-office' }),
    currentParams: new URLSearchParams([['type', 'traditional-office']]),
    totalCount: 86,
  },
  {
    // 位置行候选换到真实规模（16 个区，与楼盘列表.dc.html FG.loc 同一份数据）：
    // 验证 flex-wrap 换行不破版，也不需要单独的多行样式分支。
    label: '位置行多候选换行（上海全部 16 个区，各带 count）',
    rows: listingFilterRows({}).map((row) =>
      row.key === 'district' ? { ...row, options: MANY_DISTRICT_OPTIONS } : row,
    ),
    currentParams: new URLSearchParams(),
    totalCount: 168,
  },
]

/**
 * 「隐藏行 + 清除全部彻底清空」夹具。
 *
 * metro 行 options 为空——按 visibleRows 过滤不会渲染，验证「无候选值的行不
 * 渲染」这条不变量的边界情形。但 currentParams 仍带着 metro=jingansi（真实
 * 场景：Task 11/12 按当前筛选算 facet，某维度当前 0 候选是正常结果，不代表
 * 它没有残留选中值）。「清除全部」必须把这个隐藏行的参数也删掉——这正是
 * code review 发现的 bug：buildClearAllHref 曾经传 visibleRows（过滤后的
 * 列表）会漏删 metro，现在传完整 rows。
 */
const HIDDEN_ROW_FIXTURE: Readonly<{
  rows: readonly FilterRow[]
  currentParams: URLSearchParams
  totalCount: number
}> = {
  rows: [
    ...listingFilterRows({ district: 'jingan' }),
    {
      key: 'metro',
      label: '地铁',
      activeValue: 'jingansi',
      options: [],
    },
  ],
  currentParams: new URLSearchParams([
    ['district', 'jingan'],
    ['metro', 'jingansi'],
  ]),
  totalCount: 34,
}

const BUILDING_FILTER_FORM_C_FIXTURE: Readonly<{
  rows: readonly FilterRow[]
  currentParams: URLSearchParams
  totalCount: number
}> = {
  rows: [
    {
      key: 'district',
      label: '位置',
      activeValue: 'jingan',
      options: [
        { value: 'jingan', label: '静安' },
        { value: 'huangpu', label: '黄浦' },
        { value: 'xuhui', label: '徐汇' },
      ],
    },
    {
      key: 'grade',
      label: '等级',
      options: [
        { value: 'super-grade-a', label: '超甲级' },
        { value: 'grade-a', label: '甲级' },
        { value: 'creative-park', label: '创意园区' },
      ],
    },
    {
      key: 'priceBucket',
      label: '价格',
      options: [
        { value: 'lt-3', label: '3 元以下' },
        { value: '3-5', label: '3-5 元' },
        { value: 'gt-5', label: '5 元以上' },
      ],
    },
    {
      key: 'leasableAreaMin',
      label: '在租面积',
      activeValue: '2000',
      options: [
        { value: '500', label: '500 ㎡以上' },
        { value: '2000', label: '2000 ㎡以上' },
        { value: '5000', label: '5000 ㎡以上' },
      ],
    },
    {
      key: 'completedAfter',
      label: '竣工',
      options: [
        { value: '2020', label: '2020 年后' },
        { value: '2010', label: '2010-2019' },
        { value: '2000', label: '2000-2009' },
      ],
    },
  ],
  currentParams: new URLSearchParams([
    ['district', 'jingan'],
    ['leasableAreaMin', '2000'],
  ]),
  totalCount: 24,
}

export default function Opt036PreviewPage() {
  // 生产环境直接 404，保证该路由只在开发环境可见
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <div className="ls-page">
      <div className="ls-container" style={{ paddingBlock: 32, display: 'flex', flexDirection: 'column', gap: 48 }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, lineHeight: 1.2, color: 'var(--ink)' }}>
            OPT-036 列表页组件预览
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.47, color: 'var(--ink-2)' }}>
            仅开发环境可见。组件任务完成即在此追加一个 <code>&lt;PreviewSection&gt;</code>，
            无需等待页面接线就能截图验收。卡片表面 / 图上渐变 / 图上标签一律复用
            <code> styles/surface.css</code> 的 <code>.sf-*</code> 基元。
          </p>
        </header>

        {/* 基元自检：确认 surface.css 已加载（后续任务不要删这一块） */}
        <PreviewSection
          id="surface-primitives"
          title="共享表面基元（.sf-*）"
          note="卡片 hover 抬升 2px / 320ms；图上渐变 rgba(0,0,0,.42) 底部 45%；标签 12/600 白底 92%"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            <span className="sf-card">
              <span className="sf-media sf-media--4x3">
                <span className="sf-scrim" aria-hidden="true" />
                <span style={{ position: 'absolute', left: 14, bottom: 12, display: 'flex', gap: 6 }}>
                  <span className="sf-phototag">4:3 房源</span>
                  <span className="sf-phototag sf-phototag--num">1,280 ㎡</span>
                </span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 20px 20px' }}>
                <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>.sf-media--4x3</span>
                <span className="ls-price">
                  <span className="ls-price__value ls-price__value--day">8.50</span>
                  <span className="ls-price__unit">元/㎡·天</span>
                </span>
              </span>
            </span>
            <span className="sf-card">
              <span className="sf-media sf-media--16x10">
                <span className="sf-scrim" aria-hidden="true" />
                <span style={{ position: 'absolute', left: 14, bottom: 12 }}>
                  <span className="sf-phototag">16:10 楼盘</span>
                </span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 20px 20px' }}>
                <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>.sf-media--16x10</span>
                <span className="ls-price">
                  <span className="ls-price__value ls-price__value--month">316,200</span>
                  <span className="ls-price__unit">元/月</span>
                </span>
              </span>
            </span>
          </div>
        </PreviewSection>

        <PreviewSection
          id="listing-card"
          title="房源卡（ListingResultCard）"
          note="4:3 · 定宽价格盒 · 无图/无价/长标题——6 张卡验证跨卡小数点对齐、缺图不塌陷、超长标题不挤压价格行"
        >
          {/* minmax(0, 1fr) 而非裸 1fr：超长标题的 white-space:nowrap 会把 min-content 撑到
              未截断的整行宽度，1fr 轨道默认 min-width:auto 会跟着被撑大——三列会一窄一窄一宽。
              minmax(0, 1fr) 显式清零最小宽度，配合 .ls-card__title 的 ellipsis 才能真正截断。 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
            {CARD_FIXTURES.map(({ label, listing }) => (
              <div key={listing.slug} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3, var(--ink-2))' }}>{label}</span>
                <ListingResultCard listing={listing} citySlug={listing.citySlug} />
              </div>
            ))}
          </div>
        </PreviewSection>

        <PreviewSection
          id="building-card"
          title="楼盘结果卡（BuildingResultCard）"
          note="16:10 · 等级标签无色相 · 在租套数 36px 定宽右对齐（两位数/三位数）+ 合计面积——覆盖有在租/无在租/缺封面/超长楼名/缺地铁/缺等级"
        >
          {/* minmax(0, 1fr)：同 listing-card 区块，防超长楼名撑宽同列（Task 4 踩过的坑） */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
            {BUILDING_CARD_FIXTURES.map(({ label, building }) => (
              <div key={building.slug} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3, var(--ink-2))' }}>{label}</span>
                <BuildingResultCard building={building} citySlug={building.citySlug} />
              </div>
            ))}
          </div>
        </PreviewSection>

        <PreviewSection
          id="building-compact-row"
          title="暂无在租紧凑行（BuildingCompactRow）"
          note="行高 64（在租卡约 182）——降权靠密度差不靠灰度，楼名保持满墨色不弱化"
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 16px' }}>
            {BUILDING_COMPACT_FIXTURES.map(({ label, building }) => (
              <div key={building.slug} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3, var(--ink-2))' }}>{label}</span>
                <BuildingCompactRow building={building} citySlug={building.citySlug} />
              </div>
            ))}
          </div>
        </PreviewSection>

        <PreviewSection
          id="filter-form-c"
          title="分行文本条件区（FilterFormC）"
          note="标签列宽度按当前渲染行的最长 label 自动定宽（CSS Grid，不写死 52/70）；选中态 accent-link/500，未选 ink——与下方 FilterPill 的零色相是两套不同规则；再点已选项即取消；底栏计数 tabular-nums，countNoun 必填（房源版「套」/ 楼盘版「个楼盘」），不给通用默认词"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {FILTER_FORM_C_LISTING_FIXTURES.map((fixture) => (
              <div key={fixture.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-3, var(--ink-2))' }}>{fixture.label}</span>
                <FilterFormC
                  rows={fixture.rows}
                  basePath="/shanghai/listings"
                  currentParams={fixture.currentParams}
                  totalCount={fixture.totalCount}
                  countNoun="套"
                />
              </div>
            ))}
            <div data-fixture="hidden-row-clear-all" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3, var(--ink-2))' }}>
                地铁行 0 候选（隐藏，不渲染）+ currentParams 残留 metro=jingansi——「清除全部」须一并删掉
              </span>
              <FilterFormC
                rows={HIDDEN_ROW_FIXTURE.rows}
                basePath="/shanghai/listings"
                currentParams={HIDDEN_ROW_FIXTURE.currentParams}
                totalCount={HIDDEN_ROW_FIXTURE.totalCount}
                countNoun="套"
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-3, var(--ink-2))' }}>
                楼盘版 5 行（位置/等级/价格/在租面积/竣工——4 字「在租面积」验证标签列自动收敛到约 70px）
              </span>
              <FilterFormC
                rows={BUILDING_FILTER_FORM_C_FIXTURE.rows}
                basePath="/shanghai/buildings"
                currentParams={BUILDING_FILTER_FORM_C_FIXTURE.currentParams}
                totalCount={BUILDING_FILTER_FORM_C_FIXTURE.totalCount}
                countNoun="个楼盘"
              />
            </div>
          </div>
        </PreviewSection>

        <PreviewSection
          id="filter-pill"
          title="筛选 pill（FilterPill）"
          note="激活态零色相：底 #1d1d1f 文字 #fff，不借助任何有色相的强调色；未选底 #fff 文字 ink-2——与上方 FilterFormC 行内文本选项（accent-link）是两套独立规则"
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <FilterPill href="#" label="推荐" active={false} />
            <FilterPill href="#" label="元/㎡/天" active count={1893} />
            <FilterPill href="#" label="更多筛选" active={false} count={3} />
          </div>
        </PreviewSection>

        {/* 后续任务在此追加 <PreviewSection id="..." title="..."> 区块 */}
      </div>
    </div>
  )
}
