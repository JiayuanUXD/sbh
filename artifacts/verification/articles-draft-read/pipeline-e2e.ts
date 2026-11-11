/**
 * 资讯日更流水线（scripts/lib/news-publish.ts）对真实访问规则的端到端核对。
 *
 * 用法（在 payload-office-platform 目录下，server 已起在本地端口）：
 *   BASE=http://localhost:3741 node --import tsx ../artifacts/verification/articles-draft-read/pipeline-e2e.ts
 *
 * 为什么不直接跑 `pnpm news:publish`：它前面还有一串与本次改动无关的内容检查（numbers.json、
 * 站内链接 200 等），在只有 5 篇种子资讯的本地库里过不了。这里用真实 fetch 驱动同一批库函数
 * （login / findArticleBySlug / preparePublish / executePublish），覆盖的正是读侧准入收紧后会受影响的几步。
 *
 * 只允许本地地址。账号是 scripts/seed.ts 的公开夹具：OPS 有「资讯中心 + 素材库」菜单码，与日更专用账号等价；
 * ADM 只用来造「已存在的草稿」和事后清理。
 */
import { parseArticleFile } from '../../../payload-office-platform/scripts/lib/article-content'
import { executePublish, findArticleBySlug, login, preparePublish } from '../../../payload-office-platform/scripts/lib/news-publish'

const BASE = (process.env.BASE ?? 'http://localhost:3741').replace(/\/+$/, '')
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) {
  console.error(`拒绝：BASE=${BASE} 不是本地地址`)
  process.exit(2)
}

const PASSWORD = 'Test1234!'
const STAMP = Date.now()
const slugs = { existing: `zz-pipe-existing-${STAMP}`, draft: `zz-pipe-draft-${STAMP}`, published: `zz-pipe-pub-${STAMP}` }

let failed = 0
function check(ok: boolean, what: string, detail = ''): void {
  if (!ok) failed++
  console.log(`${ok ? '✔' : '✘'} ${what}${detail ? `  [${detail}]` : ''}`)
}

function articleFile(slug: string, title: string) {
  const paragraph = '小团队找办公室，先想清楚每天几个人坐、客户会不会上门，再去看面积和价格，顺序反过来很容易多花钱。'
  const body = `## 先想清楚几个人坐\n\n${Array.from({ length: 30 }, () => paragraph).join('\n\n')}\n\n> 声明\n`
  const meta = [`slug: ${slug}`, `title: ${title}`, 'category: guide', 'excerpt: 摘要', 'seoTitle: SEO 标题', 'seoDescription: SEO 描述', 'coverAlt: 采光明亮的小办公室'].join('\n')
  return parseArticleFile(`---\n${meta}\n---\n${body}`, `${slug}.md`)
}

