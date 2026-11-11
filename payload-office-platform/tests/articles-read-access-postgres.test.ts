import { GRAPHQL_POST, REST_GET } from '@payloadcms/next/routes'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'

/**
 * 资讯读侧准入的真库测试：直接穿过 Payload 的 REST / GraphQL 处理器。
 *
 * ## 为什么必须有这一层
 *
 * 单测（`articles-read-access.test.ts`）调的是 access 函数，验「函数返回什么」。
 * 但这个洞的形态是「匿名 GET /api/articles 读到草稿」——它发生在 Payload 的 REST 处理器里：
 * access 返回的 Where 要和请求自带的 `where`、`trash=true`、`draft=true` 合并，再变成 SQL。
 * 函数返回值对了、合并后的查询仍可能漏（例如回收站条件没带上）。
 * 这里不起 server，直接把 `new Request(...)` 交给 `REST_GET(config)` / `GRAPHQL_POST(config)`，
 * 与 `src/app/(payload)/api/**` 路由用的是同一对处理器。
 *
 * 前提：migrate + seed 过的库（夹具账号 e2e-*@example.com 是 scripts/seed.ts 的公开夹具）。
 * CI 的 postgres-migrations 作业满足；本地没有 DATABASE_URL 时 vitest 根本不收集本文件。
 */

const databaseAvailable =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')

const FIXTURE_PASSWORD = 'Test1234!'
const STAMP = `${Date.now()}`
const SLUGS = {
  draft: `zz-readacc-draft-${STAMP}`,
  published: `zz-readacc-pub-${STAMP}`,
  trashed: `zz-readacc-trash-${STAMP}`,
}
const MARK = {
  draft: `READACC-DRAFT-${STAMP}`,
  published: `READACC-PUBLISHED-${STAMP}`,
  trashed: `READACC-TRASHED-${STAMP}`,
}

function lexical(text: string) {
  return {
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', text, version: 1 }], direction: null, format: '', indent: 0, version: 1 }],
      direction: null,
      format: '',
      indent: 0,
      version: 1,
    },
  }
}

type RestResult = { status: number; text: string; json: { docs?: Array<{ id: number; slug: string }>; id?: number } | null }

