import React from 'react'
import type { SpecRow } from './SpecTable'

/**
 * 无图替代构图 —— 详情页没有可用媒体时顶替画廊、接管首屏的关键规格展示。
 * 房源详情（Task 2）与楼盘详情（Task 10b）共用这一份。
 *
 * 背景（见 DetailGallery.tsx 顶部注释）：无媒体是常态而非异常，图片质量本身
 * 也不可控（商户上传、尺寸色温水印不统一）。所以“没有图”时不是退化成一块
 * 灰底占位图，而是换一种构图——用可核实的结构化数据本身来回答“值不值得
 * 约看”，信息密度必须能顶替一张首屏大图。
 *
 * 设计依据：docs/SBH设计任务讨论/房源详情.dc.html「无图替代构图」
 * （specRows：关键规格 3×2 宫格，值 32/600 + 补充信息条）。楼盘详情稿没有
 * 对应章节，楼盘页沿用同一构图（判定与理由见 task-10b-report.md）。
 *
 * ── 为什么底部信息条是 `meta: MetaItem[]` 而不是固定的 address/transit ──
 * 首版（房源页）把它写死成「地址 / 交通」两格。楼盘页接入时这条写死会
 * **在同一屏里重复一遍右侧信息面板**：`HeroSummaryPanel` 就在 32px 之外
 * 渲染着「地址」「地铁」两行。底条要放什么，取决于**这一页旁边已经说了
 * 什么**，只有调用方知道——所以它是参数，不是常量。房源页照旧传
 * 「地址 / 交通」，DOM 与首版逐字节一致。
 *
 * 字段来源（调用方负责，本组件只管渲染，不做兜底编造）：
 *   - keySpecs / meta 全部来自各自页面的详情 DTO；数值型规格走
 *     `factMagnitude`（mapper 同源产出的数值/单位两半），**不解析**
 *     factGroups 里已拼好后缀的展示串。逐字段可达性见两个调用处的注释与
 *     task-2-report.md / task-10b-report.md。
 *   - 值缺失时必须传 null，由本组件渲染为 —，不允许调用方用别的字段顶替
 *     或拼出不存在的信息（如编造步行距离）。
 */

export type NoImageMetaItem = Readonly<{ label: string; value: string | null }>

export default function NoImageHeroGrid({
  title,
  keySpecs,
  meta,
}: Readonly<{
  /** 用于可访问性说明文字，不在视觉上重复渲染。 */
  title: string
  /** 由调用方按页面类型选定，本组件不关心具体是哪几个字段。 */
  keySpecs: readonly SpecRow[]
  /** 底部补充信息条；空数组时整条不渲染（不留一条只有标签的空条）。 */
  meta: readonly NoImageMetaItem[]
}>) {
  return (
    <section
      className="dt-panel dt-panel--full dt-nomedia"
      aria-label={`${title} 关键规格（暂无实景图片）`}
      data-media-state="missing"
    >
      <p className="visually-hidden">{title} 暂无实景图片，以下为关键规格与补充信息</p>
      <div className="dt-nomedia__head">
        <span className="dt-nomedia__title">关键规格</span>
      </div>
      <div className="dt-keyspecs">
        {keySpecs.map((spec) => (
          <div key={spec.label} className="dt-keyspecs__item">
            <span className="dt-keyspecs__label">{spec.label}</span>
            <span className="dt-keyspecs__value-row">
              <span className="dt-keyspecs__value">{spec.value ?? '—'}</span>
              {spec.value != null && spec.unit ? (
                <span className="dt-keyspecs__unit">{spec.unit}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      {meta.length > 0 && (
        <div className="dt-nomedia__meta">
          {meta.map((item) => (
            <div key={item.label} className="dt-nomedia__meta-item">
              <span className="dt-nomedia__meta-label">{item.label}</span>
              <span className="dt-nomedia__meta-value">{item.value ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
