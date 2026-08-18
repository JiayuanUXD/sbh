'use client'

import React from 'react'
import { useDocumentInfo } from '@payloadcms/ui'

/**
 * 「房源标题」输入框右侧的 URL 标识图标（OPT-032 §3.3-C8）。
 *
 * 挂在 title 的 `admin.components.afterInput` 上，只读展示同文档的 slug，
 * hover 出「URL 标识: <值>」。这样 slug 不再占一个表单格子，省下的高度与
 * 完全隐藏它一样多，但运营仍能核对生成结果（slug 进前台 URL，发布后不该再改）。
 *
 * slug 字段本体用 `admin.disabled: true`（四种写法的取舍见 Listings.ts 上的注释）。
 * 它不进表单状态，所以这里**不能用 `useField`**，改读 `useDocumentInfo().data`——
 * 那是已保存的文档数据，正好符合语义：slug 由服务端 hook 生成，新建未保存时本就没有值。
 *
 * `required: true` 与 NOT NULL 都不用动，无迁移；服务端 hook 的 `ensureUniqueSlug`
 * 去重照常跑（新建时提交的 slug 为空，hook 才会生成）。
 */
export default function ListingSlugBadge() {
  const { data } = useDocumentInfo()
  const raw = (data as { slug?: unknown } | undefined)?.slug
  const slug = typeof raw === 'string' ? raw.trim() : ''

  // 新建未保存时 slug 由服务端 hook 生成，此刻本就没有值，不占位。
  if (!slug) return null

  return (
    <span className="listing-slug-badge" title={`URL 标识: ${slug}`} aria-label={`URL 标识 ${slug}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </svg>
    </span>
  )
}
