/**
 * 极简 Markdown → Lexical 转换器（资讯批量导入用）
 *
 * 只支持前台 `PageContent` 白名单渲染器认识的节点，**不支持的写法直接抛错**而不是静默降级：
 *   - 标题 `## ` / `### ` / `#### `（`#` 一级标题由页面 H1 占用，禁止）
 *   - 段落（连续非空行合并成一段，行间补一个空格不留 `\n`）
 *   - 无序列表 `- `、有序列表 `1. `（单层）
 *   - 引用 `> `
 *   - 分隔线 `---`
 *   - 行内：`**粗体**`、`[文字](链接)`
 *
 * 为什么不引 marked / remark：输出必须是 Payload Lexical 编辑器认识的 JSON（后台还要能打开编辑），
 * 通用解析器的 AST 还得再转一遍；而我们只需要六种块，手写比依赖更可控，也更好测。
 *
 * 表格、图片、代码块、嵌套列表、HTML 都**不支持**：前台渲染器会跳过未知节点，
 * 后台编辑器遇到未启用 feature 的节点会直接报错，宁可导入时就失败。
 */

type TextNode = {
  type: 'text'
  text: string
  version: 1
  format: 0 | 1
  style: ''
  mode: 'normal'
  detail: 0
}

type LinkNode = {
  type: 'link'
  version: 3
  direction: 'ltr'
  format: ''
  indent: 0
  url: string
  newTab: boolean
  fields: { linkType: 'custom'; url: string; newTab: boolean }
  children: TextNode[]
}

type InlineNode = TextNode | LinkNode

type BlockBase = { version: 1; direction: 'ltr'; format: ''; indent: 0 }

export type LexicalBlock =
  | (BlockBase & { type: 'paragraph'; textFormat: 0; children: InlineNode[] })
  | (BlockBase & { type: 'heading'; tag: 'h2' | 'h3' | 'h4'; children: InlineNode[] })
  | (BlockBase & { type: 'quote'; children: InlineNode[] })
  | (BlockBase & {
      type: 'list'
      listType: 'bullet' | 'number'
      tag: 'ul' | 'ol'
      start: 1
      children: Array<BlockBase & { type: 'listitem'; value: number; children: InlineNode[] }>
    })
  | { type: 'horizontalrule'; version: 1 }

export type LexicalRoot = {
  root: BlockBase & { type: 'root'; children: LexicalBlock[] }
}

const BASE: BlockBase = { version: 1, direction: 'ltr', format: '', indent: 0 }

function textNode(text: string, bold: boolean): TextNode {
  return { type: 'text', text, version: 1, format: bold ? 1 : 0, style: '', mode: 'normal', detail: 0 }
}

/** 站内链接（`/` 开头）与站外链接都允许；`//`、`javascript:` 之类一律拒绝。 */
function assertSafeUrl(url: string, line: string): void {
  const ok = /^https?:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'))
  if (!ok) throw new Error(`不允许的链接地址「${url}」：${line}`)
}

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = []
  // 先切链接，再在链接外/内切粗体
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  const pushPlain = (chunk: string) => {
    const boldRe = /\*\*([^*]+)\*\*/g
    let p = 0
    let m: RegExpExecArray | null
    while ((m = boldRe.exec(chunk)) !== null) {
      if (m.index > p) nodes.push(textNode(chunk.slice(p, m.index), false))
      nodes.push(textNode(m[1], true))
      p = m.index + m[0].length
    }
    if (p < chunk.length) nodes.push(textNode(chunk.slice(p), false))
  }
  let match: RegExpExecArray | null
  while ((match = linkRe.exec(source)) !== null) {
    if (match.index > last) pushPlain(source.slice(last, match.index))
    const [, label, url] = match
    assertSafeUrl(url, source)
    nodes.push({
      type: 'link',
      version: 3,
      direction: 'ltr',
      format: '',
      indent: 0,
      url,
      newTab: false,
      fields: { linkType: 'custom', url, newTab: false },
      children: [textNode(label, false)],
    })
    last = match.index + match[0].length
  }
  if (last < source.length) pushPlain(source.slice(last))
  // 解析完还残留 `**` 说明标记不成对（或写在链接文字里），直接失败而不是把星号发布出去
  const leftover = nodes.some((n) => (n.type === 'text' ? n.text : n.children[0].text).includes('**'))
  if (leftover) throw new Error(`粗体标记不成对或写在链接文字内：${source}`)
  return nodes
}

function rejectUnsupported(line: string): void {
  if (/^#\s/.test(line)) throw new Error(`正文不允许一级标题（页面 H1 已占用）：${line}`)
  if (/^#{5,}\s/.test(line)) throw new Error(`只支持 ## 到 ####：${line}`)
  if (/^\|.*\|\s*$/.test(line)) throw new Error(`不支持表格（前台渲染器与后台编辑器都没有启用表格节点），请改写成列表：${line}`)
  if (/^```/.test(line)) throw new Error(`不支持代码块：${line}`)
  if (/^!\[/.test(line)) throw new Error(`不支持行内图片（封面请在后台上传）：${line}`)
  if (/^\s{2,}[-*]\s/.test(line) || /^\t/.test(line)) throw new Error(`不支持嵌套列表：${line}`)
  if (/^<[a-zA-Z]/.test(line)) throw new Error(`不支持 HTML：${line}`)
}

export function markdownToLexical(markdown: string): LexicalRoot {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: LexicalBlock[] = []
  let paragraph: string[] = []
  let list: { type: 'bullet' | 'number'; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ ...BASE, type: 'paragraph', textFormat: 0, children: parseInline(paragraph.join(' ')) })
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    blocks.push({
      ...BASE,
      type: 'list',
      listType: list.type,
      tag: list.type === 'bullet' ? 'ul' : 'ol',
      start: 1,
      children: list.items.map((item, index) => ({
        ...BASE,
        type: 'listitem' as const,
        value: index + 1,
        children: parseInline(item),
      })),
    })
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }
    rejectUnsupported(line)

    const heading = /^(#{2,4})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ ...BASE, type: 'heading', tag: `h${heading[1].length}` as 'h2' | 'h3' | 'h4', children: parseInline(heading[2].trim()) })
      continue
    }
    if (/^---+$/.test(line.trim())) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'horizontalrule', version: 1 })
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push({ ...BASE, type: 'quote', children: parseInline(quote[1].trim()) })
      continue
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (bullet || ordered) {
      flushParagraph()
      const kind = bullet ? 'bullet' : 'number'
      if (list && list.type !== kind) flushList()
      if (!list) list = { type: kind, items: [] }
      list.items.push((bullet ?? ordered)![1].trim())
      continue
    }
    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushList()

  return { root: { ...BASE, type: 'root', children: blocks } }
}

/** 纯文本字数（中文按字符计，去掉空白），用于校验篇幅与摘要长度。 */
export function lexicalPlainTextLength(doc: LexicalRoot): number {
  let total = 0
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const n = node as { type?: string; text?: string; children?: unknown[] }
    if (n.type === 'text' && typeof n.text === 'string') total += n.text.replace(/\s/g, '').length
    if (Array.isArray(n.children)) n.children.forEach(walk)
  }
  walk(doc.root)
  return total
}
