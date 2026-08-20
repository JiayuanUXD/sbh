import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

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

        {/* 后续任务在此追加 <PreviewSection id="..." title="..."> 区块 */}
      </div>
    </div>
  )
}
