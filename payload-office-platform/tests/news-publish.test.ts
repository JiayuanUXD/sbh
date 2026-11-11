import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseArticleFile } from '../scripts/lib/article-content'
import { executePublish, preparePublish, type Fetch } from '../scripts/lib/news-publish'

const BASE = 'https://example.test'

function article(extraMeta = '') {
  const paragraph = '小团队找办公室，先想清楚每天几个人坐、客户会不会上门，再去看面积和价格，顺序反过来很容易多花钱。'
  const body = `## 先想清楚几个人坐\n\n${Array.from({ length: 30 }, () => paragraph).join('\n\n')}\n\n> 声明\n`
  const meta = [
    'slug: sample-article',
    'title: 上海小办公室怎么挑',
    'category: guide',
    'excerpt: 摘要',
    'seoTitle: SEO 标题',
    'seoDescription: SEO 描述',
    'coverAlt: 采光明亮的小办公室',
    extraMeta,
  ]
    .filter(Boolean)
    .join('\n')
  return parseArticleFile(`---\n${meta}\n---\n${body}`, 'sample-article.md')
}

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown }

/**
 * 假后端：按路径返回预设结果，并记录每次请求。
 *
 * `/api/articles` 的 GET 模拟 `Articles.access.read`：匿名只看得到已发布的文章，
 * 带 JWT 的（持资讯菜单码的专用账号）全读。这是这个脚本依赖的后端行为——
 * 它此前靠「匿名也读得到草稿」判断 slug 是否被占用、读回刚建的草稿。
 */
function fakeBackend(options: { existing?: boolean; existingStatus?: 'draft' | 'published'; publishedPageTitle?: string } = {}) {
  const calls: Call[] = []
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl: Fetch = async (url, init) => {
    const u = new URL(url)
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    calls.push({ method: init?.method ?? 'GET', url, headers, body: init?.body })
    if (u.pathname === '/api/locations') {
      const slug = u.searchParams.get('where[slug][equals]')
      return reply({ docs: slug === 'lujiazui' ? [{ id: 12 }] : [] })
    }
    if (u.pathname === '/api/buildings') return reply({ docs: [{ id: 248 }] })
    if (u.pathname === '/api/articles' && (init?.method ?? 'GET') === 'GET') {
      const createdCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/articles'))
      const rows: Array<{ id: number; status: string }> = []
      if (options.existing) rows.push({ id: 501, status: options.existingStatus ?? 'draft' })
      if (createdCall) rows.push({ id: 501, status: (JSON.parse(String(createdCall.body)) as { status: string }).status })
      const authed = headers.authorization !== undefined
      return reply({ docs: rows.filter((r) => authed || r.status === 'published') })
    }
    if (u.pathname === '/api/users/login') return reply({ token: 'tkn' })
    if (u.pathname === '/api/media') return reply({ doc: { id: 77 } }, 201)
    if (u.pathname === '/api/articles') {
      const data = JSON.parse(String(init?.body)) as { status: string }
      return reply({ doc: { id: 501, slug: 'sample-article', status: data.status } }, 201)
    }
    if (u.pathname === '/news/sample-article') return new Response(`<h1>${options.publishedPageTitle ?? '上海小办公室怎么挑'}</h1>`, { status: 200 })
    return reply({ errors: [{ message: 'not found' }] }, 404)
  }
  return { calls, fetchImpl }
}

const now = new Date('2026-10-22T08:00:00.000Z')

