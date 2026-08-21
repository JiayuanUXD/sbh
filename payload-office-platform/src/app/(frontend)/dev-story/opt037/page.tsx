import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import DetailGallery from '@/components/frontend/DetailGallery'
import DetailPanel from '@/components/frontend/detail/DetailPanel'
import ListingOverviewPanel from '@/components/frontend/detail/ListingOverviewPanel'
import SpecTable, { type SpecRow } from '@/components/frontend/detail/SpecTable'
import type {
  DetailMediaViewModel,
  FactGroupViewModel,
  FactValue,
  PriceViewModel,
} from '@/domain/public-catalog/contracts'

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
      overviewFact('物业费金额', null),
      overviewFact('物业费', null),
      overviewFact('发票', null),
    ],
  },
]

export default function Opt037PreviewPage() {
  // 生产环境直接 404，保证该路由只在开发环境可见
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

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
          note="通栏 · 组间距 40 · 组区分只用间距 + 组标签（不用顶线不用色块）；三态：字段齐全 / 组内部分缺失（含「可入驻」的既有「面议」兜底与「物业费」金额→类别的退回）/ 整组缺失（费用明细两行全 —，组仍渲染）"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>字段齐全</span>
              <ListingOverviewPanel
                listing={{ factGroups: OVERVIEW_FULL_GROUPS, price: OVERVIEW_PRICE_FULL, availableFrom: '2026-09-01T00:00:00.000Z' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>部分缺失（组内夹杂 null）</span>
              <ListingOverviewPanel
                listing={{ factGroups: OVERVIEW_PARTIAL_GROUPS, price: null, availableFrom: null }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)' }}>整组缺失（费用明细）</span>
              <ListingOverviewPanel
                listing={{
                  factGroups: OVERVIEW_GROUP_MISSING_GROUPS,
                  price: OVERVIEW_PRICE_GROUP_MISSING,
                  availableFrom: '2026-10-15T00:00:00.000Z',
                }}
              />
            </div>
          </div>
        </PreviewSection>

        {/* 后续任务在此追加 <PreviewSection id="..." title="..."> 区块 */}
      </div>
    </div>
  )
}
