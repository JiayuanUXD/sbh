import React from 'react'

/**
 * 房源编辑表单的分节标题（OPT-032 §3.3-A1）。
 *
 * 为什么是 `ui` 字段而不是 `collapsible`：
 * 原来的四个 tab 合并进「房源信息」后需要视觉分节，Payload 现成的容器只有
 * `collapsible`，但它带折叠箭头、点标题会收起，且折叠态持久化到用户 preferences——
 * 一旦被收起，`ListingVisibilityCardClient` 的点击定位就滚不到目标字段
 * （Collapsible 折叠时仍渲染 children，只是套 height: 0，label 找得到却不可见）。
 * 定稿方案要的只是一条标题 + 说明 + 分隔线，不需要折叠语义，所以用纯展示的 ui 字段。
 *
 * 无 name、不进表单状态、不影响数据路径与 schema。
 */
export default function ListingFormSectionHeading({
  title,
  description,
}: {
  title?: string
  description?: string
}) {
  if (!title) return null
  return (
    <div className="listing-form-section" data-section={title}>
      <h3 className="listing-form-section__title">{title}</h3>
      {description ? <p className="listing-form-section__desc">{description}</p> : null}
    </div>
  )
}
