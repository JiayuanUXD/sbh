/**
 * 资讯日更的 REST 发布（OPT-124）：专用后台账号登录 → 上传封面 → 创建文章 → 验收。
 *
 * 为什么走 REST 而不是 Local API / 直连库：日更由外部 agent（豆包定时任务）执行，它不该拿到生产库连接串、
 * PAYLOAD_SECRET、COS 密钥。REST 只需要一个后台账号，账号的角色只给「资讯中心 + 素材库」两个菜单权限，
 * 写入照常经过 Articles / Media 的访问控制、校验和 hook（缓存失效、关联商圈类型守卫）。
 *
 * 只新建、不覆盖：同 slug 已存在（含回收站里的）就停下，改已发布的文章仍走后台人工。
 * fetch 可注入，单测用假实现走完整流程；真实运行见 scripts/news/publish.ts。
 */
import fs from 'node:fs'
import path from 'node:path'

import { resolveRelated, toArticleData, type ArticleFile, type RelatedIds, type SlugLookup } from './article-content'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

async function bodyText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return ''
  }
}

async function json(res: Response, what: string): Promise<unknown> {
  if (!res.ok) throw new Error(`${what}失败：HTTP ${res.status} ${await bodyText(res)}`)
  return res.json()
}

function docsOf(body: unknown): Array<Record<string, unknown>> {
  const docs = (body as { docs?: unknown }).docs
  return Array.isArray(docs) ? (docs as Array<Record<string, unknown>>) : []
}

/** 用公开 REST 把关联 slug 换成 id（只读，不需要登录）。 */
export function publicSlugLookup(baseUrl: string, fetchImpl: Fetch): SlugLookup {
  return async (kind, slug) => {
    const params = new URLSearchParams({ 'where[slug][equals]': slug, limit: '1', depth: '0' })
    // 只认行政区 / 商圈，与 Articles.relatedDistricts 的 filterOptions 一致
    if (kind === 'location') params.set('where[type][in]', 'district,business_area')
    const body = await json(await fetchImpl(`${baseUrl}/api/${kind === 'location' ? 'locations' : 'buildings'}?${params.toString()}`), `查询${slug}`)
    const id = docsOf(body)[0]?.id
    return typeof id === 'number' ? id : null
  }
}

/** 按 slug 查文章（含草稿）。Articles 的 read 是公开的，草稿也读得到，所以不需要登录。 */
export async function findArticleBySlug(baseUrl: string, fetchImpl: Fetch, slug: string): Promise<{ id: number; status: string } | null> {
  const params = new URLSearchParams({ 'where[slug][equals]': slug, limit: '1', depth: '0', trash: 'true' })
  const doc = docsOf(await json(await fetchImpl(`${baseUrl}/api/articles?${params.toString()}`), '查询文章'))[0]
  return doc && typeof doc.id === 'number' ? { id: doc.id, status: String(doc.status) } : null
}

export async function login(baseUrl: string, fetchImpl: Fetch, email: string, password: string): Promise<string> {
  const body = await json(
    await fetchImpl(`${baseUrl}/api/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
    '登录',
  )
  const token = (body as { token?: unknown }).token
  if (typeof token !== 'string' || token === '') throw new Error('登录成功但没有返回 token')
  return token
}

/** 上传封面。usage 必须是 article：其它用途（如 listing-photo）会被当成房源实景打满水印。 */
export async function uploadCover(baseUrl: string, fetchImpl: Fetch, token: string, file: string, alt: string): Promise<number> {
  const form = new FormData()
  form.set('file', new Blob([fs.readFileSync(file)], { type: 'image/jpeg' }), path.basename(file))
  form.set('_payload', JSON.stringify({ alt, usage: 'article' }))
  const body = await json(await fetchImpl(`${baseUrl}/api/media`, { method: 'POST', headers: { Authorization: `JWT ${token}` }, body: form }), '上传封面')
  const id = (body as { doc?: { id?: unknown } }).doc?.id
  if (typeof id !== 'number') throw new Error('上传封面成功但没有返回 media id')
  return id
}

export async function createArticle(baseUrl: string, fetchImpl: Fetch, token: string, data: Record<string, unknown>): Promise<{ id: number; slug: string; status: string }> {
  const body = await json(
    await fetchImpl(`${baseUrl}/api/articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `JWT ${token}` },
      body: JSON.stringify(data),
    }),
    '创建文章',
  )
  const doc = (body as { doc?: Record<string, unknown> }).doc
  if (!doc || typeof doc.id !== 'number') throw new Error('创建文章成功但没有返回 id')
  return { id: doc.id, slug: String(doc.slug), status: String(doc.status) }
}

