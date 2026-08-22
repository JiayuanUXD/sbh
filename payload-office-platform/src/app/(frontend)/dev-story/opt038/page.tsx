import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import CityPartnerApplicationForm from '@/components/frontend/city-partner/CityPartnerApplicationForm'
import RecruitHero from '@/components/frontend/city-partner/RecruitHero'
import RecruitValueProps from '@/components/frontend/city-partner/RecruitValueProps'
import RecruitDistrictGrid, {
  type RecruitDistrict,
} from '@/components/frontend/city-partner/RecruitDistrictGrid'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'

/**
 * 表单预览用的城市 fixture（不读 Payload，符合本页「所有数据为 fixture」的约定）。
 * 两项而非一项：城市下拉必须能真的展开选择，否则「申请城市」这一档外观走查
 * 只能看到一个恒定单选项。
 */
const PREVIEW_CITIES: readonly PublicCityOption[] = [
  { slug: 'hangzhou', name: '杭州', serviceStatus: 'coming-soon', sortOrder: 20 },
  { slug: 'shanghai', name: '上海', serviceStatus: 'live', sortOrder: 10 },
]

/**
 * 商圈 fixture：**照本地库上海 profile 的真实 `featuredRegions` 形态构造**
 * （名称与区域介绍取自 locations 表 #2–#11，见
 * scripts/verification/opt038-featured-regions-depth-probe.ts 的实测输出）。
 *
 * 刻意混了三种区位副标形态，让「缺失怎么显示」在预览页上一眼可读：
 *   - business_area：parentName（上级行政区）+ description 两段都在 → 「静安区 · ……」
 *   - district：parent 就是城市本身 → parentName 恒为 null，只剩 description
 *   - 最后一条两段都缺 → **整行不渲染**（不是一个「—」）
 */
const PREVIEW_DISTRICTS: readonly RecruitDistrict[] = [
  { id: 4, slug: 'nanjing-west-road', name: '南京西路', type: 'business_area', parentName: '静安区', description: '上海高端商务、零售与企业总部办公核心商圈。' },
  { id: 5, slug: 'lujiazui', name: '陆家嘴', type: 'business_area', parentName: '浦东新区', description: '金融、专业服务与跨国企业总部办公核心区域。' },
  { id: 9, slug: 'the-bund', name: '外滩', type: 'business_area', parentName: '黄浦', description: '外滩金融集聚带，历史建筑与现代办公融合。' },
  { id: 2, slug: 'jingan', name: '静安区', type: 'district', parentName: null, description: '南京西路、苏河湾等高端商务办公聚集区。' },
  { id: 3, slug: 'pudong', name: '浦东新区', type: 'district', parentName: null, description: '陆家嘴、前滩等总部型企业办公聚集区。' },
  { id: 11, slug: 'hongqiao', name: '虹桥', type: 'business_area', parentName: null, description: null },
]

/**
 * OPT-038 城市招募页组件预览（仅开发环境）
 *
 * 存在理由：与 OPT-036 / OPT-037 的预览页同一动机——组件任务完成即可在此追加
 * 一个 `<PreviewSection>` 截图验收，不必等到 Task 5 整页接线完成。
 *
 * ⚠️ 本页在 `next start`（NODE_ENV=production）下**按设计 404**（下方
 * `notFound()`）。它是本地 dev 下的组件预览，**不是验证证据**：
 * 拿它做前后截图对比，比出来的是两张 404 页（前一批真出过「四档 0 差异像素」
 * 的空结论）。四断点验收要打的是真实路由 `/city-partner` 与 `/[city]`。
 *
 * 追加区块的方式（后续任务照抄三行即可，不要改本页其它部分）：
 *
 *   <PreviewSection id="recruit-hero" title="Hero（RecruitHero）"
 *     note="标题 56/600/1.07 · 副标 21/400/1.38/+0.011em">
 *     <RecruitHero … />
 *   </PreviewSection>
 *
 * 守护不变量（与既有 dev-story 页一致）：
 *   - 仅开发环境可用，生产环境直接 404；
 *   - metadata 标记 noindex,nofollow；
 *   - robots.ts 已 disallow `/dev-story`（前缀匹配，覆盖本子路由），
 *     sitemap.ts 只枚举白名单静态路由与查询得到的实体 URL，不会扫到本路由；
 *   - 所有数据为 fixture，不读取 Payload。
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'dev-story · OPT-038 城市招募页组件预览',
  description: '仅供开发环境使用的 OPT-038 城市招募页组件预览页',
  robots: { index: false, follow: false },
}

/**
 * 预览区块外壳：统一标题/说明/分隔，使「加一个组件」= 加一个 `<PreviewSection>`。
 *
 * 与 opt037 版的唯一差别：标题与说明包了一层 `.rc-container`。那边的外壳整个
 * 活在 `.dt-container` 里，这边的被预览物本身就是**满幅背景带**（`.rc-section`），
 * 不能再被一层容器夹住，于是容器下沉到外壳内部的文字部分。
 */
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
      style={{ paddingTop: 24, borderTop: '1px solid var(--line)' }}
    >
      <div className="rc-container" style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 16 }}>
        <h2 id={`${id}-title`} style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>{title}</h2>
        {note ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.43, color: 'var(--ink-2)' }}>{note}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** 骨架占位块：虚线框标出「这一格由哪个任务填」，本身不带任何生产样式。 */
