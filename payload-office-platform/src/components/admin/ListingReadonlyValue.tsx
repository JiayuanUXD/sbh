'use client'

import React from 'react'
import { useField } from '@payloadcms/ui'

type Option = { label?: unknown; value?: unknown }

/**
 * 只读状态字段的展示态：「字段名 + 值 + ⓘ」，不是禁用输入框（OPT-032 §3.3-C7）。
 *
 * 审核状态 / 发布状态 / 供给可见性冻结 / 版本号这四项由流程驱动，运营永远改不了。
 * 渲染成禁用的下拉框会让人以为「点开能选，只是现在不让」——长得像控件却不可交互，
 * 是误导。改成字段名 + 值的纯文本，原来的 admin.description 收进 ⓘ 的 hover。
 *
 * 顺带省高：四项从四个 34px 控件行压成一行文本。
 */
export default function ListingReadonlyValue(props: {
  path?: string
  field?: {
    label?: unknown
    options?: Option[]
    admin?: { description?: unknown }
  }
}) {
  const path = props.path ?? ''
  const { value } = useField<unknown>({ path })

  const label = typeof props.field?.label === 'string' ? props.field.label : path
  const description =
    typeof props.field?.admin?.description === 'string' ? props.field.admin.description : ''

  // select 类字段存的是枚举值，展示要换成中文标签；number/text 直接显示。
  const options = Array.isArray(props.field?.options) ? props.field.options : []
  const matched = options.find((o) => o?.value === value)
  const display =
    matched && typeof matched.label === 'string'
      ? matched.label
      : value === null || value === undefined || value === ''
        ? '—'
        : String(value)

  return (
    <div className="listing-readonly">
      <span className="listing-readonly__key">
        {label}
        {description ? (
          <i className="listing-readonly__info" title={description} aria-label={description}>
            i
          </i>
        ) : null}
      </span>
      <span className="listing-readonly__value">{display}</span>
    </div>
  )
}