export type PublishPlan = Readonly<{
  slug: string
  status: 'draft' | 'published'
  related: RelatedIds
  data: Record<string, unknown>
  cover: string | null
}>

export type PublishResult = Readonly<{
  id: number
  slug: string
  status: string
  coverImage: number | null
  related: RelatedIds
  url: string
  adminUrl: string
  /** 验收发现的问题；空数组 = 验收通过 */
  verifyProblems: string[]
}>

/** 发布前的全部只读准备：解析关联、确认 slug 未占用、组装请求体。dry-run 只做到这一步。 */
export async function preparePublish(input: Readonly<{
  article: ArticleFile
  cover: string | null
  status: 'draft' | 'published'
  baseUrl: string
  fetchImpl: Fetch
  now: Date
}>): Promise<PublishPlan> {
  const { article, baseUrl, fetchImpl } = input
  const related = await resolveRelated(article, publicSlugLookup(baseUrl, fetchImpl))
  const existing = await findArticleBySlug(baseUrl, fetchImpl, article.slug)
  if (existing) throw new Error(`slug「${article.slug}」已被文章 #${existing.id}（${existing.status}）占用：只新建不覆盖，改稿请走后台`)
  return {
    slug: article.slug,
    status: input.status,
    related,
    data: { ...toArticleData(article, { status: input.status, now: input.now }), ...related },
    cover: input.cover,
  }
}

/** 登录 → 上传封面 → 创建文章 → 验收（published 看前台详情页，draft 读回接口）。 */
export async function executePublish(
  plan: PublishPlan,
  input: Readonly<{ baseUrl: string; fetchImpl: Fetch; email: string; password: string; title: string; coverAlt: string | null }>,
): Promise<PublishResult> {
  const { baseUrl, fetchImpl } = input
  const token = await login(baseUrl, fetchImpl, input.email, input.password)
  const coverImage = plan.cover ? await uploadCover(baseUrl, fetchImpl, token, plan.cover, input.coverAlt ?? input.title) : null
  let created: { id: number; slug: string; status: string }
  try {
    created = await createArticle(baseUrl, fetchImpl, token, { ...plan.data, ...(coverImage !== null ? { coverImage } : {}) })
  } catch (error) {
    const orphan = coverImage !== null ? `（封面已上传为 media #${coverImage}，需要的话到后台素材库删掉）` : ''
    throw new Error(`${error instanceof Error ? error.message : String(error)}${orphan}`)
  }

  const verifyProblems: string[] = []
  if (created.status !== plan.status) verifyProblems.push(`接口返回状态是 ${created.status}，期望 ${plan.status}`)
  if (plan.status === 'published') {
    const res = await fetchImpl(`${baseUrl}/news/${encodeURIComponent(plan.slug)}`)
    if (res.status !== 200) verifyProblems.push(`详情页返回 HTTP ${res.status}`)
    else if (!(await res.text()).includes(escapeHtml(input.title))) verifyProblems.push('详情页 HTML 里找不到文章标题')
  } else {
    const back = await findArticleBySlug(baseUrl, fetchImpl, plan.slug)
    if (!back || back.id !== created.id) verifyProblems.push('按 slug 读回不到刚建的草稿')
  }
  return {
    ...created,
    coverImage,
    related: plan.related,
    url: `${baseUrl}/news/${plan.slug}`,
    adminUrl: `${baseUrl}/admin/collections/articles/${created.id}`,
    verifyProblems,
  }
}

/** 与 React 文本转义一致的五个字符，标题里有引号时也能在 HTML 里找到。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}