describe('preparePublish：只读准备', () => {
  it('解析关联、确认 slug 未占用、组装请求体；不登录、不写', async () => {
    const { calls, fetchImpl } = fakeBackend()
    const plan = await preparePublish({
      article: article('relatedDistricts: lujiazui\nrelatedBuildings: qian-tan-zhong-xin-248'),
      cover: null,
      status: 'draft',
      baseUrl: BASE,
      fetchImpl,
      now,
    })
    expect(plan.related).toEqual({ relatedDistricts: [12], relatedBuildings: [248] })
    expect(plan.data).toMatchObject({ slug: 'sample-article', status: 'draft', relatedDistricts: [12], relatedBuildings: [248] })
    expect(plan.data).not.toHaveProperty('publishedAt')
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
    // 行政区 / 商圈查询要限定类型，与 Articles.relatedDistricts 的 filterOptions 一致
    expect(calls.find((c) => c.url.includes('/api/locations'))?.url).toContain('where%5Btype%5D%5Bin%5D=district%2Cbusiness_area')
  })

  it('同 slug 已存在就停下，不覆盖', async () => {
    const { fetchImpl } = fakeBackend({ existing: true })
    await expect(
      preparePublish({ article: article(), cover: null, status: 'draft', baseUrl: BASE, fetchImpl, now, token: 'tkn' }),
    ).rejects.toThrow('只新建不覆盖')
  })

  it('slug 占用检查带登录凭据：草稿与回收站里的同名文章匿名读不到，不带凭据查不出来', async () => {
    const { calls, fetchImpl } = fakeBackend({ existing: true, existingStatus: 'draft' })
    await expect(
      preparePublish({ article: article(), cover: null, status: 'draft', baseUrl: BASE, fetchImpl, now, token: 'tkn' }),
    ).rejects.toThrow('占用')
    const check = calls.find((c) => c.url.includes('/api/articles'))
    expect(check?.headers.authorization).toBe('JWT tkn')
    // 回收站里的同名文章也算占用（slug 唯一约束不看 deletedAt）
    expect(check?.url).toContain('trash=true')
  })

  it('没有凭据时只能核对已发布的文章：已发布的同名文章照样拦住，并如实标注检查范围', async () => {
    const published = fakeBackend({ existing: true, existingStatus: 'published' })
    await expect(
      preparePublish({ article: article(), cover: null, status: 'draft', baseUrl: BASE, fetchImpl: published.fetchImpl, now }),
    ).rejects.toThrow('只新建不覆盖')

    const none = fakeBackend()
    const anonymous = await preparePublish({ article: article(), cover: null, status: 'draft', baseUrl: BASE, fetchImpl: none.fetchImpl, now })
    expect(anonymous.slugCheck).toBe('published-only')
    const authed = await preparePublish({ article: article(), cover: null, status: 'draft', baseUrl: BASE, fetchImpl: none.fetchImpl, now, token: 'tkn' })
    expect(authed.slugCheck).toBe('all')
  })

  it('关联查不到就停下', async () => {
    const { fetchImpl } = fakeBackend()
    await expect(
      preparePublish({ article: article('relatedDistricts: nowhere'), cover: null, status: 'draft', baseUrl: BASE, fetchImpl, now }),
    ).rejects.toThrow('nowhere')
  })
})

describe('executePublish：登录 → 封面 → 建文章 → 验收', () => {
  const cover = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'news-publish-')), 'sample-article.jpg')
  fs.writeFileSync(cover, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  const creds = { email: 'bot@example.test', password: 'pw', title: '上海小办公室怎么挑', coverAlt: '采光明亮的小办公室' }

  it('封面以 article 用途上传，文章带封面与关联，请求都带 JWT', async () => {
    const { calls, fetchImpl } = fakeBackend()
    const plan = await preparePublish({ article: article('relatedDistricts: lujiazui'), cover, status: 'published', baseUrl: BASE, fetchImpl, now })
    const result = await executePublish(plan, { baseUrl: BASE, fetchImpl, ...creds })

    const upload = calls.find((c) => c.url.endsWith('/api/media'))
    expect(upload?.headers.authorization).toBe('JWT tkn')
    expect(JSON.parse(String((upload?.body as FormData).get('_payload')))).toEqual({ alt: '采光明亮的小办公室', usage: 'article' })

    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/articles'))
    expect(create?.headers.authorization).toBe('JWT tkn')
    expect(JSON.parse(String(create?.body))).toMatchObject({ status: 'published', coverImage: 77, relatedDistricts: [12], publishedAt: now.toISOString() })

    expect(result).toMatchObject({ id: 501, status: 'published', coverImage: 77, url: `${BASE}/news/sample-article`, verifyProblems: [] })
  })

  it('发布后详情页里找不到标题，记为验收问题', async () => {
    const { fetchImpl } = fakeBackend({ publishedPageTitle: '别的标题' })
    const plan = await preparePublish({ article: article(), cover: null, status: 'published', baseUrl: BASE, fetchImpl, now })
    const result = await executePublish(plan, { baseUrl: BASE, fetchImpl, ...creds })
    expect(result.verifyProblems).toEqual(['详情页 HTML 里找不到文章标题'])
  })

  it('草稿：读回接口确认（带登录凭据，匿名读不到草稿），不看前台详情页', async () => {
    const { calls, fetchImpl } = fakeBackend()
    const plan = await preparePublish({ article: article(), cover: null, status: 'draft', baseUrl: BASE, fetchImpl, now })
    const result = await executePublish(plan, { baseUrl: BASE, fetchImpl, ...creds })
    expect(result.verifyProblems).toEqual([])
    expect(calls.some((c) => c.url.includes('/news/'))).toBe(false)
    const readBack = calls.filter((c) => c.method === 'GET' && c.url.includes('/api/articles')).at(-1)
    expect(readBack?.headers.authorization).toBe('JWT tkn')
  })

  it('调用方已登录：复用同一个 token，不再登录第二次', async () => {
    const { calls, fetchImpl } = fakeBackend()
    const plan = await preparePublish({ article: article(), cover: null, status: 'draft', baseUrl: BASE, fetchImpl, now, token: 'pre-issued' })
    const result = await executePublish(plan, { baseUrl: BASE, fetchImpl, ...creds, token: 'pre-issued' })
    expect(result.verifyProblems).toEqual([])
    expect(calls.filter((c) => c.url.endsWith('/api/users/login'))).toHaveLength(0)
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/articles'))
    expect(create?.headers.authorization).toBe('JWT pre-issued')
  })
})
