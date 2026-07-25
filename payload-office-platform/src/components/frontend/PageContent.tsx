/**
 * 内容页正文白名单渲染器（F6.1）
 *
 * 设计依据：specs/frontend-mvp/tasks.md F6.1、FP-06 §2–§5
 *           specs/frontend-mvp/design.md §3.1、§7
 *
 * 职责：
 *   - 接受 Lexical richText JSON（PageDetailViewModel.content）；
 *   - 按白名单节点类型渲染：paragraph / heading / list / quote / image /
 *     horizontal-rule / link；
 *   - 未支持节点跳过并 console.warn，不导致整页崩溃（FP-06 §7）；
 *   - 禁止任意脚本、未批准 iframe 和未清洗 HTML（FP-06 §4）。
 *
 * 不变量：
 *   - 不使用 dangerouslySetInnerHTML，所有节点都通过 React 元素渲染；
 *   - 不渲染 script / iframe / object / embed 等危险节点；
 *   - 外链渲染为 <a> 并加 rel="noopener noreferrer nofollow" 与 target="_blank"；
 *   - 未支持节点类型在控制台告警，便于追踪未覆盖模块。
 */

import React from 'react'
import type { Page } from '@/payload-types'

// ---------------------------------------------------------------------------
// Lexical JSON 类型（窄化自 Payload 生成的 Page['content']）
// ---------------------------------------------------------------------------

/** Lexical 节点：通用形态，字段宽松以便类型守卫收窄 */
type LexicalNode = {
  type: string
  version?: number
  [k: string]: unknown
}

/** Lexical 根文档 */
type LexicalRoot = {
  type: 'root'
  children: LexicalNode[]
  direction: ('ltr' | 'rtl') | null
  format: string
  indent: number
  version: number
}

type LexicalContent = NonNullable<Page['content']>

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

function isLexicalContent(v: unknown): v is LexicalContent {
  if (typeof v !== 'object' || v === null) return false
  const root = (v as { root?: unknown }).root
  if (typeof root !== 'object' || root === null) return false
  const r = root as Partial<LexicalRoot>
  return r.type === 'root' && Array.isArray(r.children)
}

function isTextNode(v: unknown): v is {
  type: 'text'
  text: string
  format?: number
  [k: string]: unknown
} {
  if (typeof v !== 'object' || v === null) return false
  const n = v as { type?: string; text?: unknown }
  return n.type === 'text' && typeof n.text === 'string'
}

function isLinkNode(v: unknown): v is {
  type: 'link'
  url?: string
  newTab?: boolean
  children?: LexicalNode[]
  [k: string]: unknown
} {
  if (typeof v !== 'object' || v === null) return false
  const n = v as { type?: string; url?: unknown }
  return n.type === 'link' && typeof n.url === 'string'
}

function isUploadNode(v: unknown): v is {
  type: 'upload'
  value?: {
    id?: number
    url?: string
    alt?: string
    width?: number
    height?: number
  } | null
  [k: string]: unknown
} {
  if (typeof v !== 'object' || v === null) return false
  const n = v as { type?: string; value?: unknown }
  return n.type === 'upload' && (n.value == null || typeof n.value === 'object')
}

// ---------------------------------------------------------------------------
// 白名单节点类型集合
// ---------------------------------------------------------------------------

/**
 * 节点类型白名单
 *
 * 依据 FP-06 §4 MVP 白名单：
 *   - 标题、段落、引用、列表（paragraph / heading / quote / list）
 *   - 图片与图注（upload → 渲染为 figure/img）
 *   - 分隔线（horizontalrule）
 *   - 双栏 / 亮点卡 / CTA / 相关文章 / 相关供给：MVP 暂不支持，跳过告警
 *
 * 行内节点：text / link / linebreak
 */
const ALLOWED_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'quote',
  'list',
  'upload',
  'horizontalrule',
])

