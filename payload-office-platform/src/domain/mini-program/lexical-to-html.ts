/**
 * 小程序端 Lexical AST 序列化至标准安全 HTML 转换引擎
 *
 * 遵循原则：
 * 1. 严格白名单机制：只转换受控的块级与行内节点；
 * 2. 文本实体严格转义，杜绝 XSS 攻击；
 * 3. 注入移动端防撑破与圆角样式（max-width:100% 等）。
 */

function escapeHtml(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

type LexicalNode = {
  type?: string
  tag?: string
  listType?: string
  text?: string
  format?: number
  fields?: {
    url?: string
    newTab?: boolean
  }
  value?: {
    url?: string
    alt?: string
    filename?: string
    sizes?: Record<string, { url?: string }>
  }
  children?: LexicalNode[]
  [key: string]: unknown
}

function renderInline(node: LexicalNode): string {
  if (node.type === 'text') {
    let content = escapeHtml(node.text ?? '')
    const format = typeof node.format === 'number' ? node.format : 0

    // Lexical 格式位掩码：1=bold, 2=italic, 4=strikethrough, 8=underline, 16=code
    if (format & 1) content = `<strong>${content}</strong>`
    if (format & 2) content = `<em>${content}</em>`
    if (format & 4) content = `<s>${content}</s>`
    if (format & 8) content = `<u>${content}</u>`
    if (format & 16) content = `<code>${content}</code>`

    return content
  }

  if (node.type === 'link') {
    const children = (node.children ?? []).map(renderInline).join('')
    const url = escapeHtml(node.fields?.url ?? '')
    return `<span class="mini-rich-link" data-url="${url}">${children}</span>`
  }

  // 兜底递归子项
  if (Array.isArray(node.children)) {
    return node.children.map(renderInline).join('')
  }

  return ''
}

function renderBlock(node: LexicalNode): string {
  if (!node || typeof node !== 'object') return ''

  switch (node.type) {
    case 'paragraph': {
      const children = (node.children ?? []).map(renderInline).join('')
      if (!children) return '<p class="mini-rich-p"><br/></p>'
      return `<p class="mini-rich-p">${children}</p>`
    }

    case 'heading': {
      const tag = (node.tag ?? 'h2').toLowerCase()
      const targetTag = (tag === 'h1' || tag === 'h2') ? 'h2' : 'h3'
      const className = targetTag === 'h2' ? 'mini-rich-h2' : 'mini-rich-h3'
      const children = (node.children ?? []).map(renderInline).join('')
      return `<${targetTag} class="${className}">${children}</${targetTag}>`
    }

    case 'list': {
      const isOrdered = node.listType === 'number'
      const tag = isOrdered ? 'ol' : 'ul'
      const className = isOrdered ? 'mini-rich-ol' : 'mini-rich-ul'
      const children = (node.children ?? []).map(renderBlock).join('')
      return `<${tag} class="${className}">${children}</${tag}>`
    }

    case 'listitem': {
      const children = (node.children ?? []).map(renderInline).join('')
      return `<li>${children}</li>`
    }

    case 'quote': {
      const children = (node.children ?? []).map(renderInline).join('')
      return `<blockquote class="mini-rich-quote">${children}</blockquote>`
    }

    case 'horizontalrule': {
      return '<hr class="mini-rich-hr" />'
    }

    case 'upload': {
      const val = node.value
      const url = val?.url || val?.sizes?.card?.url || ''
      if (!url) return ''
      const alt = escapeHtml(val?.alt || val?.filename || '图片')
      return `<img class="mini-rich-img" src="${escapeHtml(url)}" alt="${alt}" style="max-width:100%;height:auto;border-radius:12rpx;display:block;margin:24rpx 0;" />`
    }

    default: {
      // 对未知节点，若包含合法 children 则透传渲染子项，否则彻底忽略
      if (Array.isArray(node.children)) {
        return node.children.map(renderBlock).join('')
      }
      return ''
    }
  }
}

/**
 * 将 Payload 的 Lexical richText AST 安全序列化为小程序 <rich-text> 友好的标准 HTML
 */
export function serializeLexicalToHtml(data: unknown): string {
  if (!data || typeof data !== 'object') return ''

  const record = data as { root?: LexicalNode; type?: string; children?: LexicalNode[] }
  const rootNode = record.root || (record.type === 'root' ? (record as LexicalNode) : null)

  if (!rootNode || !Array.isArray(rootNode.children)) {
    return ''
  }

  return rootNode.children
    .map(renderBlock)
    .filter(Boolean)
    .join('')
}
