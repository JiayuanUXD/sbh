import React from 'react'
import type { SpecRow } from './SpecTable'

/**
 * 无图替代构图 —— 房源没有可用媒体时顶替画廊、接管首屏的关键规格展示。
 *
 * 背景（见 DetailGallery.tsx 顶部注释）：无媒体是常态而非异常，图片质量本身
 * 也不可控（商户上传、尺寸色温水印不统一）。所以“没有图”时不是退化成一块
 * 灰底占位图，而是换一种构图——用可核实的结构化数据本身来回答“值不值得
 * 约看”，信息密度必须能顶替一张首屏大图。
 *
 * 设计依据：docs/SBH设计任务讨论/房源详情.dc.html「无图替代构图」
 * （specRows：关键规格 3×2 宫格，值 32/600 + 地址交通条）。
 *
 * 字段来源（调用方负责，本组件只管渲染，不做兜底编造）：
 *   - keySpecs 六项全部来自 ListingDetailViewModel 顶层字段或其 building
 *     子对象，不解析 factGroups 里已拼接 suffix 的字符串——那些是「键值行」
 *     的格式，不是这里需要的「大数值 + 独立单位」格式。逐字段可达性见
 *     CityListingDetailView.tsx 调用处注释与 task-2-report.md。
 *   - address / transit 缺失时必须传 null，由本组件渲染为 —，不允许调用方
 *     用别的字段顶替或拼出不存在的信息（如编造步行距离）。
 */
export default function NoImageHeroGrid({
  title,
  keySpecs,
  address,
  transit,
}: Readonly<{
  /** 用于可访问性说明文字，不在视觉上重复渲染。 */
  title: string
  /** 恰好六项；由调用方按页面类型选定，本组件不关心具体是哪六个字段。 */
  keySpecs: readonly SpecRow[]
  address: string | null
  transit: string | null
}>) {
  return (
    <section
      className="dt-panel dt-panel--full dt-nomedia"
      aria-label={`${title} 关键规格（暂无实景图片）`}
      data-media-state="missing"
    >
      <p className="visually-hidden">{title} 暂无实景图片，以下为关键规格与地址交通信息</p>
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
      <div className="dt-nomedia__meta">
        <div className="dt-nomedia__meta-item">
          <span className="dt-nomedia__meta-label">地址</span>
          <span className="dt-nomedia__meta-value">{address ?? '—'}</span>
        </div>
        <div className="dt-nomedia__meta-item">
          <span className="dt-nomedia__meta-label">交通</span>
          <span className="dt-nomedia__meta-value">{transit ?? '—'}</span>
        </div>
      </div>
    </section>
  )
}
