import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import BuildingCompactRow from '@/components/frontend/listing/BuildingCompactRow'
import BuildingResultCard from '@/components/frontend/listing/BuildingResultCard'
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
    label: '暂无在租 · 资料齐全',
    building: makeBuildingFixture({
      id: 301,
      slug: 'vacant-hengrong-plaza',
      name: '恒隆广场',
      grade: 'super-grade-a',
      leasableArea: undefined,
      completionDate: '2001-01-01',
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
      completionDate: '1996-01-01',
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
      completionDate: '1999-01-01',
    }),
  },
  {
    label: '暂无在租 · 缺资料（等级/区域/竣工全缺，资料行整行省略）',
    building: makeBuildingFixture({
      id: 304,
      slug: 'vacant-no-meta',
      name: '资料待补充楼盘示例',
      grade: undefined,
      district: undefined,
      nearestMetro: undefined,
      leasableArea: undefined,
      completionDate: undefined,
    }),
  },
]

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

        {/* 后续任务在此追加 <PreviewSection id="..." title="..."> 区块 */}
      </div>
    </div>
  )
}