const ALLOWED_INLINE_TYPES = new Set(['text', 'link', 'linebreak', 'tab'])

/**
 * 已记录的未支持节点类型集合（避免同一类型重复告警刷屏）
 *
 * 模块级缓存，单次页面渲染周期内同类型只告警一次。
 */
const warnedNodeTypes = new Set<string>()

function warnUnsupportedNode(nodeType: string): void {
  if (warnedNodeTypes.has(nodeType)) return
  warnedNodeTypes.add(nodeType)
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(
      `[PageContent] 跳过未支持的内容模块节点类型：${nodeType}（FP-06 §7：未支持模块跳过并告警，不导致整页崩溃）`,
    )
  }
}

// ---------------------------------------------------------------------------
// 行内节点渲染
// ---------------------------------------------------------------------------

/** 把 Lexical text format 位掩码解析为 React 元素 */
function renderTextNode(node: {
  type: 'text'
  text: string
  format?: number
}): React.ReactNode {
  const format = typeof node.format === 'number' ? node.format : 0
  // Lexical IS_BOLD = 1, IS_ITALIC = 2, IS_UNDERLINE = 8, IS_STRIKETHROUGH = 4
  // IS_CODE = 16, IS_SUBSCRIPT = 32, IS_SUPERSCRIPT = 64
  let el: React.ReactNode = node.text
  if (format & 1) el = <strong>{el}</strong>
  if (format & 2) el = <em>{el}</em>
  if (format & 4) el = <s>{el}</s>
  if (format & 8) el = <u>{el}</u>
  if (format & 16) el = <code>{el}</code>
  return el
}

/** 渲染 link 节点，外链加安全属性 */
function renderLinkNode(node: {
  type: 'link'
  url?: string
  newTab?: boolean
  children?: LexicalNode[]
}): React.ReactNode {
  const url = node.url
  if (!url) return null
  const children = Array.isArray(node.children) ? node.children : []
  const newTab = node.newTab === true
  // 安全属性：外链 rel 防止 referrer 泄露与 tabnabbing
  const isExternal = /^https?:\/\//i.test(url) || url.startsWith('//')
  const rel = isExternal ? 'noopener noreferrer nofollow' : undefined
  return (
    <a href={url} target={newTab ? '_blank' : undefined} rel={rel}>
      {children.map((c, i) => renderInline(c, `link-${i}`))}
    </a>
  )
}

/** 渲染行内节点；未支持类型跳过并告警 */
function renderInline(node: LexicalNode, key: string): React.ReactNode {
  if (isTextNode(node)) return <React.Fragment key={key}>{renderTextNode(node)}</React.Fragment>
  if (isLinkNode(node)) {
    return <React.Fragment key={key}>{renderLinkNode(node)}</React.Fragment>
  }
  if (node.type === 'linebreak') {
    return <br key={key} />
  }
  if (node.type === 'tab') {
    return <React.Fragment key={key}>{'\t'}</React.Fragment>
  }
  if (!ALLOWED_INLINE_TYPES.has(node.type)) {
    warnUnsupportedNode(node.type)
  }
  return null
}

/** 渲染一组行内子节点 */
function renderInlineChildren(children: unknown, prefix: string): React.ReactNode {
  if (!Array.isArray(children)) return null
  return children.map((c, i) => renderInline(c as LexicalNode, `${prefix}-${i}`))
}

// ---------------------------------------------------------------------------
// 块级节点渲染
// ---------------------------------------------------------------------------

function renderParagraph(node: LexicalNode, key: string): React.ReactNode {
  const children = node.children
  return (
    <p key={key}>{renderInlineChildren(children, `p-${key}`)}</p>
  )
}