function Slot({ label, minHeight = 96 }: Readonly<{ label: string; minHeight?: number }>) {
  return (
    <div
      style={{
        minHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 16,
        border: '1px dashed var(--line-strong)',
        borderRadius: 'var(--r-card)',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--ink-2)',
      }}
    >
      {label}
    </div>
  )
}

export default function Opt038PreviewPage() {
  // 生产环境直接 404，保证该路由只在开发环境可见
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return (
    <div className="rc-page">
      <div className="rc-container" style={{ paddingBlock: 32, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, lineHeight: 1.2, color: 'var(--ink)' }}>
          OPT-038 城市招募页组件预览
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.47, color: 'var(--ink-2)' }}>
          仅开发环境可见。Task 1 骨架：容器 <code>1024</code>、正文栏宽上限 <code>702</code>、
          方案 A 两栏 <code>552 / 400</code> 列间 <code>72</code>、section padding-block{' '}
          <code>72</code>（段间 <code>144</code>）、表单卡 <code>sticky top 68</code>。
          Task 2 起 Hero、Task 3 起价值点与表单卡、Task 4 起商圈布局已是真组件。
          虚线框是留给 Task 5 的槽位。
          本页会出现多个 <code>h1</code>（外壳一个 + 每档 Hero 一个），
          这是并排预览的必然结果，<strong>不是</strong>真实路由的形态——
          真实页面每页只有一个 h1（<code>tests/city-partner-page-seo.test.ts:37</code> 锁着）。
        </p>
      </div>

      <PreviewSection
        id="rc-hero-city"
        title="Hero · 城市面文案（RecruitHero）"
        note="白底（本项目 --bg-subtle）· padding-block 72 · 眉标 pill 12/500 零色相 · h1 56/600/1.07/normal（≤767 收 40）· 副标 21/400/1.38/+0.011em 且受 .rc-measure(702) 约束。⚠️ 眉标没有「第 N 城」：序数在数据链路里不存在，理由见 RecruitHero.tsx 的 RECRUIT_HERO_EYEBROW 注释。"
      >
        <RecruitHero
          titleId="rc-hero-city-title"
          title="商办租赁即将登陆杭州，诚邀本地城市合伙人"
          subtitle="面向资深经纪人、本地商办代理机构、园区与楼宇运营方开放合作席位。"
        />
      </PreviewSection>

      <PreviewSection
        id="rc-hero-neutral"
        title="Hero · 全局面文案 + 超长城市名（RecruitHero）"
        note="/city-partner 是全局 canonical，默认城市已开通，文案走中性口径。这里同时压一条最长城市名（乌鲁木齐）看标题折行：text-wrap: balance 自动配平，不依赖稿子里那个手写 <br>。"
      >
        <RecruitHero
          titleId="rc-hero-neutral-title"
          title="商办租赁诚邀乌鲁木齐本地城市合伙人"
          subtitle="面向资深经纪人、本地商办代理机构、园区与楼宇运营方开放合作席位。"
        />
      </PreviewSection>

      <PreviewSection
        id="rc-hero-minimal"
        title="Hero · 空态（无副标 / 无眉标）"
        note="副标缺失整段不渲染、眉标传空串整体去掉 pill——不留空行占位，也不塞占位文案。"
      >
        <RecruitHero titleId="rc-hero-minimal-title" title="诚邀本地城市合伙人" eyebrow="" />
      </PreviewSection>

      <PreviewSection
        id="rc-core"
        title="方案 A 两栏 · 价值点 + sticky 表单卡（RecruitValueProps / CityPartnerApplicationForm）"
        note="灰底带（本项目 --bg）· 主栏 minmax(0,1fr) 推导为 552 · 表单卡列定宽 400 · 列间 72 · 右列 sticky top calc(44+24)=68（本页无 56 吸附条，故不是详情页的 116）。表单是真组件：提交链路一行未改，只在 .rc-page 作用域内换外观。主栏下方补了占位块把左列拉高，否则左列比卡还矮、sticky 无位移余量（那不是失效，是 sticky 的定义）。≤1023 塌单栏并取消 sticky。"
      >
        <div className="rc-section rc-section--band">
          <div className="rc-container">
            <div className="rc-core">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
                <RecruitValueProps titleId="rc-core-title" />
                <Slot label="主栏占位（拉高以验证右列粘附区间；正式页面由商圈段等真实内容承担）" minHeight={320} />
                <Slot label="主栏占位（拉高以验证右列粘附区间）" minHeight={320} />
              </div>
              <aside className="rc-aside">
                <CityPartnerApplicationForm
                  cities={PREVIEW_CITIES}
                  initialCity="hangzhou"
                  invalidExplicitCity={false}
                />
              </aside>
            </div>
          </div>
        </div>
      </PreviewSection>

      <PreviewSection
        id="rc-vp-empty"
        title="价值点 · 空态（points 传空数组）"
        note="整段不渲染——连 h2 都不留，避免出现一个只剩标题的空货架。下方除了本外壳的标题与分隔线之外应当空无一物。"
      >
        <div className="rc-section rc-section--band">
          <div className="rc-container">
            <RecruitValueProps points={[]} />
          </div>
        </div>
      </PreviewSection>

      <PreviewSection
        id="rc-districts"
        title="商圈布局（RecruitDistrictGrid）"
        note="白底（本项目 --bg-subtle）· h2 挂 .hm-h2（40/600/1.10，≤767 收 32）· 引导语 21/400/1.38/+0.011em 且受 .rc-measure(702) 约束 · 网格 3 列 row-gap 48 / column-gap 24 → 列宽 (1024−48)/3 = 325.33 · 每格行顶 1px --line + padding-top 20 · 商圈名 24/600/1.2 · 区位 17/400/1.47 --ink-2。⚠️ 六个商圈统一渲染、没有「首批上线 / 筹备中」状态 pill：整条数据链路没有招募位状态这个维度，理由见 RecruitDistrictGrid.tsx 文件头。最后一条（虹桥）两段区位都缺 → 整行不渲染，不写「—」。"
      >
        <RecruitDistrictGrid
          titleId="rc-districts-title"
          cityName="上海"
          districts={PREVIEW_DISTRICTS}
        />
      </PreviewSection>

      <PreviewSection
        id="rc-districts-empty"
        title="商圈布局 · 空态（districts 传空数组）"
        note="无 featuredRegions 的城市：整段不渲染——连 h2 与引导语都不留，不摆空货架。下方除本外壳的标题与分隔线外应当空无一物。"
      >
        <RecruitDistrictGrid cityName="嘉兴" districts={[]} />
      </PreviewSection>

      <PreviewSection
        id="rc-skeleton-tail"
        title="骨架 · 次要入口段（.rc-section--tail）"
        note="稿子明写「作为上一段的尾注」：padding-top 归零，与商圈段的间距 = 1×72 而非 2×72；padding-bottom 保留一份 72"
      >
        <div className="rc-section rc-section--tail">
          <div className="rc-container">
            <Slot label="Task 5 · 「您是需要在本市寻租办公室的企业？」+ 次级 pill 按钮（padding 11/21 · 1px --line-strong）" minHeight={120} />
          </div>
        </div>
      </PreviewSection>
    </div>
  )
}
