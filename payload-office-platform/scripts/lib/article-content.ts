/**
 * 资讯内容文件（content/articles/*.md）的读取与校验。
 *
 * 一篇资讯 = 一个 Markdown 文件：头部是 `key: value` 形式的 frontmatter，正文走
 * `markdownToLexical`。校验集中在这里，`import-articles.ts`、`news/*` 命令行与单测共用同一份：
 * 内容文件有任何一条不合格，导入脚本、发布脚本和单测都会失败，不会带着问题上线。
 *
 * 内容规则（`lintArticle` / `lintCover`）原先直接写在 tests/article-content-files.test.ts 里；
 * OPT-124 起日更流水线要在发布前单独检查一篇，规则挪到这里，测试改为调用它们，两边不会各写一份再漂移。
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
  /**
   * 关联行政区 / 商圈与楼盘的 slug（frontmatter 逗号分隔）。商圈落地页的「相关资讯」、详情页的「相关推荐」靠它。
   * `null` = 没写这个字段，导入时不动库里已有的关联（运营在后台配过的不被悄悄清掉）；`[]` = 写了但留空，明确不关联。
   */
  relatedDistricts: readonly string[] | null
  relatedBuildings: readonly string[] | null
}>

const REQUIRED = ['slug', 'title', 'category', 'excerpt', 'seoTitle', 'seoDescription'] as const
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function parseRelatedSlugs(meta: Record<string, string>, key: 'relatedDistricts' | 'relatedBuildings', file: string): string[] | null {
  if (!(key in meta)) return null
  const slugs = meta[key]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  for (const slug of slugs) {
    if (!SLUG_PATTERN.test(slug)) throw new Error(`${file}: ${key} 里的「${slug}」不是合法 slug（小写字母、数字和连字符）`)
  }
  if (new Set(slugs).size !== slugs.length) throw new Error(`${file}: ${key} 有重复的 slug`)
  return slugs
}

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
  if (!SLUG_PATTERN.test(slug)) throw new Error(`${file}: slug 只能是小写字母、数字和连字符：${slug}`)
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
    relatedDistricts: parseRelatedSlugs(meta, 'relatedDistricts', file),
    relatedBuildings: parseRelatedSlugs(meta, 'relatedBuildings', file),
  }
}

// ---------------------------------------------------------------------------
// 内容规则：单测、导入脚本、日更流水线共用
// ---------------------------------------------------------------------------

/** 这些词在口语化的行业文章里几乎不会自然出现，出现了基本就是模板腔（OPT-118 去 AI 化约束）。 */
const BANNED_PHRASES =
  /首先|其次|最后，|综上|总而言之|总的来说|值得注意的是|需要注意的是|不仅.{0,12}而且|赋能|助力|全方位|深度解析|一站式|从而|旨在|众所周知|在当今|随着.{0,10}的(发展|不断)|——/g
/** 小标题不用模板句。 */
const BANNED_HEADINGS =
  /先说结论|数据口径|数据从哪来|^接下来$|下一步|这张表怎么看|怎么看这张表|怎么用这张表|先说一下数据|这些数是怎么来的|总结|结语/
const MAX_BOLD = 3

type InlineLike = { type: string; text?: string; format?: number | string; children?: readonly InlineLike[] }

function inlineText(nodes: readonly InlineLike[]): string {
  return nodes.map((n) => (n.type === 'text' ? (n.text ?? '') : inlineText(n.children ?? []))).join('')
}

function countBold(node: unknown): number {
  if (typeof node !== 'object' || node === null) return 0
  const n = node as InlineLike
  const self = n.type === 'text' && n.format === 1 ? 1 : 0
  return self + (Array.isArray(n.children) ? n.children.reduce((sum, c) => sum + countBold(c), 0) : 0)
}

/** 篇幅、SEO 字段、套话、模板小标题、粗体、末尾声明、电话 / 占位符 / 绝对化用语。返回问题清单，空数组 = 合规。 */
export function lintArticle(a: ArticleFile): string[] {
  const problems: string[] = []
  if (a.length < 1200) problems.push(`正文 ${a.length} 字，少于 1200`)
  if (a.excerpt.length < 60 || a.excerpt.length > 150) problems.push(`excerpt ${a.excerpt.length} 字，应在 60–150（后台提示 60–120，放宽到 150）`)
  if (a.seoTitle.length > 32) problems.push(`seoTitle ${a.seoTitle.length} 字，超过 32（套上「 · 商办租赁」后会被搜索结果截断）`)
  if (a.seoDescription.length < 50 || a.seoDescription.length > 130) problems.push(`seoDescription ${a.seoDescription.length} 字，应在 50–130`)
  if (a.title.length > 45) problems.push(`title ${a.title.length} 字，超过 45`)
  if (a.coverAlt !== null) {
    if (a.coverAlt === a.slug) problems.push('coverAlt 写成了 slug，要写中文画面描述')
    if (a.coverAlt.length > 40) problems.push(`coverAlt ${a.coverAlt.length} 字，超过 40`)
  }

  const text = JSON.stringify(a.content)
  if (/1[3-9]\d{9}/.test(text)) problems.push('正文里有电话号码')
  if (/TODO|待补|XXX|lorem/i.test(text)) problems.push('正文里有占位符（TODO / 待补 / XXX）')
  if (/第一品牌|全网最低|100%\s*保证/.test(text)) problems.push('正文里有未核实的绝对化用语')
  for (const phrase of new Set(text.match(BANNED_PHRASES) ?? [])) problems.push(`含套话「${phrase}」`)

  for (const node of a.content.root.children) {
    if (node.type !== 'heading') continue
    const heading = inlineText(node.children)
    const hit = BANNED_HEADINGS.exec(heading)?.[0]
    if (hit) problems.push(`模板小标题「${hit}」（${heading}）`)
  }
  const bold = countBold(a.content.root)
  if (bold > MAX_BOLD) problems.push(`粗体 ${bold} 处，最多 ${MAX_BOLD} 处`)
  if (!a.content.root.children.some((n) => n.type === 'quote')) problems.push('缺少末尾声明（`>` 引用块：数据截止时间、口径、仅供参考）')
  return problems
}