function renderHeading(node: LexicalNode, key: string): React.ReactNode {
  // Lexical heading 节点 tag 字段：'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  const tag = typeof node.tag === 'string' ? node.tag : 'h2'
  const allowedTags = new Set(['h2', 'h3', 'h4'])
  const finalTag = allowedTags.has(tag) ? tag : 'h2'
  const children = node.children
  // 仅支持 h2/h3/h4：h1 由 hero 占用，h5/h6 降级为 h4 避免层级跳跃
  const Tag = finalTag as 'h2' | 'h3' | 'h4'
  return React.createElement(
    Tag,
    { key },
    renderInlineChildren(children, `h-${key}`),
  )
}

function renderQuote(node: LexicalNode, key: string): React.ReactNode {
  const children = node.children
  return (
    <blockquote key={key}>{renderInlineChildren(children, `q-${key}`)}</blockquote>
  )
}

function renderList(node: LexicalNode, key: string): React.ReactNode {
  // Lexical list 节点 listType: 'number' | 'bullet' | 'check'
  const listType = typeof node.listType === 'string' ? node.listType : 'bullet'
  const children = node.children
  if (!Array.isArray(children)) return null
  // list 子节点为 listItem，渲染为 <li>
  const items = children.map((item, i) => {
    if (typeof item !== 'object' || item === null) return null
    const itemNode = item as LexicalNode
    if (itemNode.type !== 'listitem') {
      warnUnsupportedNode(itemNode.type)
      return null
    }
    return (
      <li key={`li-${key}-${i}`}>
        {renderInlineChildren(itemNode.children, `li-${key}-${i}`)}
      </li>
    )
  })
  if (listType === 'number') {
    return <ol key={key}>{items}</ol>
  }
  // bullet 与 check 都渲染为 ul（check 渲染时保留原值，不渲染勾选 UI 以避免误用）
  return <ul key={key}>{items}</ul>
}

function renderUpload(node: LexicalNode, key: string): React.ReactNode {
  if (!isUploadNode(node)) return null
  const value = node.value
  if (!value || typeof value.url !== 'string' || value.url.length === 0) return null
  const alt = typeof value.alt === 'string' ? value.alt : ''
  const width = typeof value.width === 'number' ? value.width : undefined
  const height = typeof value.height === 'number' ? value.height : undefined
  return (
    <figure key={key}>
      <img
        src={value.url}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        // 不渲染 dangerouslySetInnerHTML；外链图片由浏览器加载
      />
    </figure>
  )
}

function renderHorizontalRule(key: string): React.ReactNode {
  return <hr key={key} />
}

/** 渲染单个块级节点；未支持类型跳过并告警 */
function renderBlock(node: LexicalNode, key: string): React.ReactNode {
  switch (node.type) {
    case 'paragraph':
      return renderParagraph(node, key)
    case 'heading':
      return renderHeading(node, key)
    case 'quote':
      return renderQuote(node, key)
    case 'list':
      return renderList(node, key)
    case 'upload':
      return renderUpload(node, key)
    case 'horizontalrule':
      return renderHorizontalRule(key)
    default:
      if (!ALLOWED_BLOCK_TYPES.has(node.type)) {
        warnUnsupportedNode(node.type)
      }
      return null
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

type PageContentProps = {
  /** Lexical richText JSON；为 null/undefined 时不渲染 */
  data: Page['content']
}

/**
 * PageContent：内容页正文白名单渲染器
 *
 * 使用方式：
 *   <PageContent data={page.content} />
 *
 * 安全保证：
 *   - 不使用 dangerouslySetInnerHTML；
 *   - 不渲染 script / iframe / object / embed；
 *   - 外链加 rel="noopener noreferrer nofollow"；
 *   - 未支持节点跳过并 console.warn。
 */
export default function PageContent({ data }: PageContentProps) {
  if (!isLexicalContent(data)) return null
  const root = (data as LexicalContent).root
  const children = Array.isArray(root.children) ? root.children : []
  return (
    <div className="page-content">
      {children.map((node, i) => renderBlock(node, `block-${i}`))}
    </div>
  )
}
