/**
 * 资讯内容文件（content/articles/*.md）的读取与校验。
 *
 * 一篇资讯 = 一个 Markdown 文件：头部是 `key: value` 形式的 frontmatter，正文走
 * `markdownToLexical`。校验集中在这里，`import-articles.ts` 与单测共用同一份：
 * 内容文件有任何一条不合格，导入脚本和单测都会失败，不会带着问题上线。
 */
import fs from 'node:fs'
import path from 'node:path'

import { lexicalPlainTextLength, markdownToLexical, type LexicalRoot } from './markdown-to-lexical'

export const ARTICLE_CATEGORIES = ['market', 'guide', 'building', 'industry'] as const
export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number]

export type ArticleFile = Readonly<{
  slug: string
  title: string
  category: ArticleCategory
  excerpt: string
  seoTitle: string
  seoDescription: string
  /** 封面图替代文本；有封面文件（content/articles/covers/<slug>.jpg）时必填 */
  coverAlt: string | null
  /** 可选；缺省时由导入脚本在发布时刻填 */
  publishedAt: string | null
  content: LexicalRoot
  /** 正文纯文本字数（不含空白） */
  length: number
  /** 正文里指向其它资讯的站内链接 slug */
  newsLinks: readonly string[]
}>

const REQUIRED = ['slug', 'title', 'category', 'excerpt', 'seoTitle', 'seoDescription'] as const

function parseFrontmatter(source: string, file: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source.replace(/\r\n/g, '\n'))
  if (!match) throw new Error(`${file}: 缺少 frontmatter`)
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    if (line.trim() === '') continue
    const idx = line.indexOf(':')
    if (idx <= 0) throw new Error(`${file}: frontmatter 行格式不对：${line}`)
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return { meta, body: match[2] }
}

function collectNewsLinks(doc: LexicalRoot): string[] {
  const slugs: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const n = node as { type?: string; url?: string; children?: unknown[] }
    if (n.type === 'link' && typeof n.url === 'string') {
      const m = /^\/news\/([^/?#]+)$/.exec(n.url)
      if (m) slugs.push(m[1])
    }
    if (Array.isArray(n.children)) n.children.forEach(walk)
  }
  walk(doc.root)
  return slugs
}

export function parseArticleFile(source: string, file: string): ArticleFile {
  const { meta, body } = parseFrontmatter(source, file)
  for (const key of REQUIRED) {
    if (!meta[key]) throw new Error(`${file}: frontmatter 缺少 ${key}`)
  }
  const slug = meta.slug
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`${file}: slug 只能是小写字母、数字和连字符：${slug}`)
  if (path.basename(file, '.md') !== slug) throw new Error(`${file}: 文件名必须与 slug 一致（${slug}.md）`)
  if (!(ARTICLE_CATEGORIES as readonly string[]).includes(meta.category)) {
    throw new Error(`${file}: category 必须是 ${ARTICLE_CATEGORIES.join(' / ')}`)
  }
  const publishedAt = meta.publishedAt ?? null
  if (publishedAt && Number.isNaN(Date.parse(publishedAt))) throw new Error(`${file}: publishedAt 不是合法时间`)

  const content = markdownToLexical(body)
  return {
    slug,
    title: meta.title,
    category: meta.category as ArticleCategory,
    excerpt: meta.excerpt,
    seoTitle: meta.seoTitle,
    seoDescription: meta.seoDescription,
    coverAlt: meta.coverAlt ?? null,
    publishedAt,
    content,
    length: lexicalPlainTextLength(content),
    newsLinks: collectNewsLinks(content),
  }
}

/** 封面文件路径：与文章同目录下的 covers/<slug>.jpg；不存在返回 null。 */
export function coverPathFor(dir: string, slug: string): string | null {
  const file = path.join(dir, 'covers', `${slug}.jpg`)
  return fs.existsSync(file) ? file : null
}

/** 读取目录下全部 `.md`，按文件名排序；顺带做跨文件校验（slug 唯一、站内资讯链接可达）。 */
export function loadArticleFiles(dir: string): ArticleFile[] {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort()
  const articles = files.map((name) => parseArticleFile(fs.readFileSync(path.join(dir, name), 'utf8'), name))
  const slugs = new Set<string>()
  for (const article of articles) {
    if (slugs.has(article.slug)) throw new Error(`slug 重复：${article.slug}`)
    slugs.add(article.slug)
  }
  for (const article of articles) {
    if (coverPathFor(dir, article.slug) && !article.coverAlt) {
      throw new Error(`${article.slug}: 有封面文件但 frontmatter 缺少 coverAlt（封面替代文本）`)
    }
    for (const target of article.newsLinks) {
      if (!slugs.has(target)) throw new Error(`${article.slug}: 链接到不存在的资讯 /news/${target}`)
    }
  }
  return articles
}

/** 写库用的字段（不含 coverImage / 首页主推：封面由导入脚本单独上传并只在文章还没有封面时设置，主推由运营决定）。 */
export function toArticleData(
  article: ArticleFile,
  options: Readonly<{
    status: 'draft' | 'published'
    now: Date
    /** 库里已有的发布时间：重复导入时保留，不被本次运行时刻覆盖（否则每次更新正文都会让文章重新排序、改写页面日期 / JSON-LD / sitemap） */
    existingPublishedAt?: string | null
  }>,
) {
  return {
    title: article.title,
    slug: article.slug,
    status: options.status,
    category: article.category,
    excerpt: article.excerpt,
    content: article.content,
    seo: { title: article.seoTitle, description: article.seoDescription },
    ...(options.status === 'published'
      ? { publishedAt: article.publishedAt ?? options.existingPublishedAt ?? options.now.toISOString() }
      : article.publishedAt
        ? { publishedAt: article.publishedAt }
        : {}),
  }
}