async function adminJson(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `JWT ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

async function anonymousStatus(path: string): Promise<{ status: number; docs: number }> {
  const res = await fetch(`${BASE}${path}`)
  const json = (await res.json().catch(() => ({}))) as { docs?: unknown[] }
  return { status: res.status, docs: Array.isArray(json.docs) ? json.docs.length : 0 }
}

async function main(): Promise<void> {
  const adm = await login(BASE, fetch, 'e2e-adm@example.com', PASSWORD)
  const bot = await login(BASE, fetch, 'e2e-ops@example.com', PASSWORD)
  const createdIds: number[] = []

  try {
    // 0) 造一篇「已存在的草稿」
    const seed = await adminJson(adm, 'POST', '/api/articles', { title: '已存在的草稿', slug: slugs.existing, status: 'draft', category: 'guide' })
    const seedId = Number((seed.json.doc as { id?: unknown } | undefined)?.id)
    check(seed.status === 201 && Number.isFinite(seedId), '前置：ADM 建出一篇同名草稿', `HTTP ${seed.status}`)
    createdIds.push(seedId)

    // 1) slug 占用检查：匿名看不到草稿（盲区），带专用账号 token 才看得到
    const anon = await findArticleBySlug(BASE, fetch, slugs.existing)
    check(anon === null, '匿名按 slug 查草稿：查不到（读侧已收口，这就是脚本必须带 token 的原因）')
    const withToken = await findArticleBySlug(BASE, fetch, slugs.existing, bot)
    check(withToken?.id === seedId && withToken.status === 'draft', '专用账号带 token 按 slug 查草稿：查得到', JSON.stringify(withToken))

    // 2) preparePublish：已存在的草稿被拦；新 slug 通过且检查范围是 all
    const blocked = await preparePublish({ article: articleFile(slugs.existing, '同名'), cover: null, status: 'draft', baseUrl: BASE, fetchImpl: fetch, now: new Date(), token: bot })
      .then(() => null)
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)))
    check(typeof blocked === 'string' && blocked.includes('占用'), '带 token 的 preparePublish：同 slug 草稿被拦（只新建不覆盖）', blocked ?? '没有被拦')

    // 3) 草稿发布：建得出、读回得到（带 token），匿名读不到
    const draftPlan = await preparePublish({ article: articleFile(slugs.draft, `草稿探针 ${STAMP}`), cover: null, status: 'draft', baseUrl: BASE, fetchImpl: fetch, now: new Date(), token: bot })
    check(draftPlan.slugCheck === 'all', 'preparePublish 带 token：slugCheck = all')
    const draftResult = await executePublish(draftPlan, { baseUrl: BASE, fetchImpl: fetch, email: 'e2e-ops@example.com', password: PASSWORD, token: bot, title: `草稿探针 ${STAMP}`, coverAlt: null })
    createdIds.push(draftResult.id)
    check(draftResult.status === 'draft' && draftResult.verifyProblems.length === 0, '专用账号新建草稿 + 带 token 读回验收通过', JSON.stringify(draftResult.verifyProblems))
    const anonDraft = await anonymousStatus(`/api/articles/${draftResult.id}?depth=0`)
    check(anonDraft.status === 404, '同一篇草稿匿名按 id 读：404', `HTTP ${anonDraft.status}`)

    // 4) 已发布：前台详情页 200 且含标题；匿名读得到（已发布内容读取不变）
    const pubPlan = await preparePublish({ article: articleFile(slugs.published, `已发布探针 ${STAMP}`), cover: null, status: 'published', baseUrl: BASE, fetchImpl: fetch, now: new Date(), token: bot })
    const pubResult = await executePublish(pubPlan, { baseUrl: BASE, fetchImpl: fetch, email: 'e2e-ops@example.com', password: PASSWORD, token: bot, title: `已发布探针 ${STAMP}`, coverAlt: null })
    createdIds.push(pubResult.id)
    check(pubResult.status === 'published' && pubResult.verifyProblems.length === 0, '专用账号新建已发布文章 + 前台详情页验收通过', JSON.stringify(pubResult.verifyProblems))
    const anonPub = await anonymousStatus(`/api/articles?depth=0&limit=1&where[slug][equals]=${slugs.published}`)
    check(anonPub.status === 200 && anonPub.docs === 1, '已发布文章匿名按 slug 仍读得到', `HTTP ${anonPub.status} docs=${anonPub.docs}`)

    // 5) 不传 token 的 executePublish 仍可用（向后兼容：内部自己登录）
    const legacyPlan = await preparePublish({ article: articleFile(`${slugs.draft}-b`, `草稿探针B ${STAMP}`), cover: null, status: 'draft', baseUrl: BASE, fetchImpl: fetch, now: new Date(), token: bot })
    const legacy = await executePublish(legacyPlan, { baseUrl: BASE, fetchImpl: fetch, email: 'e2e-ops@example.com', password: PASSWORD, title: `草稿探针B ${STAMP}`, coverAlt: null })
    createdIds.push(legacy.id)
    check(legacy.verifyProblems.length === 0, '不传 token 的 executePublish 自行登录，草稿读回验收通过', JSON.stringify(legacy.verifyProblems))
  } finally {
    for (const id of createdIds.filter(Number.isFinite)) await adminJson(adm, 'DELETE', `/api/articles/${id}?trash=true`)
    const left = await adminJson(adm, 'GET', `/api/articles?limit=1&depth=0&trash=true&where[slug][like]=zz-pipe-`)
    console.log(`清理：残留探针文章 ${(left.json.totalDocs as number | undefined) ?? '?'} 篇`)
  }
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