/** 封面：存在、JPEG、16:9、小于 400KB、有替代文本。sharp 按需加载，只校验正文时不用装原生依赖。 */
export async function lintCover(dir: string, a: ArticleFile): Promise<string[]> {
  const cover = coverPathFor(dir, a.slug)
  if (!cover) return [`缺少封面 covers/${a.slug}.jpg`]
  const { default: sharp } = await import('sharp')
  const meta = await sharp(cover).metadata()
  const problems: string[] = []
  if (meta.format !== 'jpeg') problems.push(`封面格式是 ${meta.format ?? '未知'}，要 JPEG`)
  if (!meta.width || !meta.height || Math.abs(meta.width / meta.height - 16 / 9) >= 0.01) {
    problems.push(`封面 ${meta.width ?? '?'}×${meta.height ?? '?'}，不是 16:9`)
  }
  const size = fs.statSync(cover).size
  if (size >= 400 * 1024) problems.push(`封面 ${Math.round(size / 1024)}KB，要小于 400KB`)
  if (!a.coverAlt) problems.push('有封面但 frontmatter 缺少 coverAlt')
  return problems
}

// ---------------------------------------------------------------------------
// 关联：slug → id。导入脚本用 Local API 查，发布脚本用公开 REST 查，查法不同、规则一份
// ---------------------------------------------------------------------------

/** 返回该 slug 对应的 id；查不到返回 null。`location` 只认行政区 / 商圈（与 Articles.relatedDistricts 的 filterOptions 一致）。 */
export type SlugLookup = (kind: 'location' | 'building', slug: string) => Promise<number | null>

export type RelatedIds = { relatedDistricts?: number[]; relatedBuildings?: number[] }

/** 把 frontmatter 的关联 slug 换成 id。字段为 null（没写）就不出现在结果里；查不到的 slug 一次列全再报错。 */
export async function resolveRelated(a: ArticleFile, lookup: SlugLookup): Promise<RelatedIds> {
  const missing: string[] = []
  const resolve = async (kind: 'location' | 'building', slugs: readonly string[]): Promise<number[]> => {
    const ids: number[] = []
    for (const slug of slugs) {
      const id = await lookup(kind, slug)
      if (id === null) missing.push(`${kind === 'location' ? '行政区/商圈' : '楼盘'} ${slug}`)
      else ids.push(id)
    }
    return ids
  }
  const result: RelatedIds = {}
  if (a.relatedDistricts !== null) result.relatedDistricts = await resolve('location', a.relatedDistricts)
  if (a.relatedBuildings !== null) result.relatedBuildings = await resolve('building', a.relatedBuildings)
  if (missing.length > 0) throw new Error(`${a.slug}: 关联查不到：${missing.join('、')}`)
  return result
}

// ---------------------------------------------------------------------------
// 给数字核对、链接检查用的读取器
// ---------------------------------------------------------------------------

/** 标题、摘要、SEO 字段、封面替代文本与正文逐块的纯文本，`source` 标明出处便于定位。 */
export function articleTexts(a: ArticleFile): Array<{ source: string; text: string }> {
  const texts = [
    { source: 'title', text: a.title },
    { source: 'excerpt', text: a.excerpt },
    { source: 'seoTitle', text: a.seoTitle },
    { source: 'seoDescription', text: a.seoDescription },
    ...(a.coverAlt ? [{ source: 'coverAlt', text: a.coverAlt }] : []),
  ]
  a.content.root.children.forEach((block, i) => {
    if (block.type === 'horizontalrule') return
    const text = block.type === 'list' ? block.children.map((item) => inlineText(item.children)).join('\n') : inlineText(block.children)
    texts.push({ source: `正文第 ${i + 1} 块（${block.type}）`, text })
  })
  return texts
}

/** 正文里全部链接地址（去重，保持出现顺序）。 */
export function articleLinks(a: ArticleFile): string[] {
  const urls: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const n = node as { type?: string; url?: string; children?: unknown[] }
    if (n.type === 'link' && typeof n.url === 'string' && !urls.includes(n.url)) urls.push(n.url)
    if (Array.isArray(n.children)) n.children.forEach(walk)
  }
  walk(a.content.root)
  return urls
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

/** `--only=<slug>`：只取这一篇（全部文件仍要先过 loadArticleFiles 的跨文件校验）；没给就是全部，给了但不存在直接报错。 */
export function selectArticles(articles: readonly ArticleFile[], only: string | undefined): ArticleFile[] {
  if (only === undefined) return [...articles]
  const picked = articles.filter((a) => a.slug === only)
  if (picked.length === 0) throw new Error(`--only=${only}：content/articles 里没有这篇（文件名要与 slug 一致）`)
  return picked
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
