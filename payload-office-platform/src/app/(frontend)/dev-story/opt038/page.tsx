import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import RecruitHero from '@/components/frontend/city-partner/RecruitHero'

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
          Task 2 起 Hero 已是真组件（三档文案并排）。虚线框是留给 Task 3–5 的槽位。
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
        id="rc-skeleton-core"
        title="骨架 · 方案 A 两栏（.rc-core / .rc-aside）"
        note="灰底带（本项目 --bg）· 主栏 minmax(0,1fr) 推导为 552 · 表单卡列定宽 400 · 列间 72 · 右列 sticky top calc(44+24)=68。主栏占位刻意做高，向下滚动即可看到粘附行为；≤1023 塌单栏并取消 sticky。"
      >
        <div className="rc-section rc-section--band">
          <div className="rc-container">
            <div className="rc-core">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
                <Slot label="Task 3 · h2「我们带给合伙人什么」+ 3 条价值点（序号 .sf-num · 条间 hairline）" minHeight={200} />
                <Slot label="主栏占位（拉高以验证右列粘附区间）" minHeight={320} />
                <Slot label="主栏占位（拉高以验证右列粘附区间）" minHeight={320} />
              </div>
              <aside className="rc-aside">
                <Slot label="Task 3 · 表单卡 400 宽 · padding 40 · radius 18 · sticky top 68（本页无 56 吸附条，故不是详情页的 116）" minHeight={420} />
              </aside>
            </div>
          </div>
        </div>
      </PreviewSection>

      <PreviewSection
        id="rc-skeleton-districts"
        title="骨架 · 商圈布局段（.rc-section）"
        note="白底 · 引导语同样受 .rc-measure 约束 · 3 列 gap 48/24 的网格属 Task 4，本任务不铺"
      >
        <div className="rc-section">
          <div className="rc-container" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="rc-measure" style={{ width: '100%' }}>
              <Slot label="Task 4 · h2 + 引导语（≤702）" minHeight={80} />
            </div>
            <Slot label="Task 4 · 商圈网格 3 列 · gap 48/24 → 列宽 325.33" minHeight={180} />
          </div>
        </div>
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