describe.skipIf(!databaseAvailable)('资讯读侧准入（真实 PostgreSQL，穿过 REST / GraphQL 处理器）', () => {
  let payload: Payload
  const ids: { draft?: number; published?: number; trashed?: number } = {}
  const tokens: Record<string, string> = {}

  async function rest(pathAndQuery: string, token?: string): Promise<RestResult> {
    const url = new URL(`http://localhost${pathAndQuery}`)
    const segments = url.pathname.replace(/^\/api\//, '').split('/')
    const handler = REST_GET(config) as unknown as (
      req: Request,
      ctx: { params: Promise<{ slug: string[] }> },
    ) => Promise<Response>
    const res = await handler(
      new Request(url, { headers: token ? { Authorization: `JWT ${token}` } : {} }),
      { params: Promise.resolve({ slug: segments }) },
    )
    const text = await res.text()
    let json: RestResult['json'] = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 非 JSON 响应保持 null */
    }
    return { status: res.status, text, json }
  }

  async function graphql(query: string, token?: string): Promise<{ status: number; text: string }> {
    const handler = GRAPHQL_POST(config) as unknown as (req: Request) => Promise<Response>
    const res = await handler(
      new Request('http://localhost/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `JWT ${token}` } : {}) },
        body: JSON.stringify({ query }),
      }),
    )
    return { status: res.status, text: await res.text() }
  }

  const slugsOf = (r: RestResult) => (r.json?.docs ?? []).map((d) => d.slug)

  beforeAll(async () => {
    payload = await getPayload({ config })
    for (const key of ['draft', 'published', 'trashed'] as const) {
      const doc = await payload.create({
        collection: 'articles',
        overrideAccess: true,
        data: {
          title: `读权限探针 ${key}`,
          slug: SLUGS[key],
          status: key === 'draft' ? 'draft' : 'published',
          category: 'market',
          excerpt: MARK[key],
          publishedAt: '2026-11-11T00:00:00.000Z',
          content: lexical(MARK[key]) as never,
        },
      })
      ids[key] = Number(doc.id)
    }
    // 与后台「移到回收站」一致：写 deletedAt
    await payload.update({
      collection: 'articles',
      id: ids.trashed!,
      overrideAccess: true,
      data: { deletedAt: new Date().toISOString() },
    })
    for (const who of ['adm', 'ops', 'brk', 'mgr', 'csr']) {
      const login = await payload.login({
        collection: 'users',
        data: { email: `e2e-${who}@example.com`, password: FIXTURE_PASSWORD },
      })
      tokens[who] = login.token as string
    }
  }, 120_000)

  afterAll(async () => {
    for (const id of Object.values(ids)) {
      if (id === undefined) continue
      try {
        await payload.delete({ collection: 'articles', id, trash: true, overrideAccess: true })
      } catch {
        /* 清理尽力而为 */
      }
    }
  })

  describe('匿名', () => {
    it('列表只有已发布的；草稿与回收站里的都不在', async () => {
      const r = await rest('/api/articles?limit=200&depth=0')
      expect(r.status).toBe(200)
      expect(slugsOf(r)).toContain(SLUGS.published)
      expect(slugsOf(r)).not.toContain(SLUGS.draft)
      expect(slugsOf(r)).not.toContain(SLUGS.trashed)
      expect(r.text).not.toContain(MARK.draft)
    })

    it('where[status]=draft 枚举不到草稿', async () => {
      const r = await rest('/api/articles?limit=200&depth=0&where[status][equals]=draft')
      expect(r.status).toBe(200)
      expect(r.json?.docs ?? []).toHaveLength(0)
      expect(r.text).not.toContain(MARK.draft)
    })

    it('按 slug 精确查草稿查不到（日更脚本 findArticleBySlug 的匿名形态）', async () => {
      const r = await rest(`/api/articles?limit=1&depth=0&where[slug][equals]=${SLUGS.draft}`)
      expect(r.json?.docs ?? []).toHaveLength(0)
    })

    it('按 id 读草稿：404 / 403，响应里没有正文', async () => {
      const r = await rest(`/api/articles/${ids.draft}?depth=0`)
      expect([403, 404]).toContain(r.status)
      expect(r.text).not.toContain(MARK.draft)
    })

    it('trash=true 读不到回收站里的文章，也读不到草稿', async () => {
      const r = await rest('/api/articles?limit=200&depth=0&trash=true')
      expect(slugsOf(r)).not.toContain(SLUGS.trashed)
      expect(slugsOf(r)).not.toContain(SLUGS.draft)
      expect(r.text).not.toContain(MARK.trashed)
      const byId = await rest(`/api/articles/${ids.trashed}?depth=0&trash=true`)
      expect([403, 404]).toContain(byId.status)
      expect(byId.text).not.toContain(MARK.trashed)
    })

    it('draft=true 不是后门（Articles 没有 versions.drafts，该参数无效，但要钉死）', async () => {
      const r = await rest('/api/articles?limit=200&depth=0&draft=true')
      expect(slugsOf(r)).not.toContain(SLUGS.draft)
    })

    it('已发布文章读取不变：列表与详情都 200 且带正文', async () => {
      const detail = await rest(`/api/articles/${ids.published}?depth=0`)
      expect(detail.status).toBe(200)
      expect(detail.text).toContain(MARK.published)
      const bySlug = await rest(`/api/articles?limit=1&depth=0&where[slug][equals]=${SLUGS.published}`)
      expect(slugsOf(bySlug)).toEqual([SLUGS.published])
    })

    it('GraphQL 同样被收窄（读权限是集合级的，REST / GraphQL 共用）', async () => {
      const r = await graphql('{ Articles(limit: 200, where: { status: { equals: draft } }) { docs { id slug status } } }')
      expect(r.text).not.toContain(SLUGS.draft)
      const all = await graphql('{ Articles(limit: 200) { docs { slug } } }')
      expect(all.text).toContain(SLUGS.published)
      expect(all.text).not.toContain(SLUGS.draft)
      expect(all.text).not.toContain(SLUGS.trashed)
      const byId = await graphql(`{ Article(id: ${ids.draft}) { slug content } }`)
      expect(byId.text).not.toContain(MARK.draft)
    })
  })

  describe('后台账号', () => {
    it.each(['adm', 'ops'] as const)('%s（持资讯菜单码）：草稿、已发布、回收站都读得到', async (who) => {
      const list = await rest('/api/articles?limit=200&depth=0', tokens[who])
      expect(slugsOf(list)).toEqual(expect.arrayContaining([SLUGS.draft, SLUGS.published]))
      const draft = await rest(`/api/articles/${ids.draft}?depth=0`, tokens[who])
      expect(draft.status).toBe(200)
      expect(draft.text).toContain(MARK.draft)
      const trash = await rest('/api/articles?limit=200&depth=0&trash=true', tokens[who])
      expect(slugsOf(trash)).toContain(SLUGS.trashed)
    })

    it.each(['brk', 'mgr', 'csr'] as const)('%s（没有资讯菜单码）：只读得到已发布', async (who) => {
      const list = await rest('/api/articles?limit=200&depth=0&trash=true', tokens[who])
      expect(slugsOf(list)).toContain(SLUGS.published)
      expect(slugsOf(list)).not.toContain(SLUGS.draft)
      expect(slugsOf(list)).not.toContain(SLUGS.trashed)
      const draft = await rest(`/api/articles/${ids.draft}?depth=0`, tokens[who])
      expect([403, 404]).toContain(draft.status)
    })
  })
})
