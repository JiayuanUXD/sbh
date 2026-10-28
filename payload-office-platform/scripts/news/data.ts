/**
 * 资讯日更取数：公开 REST 拉在租房源 → 快照 → 与前台逐项对账（OPT-124）。
 *
 * 只读，不需要任何凭据，约 3–4 分钟：
 *
 *   pnpm news:data --out=<目录> [--archive=<快照归档目录>] [--city=shanghai] [--base-url=https://shangban.cc] [--reuse]
 *
 * 输出到 <out>：
 *   - locations.json / buildings.json / listings.json：原始数据（listings 已按城市过滤），给本篇的分析脚本用
 *   - snapshot.json：全市、各行政区、各商圈的条数与「元/㎡/天」分位数（算法同区域落地页）
 *   - reconcile.json：与前台列表页（总数、各区计数）和落地页（价格摘要）的逐项比对
 * 对账有一项不一致就退出码 1：文章里的数字以前台为准，对不上就别写（拉取的几分钟里供给在变也会这样，隔几分钟重跑）。
 *
 * --archive：再存一份 <archive>/<YYYY-MM-DD>.json（上海时间），月报做环比靠它攒历史——库里只有当前在租的房源，没有历史。
 * --reuse：out 里已有三份原始数据时不再拉取，只重算快照、重新对账。
 *
 * 口径说明与为什么必须对账，见 scripts/lib/news-supply.ts 文件头。
 */
import fs from 'node:fs'
import path from 'node:path'

import {
  BUILDING_FIELDS,
  LISTING_FIELDS,
  LISTING_SUPPLY_FILTER,
  LOCATION_FIELDS,
  buildSnapshot,
  listingsInCity,
  parseLandingPriceSummary,
  parseListPageCounts,
  reconcile,
  type LandingPriceSummary,
  type RawBuilding,
  type RawListing,
  type RawLocation,
} from '../lib/news-supply'

const USER_AGENT = 'sbh-news-data/1.0'
const PAGE_SIZE = 500
const PAGE_PAUSE_MS = 400
/** 落地页抽查的商圈个数（按在租条数取前 N）；行政区全部抽查 */
const LANDING_BUSINESS_AREAS = 10

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}
const flag = (name: string) => process.argv.includes(`--${name}`)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// biome-ignore lint/suspicious/noConsole: CLI script
const log = (...args: unknown[]) => console.log('[news:data]', ...args)

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (res.ok || res.status === 404) return res
      lastError = new Error(`HTTP ${res.status}`)
    } catch (error) {
      lastError = error
    }
    await sleep(2000 * attempt)
  }
  throw new Error(`请求失败：${url}（${lastError instanceof Error ? lastError.message : String(lastError)}）`)
}

async function fetchAll<T>(baseUrl: string, collection: string, fields: readonly string[], where: Readonly<Record<string, string>>): Promise<T[]> {
  const docs: T[] = []
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({ ...where, limit: String(PAGE_SIZE), page: String(page), depth: '0' })
    for (const f of fields) params.set(`select[${f}]`, 'true')
    const res = await fetchWithRetry(`${baseUrl}/api/${collection}?${params.toString()}`)
    const body: unknown = await res.json()
    const b = body as { docs?: unknown; hasNextPage?: unknown; totalPages?: unknown }
    if (!Array.isArray(b.docs)) throw new Error(`/api/${collection} 返回结构不对（没有 docs）`)
    docs.push(...(b.docs as T[]))
    if (page === 1 || page % 10 === 0 || b.hasNextPage !== true) log(`${collection} ${page}/${String(b.totalPages)} 页，累计 ${docs.length}`)
    if (b.hasNextPage !== true) return docs
    await sleep(PAGE_PAUSE_MS)
  }
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

function shanghaiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

async function main() {
  const out = arg('out')
  if (!out) throw new Error('缺少 --out=<目录>')
  const city = arg('city') ?? 'shanghai'
  const baseUrl = (arg('base-url') ?? 'https://shangban.cc').replace(/\/+$/, '')
  fs.mkdirSync(out, { recursive: true })
  const file = (name: string) => path.join(out, name)

  let locations: RawLocation[]
  let buildings: RawBuilding[]
  let listings: RawListing[]
  let asOf: string
  if (flag('reuse') && ['locations.json', 'buildings.json', 'listings.json'].every((n) => fs.existsSync(file(n)))) {
    locations = readJson(file('locations.json'))
    buildings = readJson(file('buildings.json'))
    listings = readJson(file('listings.json'))
    asOf = fs.statSync(file('listings.json')).mtime.toISOString()
    log(`--reuse：沿用 ${out} 里的原始数据（取数时刻 ${asOf}）`)
  } else {
    locations = await fetchAll<RawLocation>(baseUrl, 'locations', LOCATION_FIELDS, {})
    buildings = await fetchAll<RawBuilding>(baseUrl, 'buildings', BUILDING_FIELDS, { 'where[status][equals]': 'published' })
    const allListings = await fetchAll<RawListing>(baseUrl, 'listings', LISTING_FIELDS, LISTING_SUPPLY_FILTER)
    asOf = new Date().toISOString()
    const cityLoc = locations.find((l) => l.type === 'city' && l.slug === city)
    if (!cityLoc) throw new Error(`locations 里没有 slug=${city} 的城市`)
    listings = listingsInCity(allListings, new Map(buildings.map((b) => [b.id, b])), cityLoc.id)
    fs.writeFileSync(file('locations.json'), JSON.stringify(locations))
    fs.writeFileSync(file('buildings.json'), JSON.stringify(buildings))
    fs.writeFileSync(file('listings.json'), JSON.stringify(listings))
  }

  const snapshot = buildSnapshot({
    asOf,
    city,
    listings,
    buildings: new Map(buildings.map((b) => [b.id, b])),
    locations: new Map(locations.map((l) => [l.id, l])),
  })
  fs.writeFileSync(file('snapshot.json'), JSON.stringify(snapshot, null, 2))
  log(`快照：在租 ${snapshot.listingCount} 条，元/㎡/天 报价 ${snapshot.priceSampleCount} 条，全市中位数 ${snapshot.median}`)

  const listRes = await fetchWithRetry(`${baseUrl}/${city}/listings`)
  const listPage = parseListPageCounts(await listRes.text())
  if (!listPage) throw new Error(`解析不了 ${baseUrl}/${city}/listings 的「共 N 套」，页面结构可能变了，先别用这批数字`)

  const landingSlugs = [...snapshot.districts.map((d) => d.slug), ...snapshot.businessAreas.slice(0, LANDING_BUSINESS_AREAS).map((a) => a.slug)]
  const landings = new Map<string, LandingPriceSummary>()
  const skipped: string[] = []
  for (const slug of landingSlugs) {
    const res = await fetchWithRetry(`${baseUrl}/${city}/area/${encodeURIComponent(slug)}`)
    const summary = res.status === 404 ? null : parseLandingPriceSummary(await res.text())
    if (summary) landings.set(slug, summary)
    else skipped.push(`${slug}（${res.status === 404 ? '落地页 404' : '没有价格摘要，样本可能不足 10 条'}）`)
    await sleep(PAGE_PAUSE_MS)
  }

  const result = reconcile(snapshot, listPage, landings)
  fs.writeFileSync(file('reconcile.json'), JSON.stringify({ asOf, ok: result.ok, rows: result.rows, coverageProblems: result.coverageProblems, skipped }, null, 2))
  const bad = result.rows.filter((r) => !r.ok)
  log(`对账：${result.rows.length} 项，不一致 ${bad.length} 项；落地页抽查 ${landings.size} 个${skipped.length ? `，跳过 ${skipped.join('、')}` : ''}`)
  for (const r of bad) log(`  ✗ ${r.scope} ${r.field}：前台 ${String(r.frontend)}，我们 ${String(r.ours)}`)
  for (const p of result.coverageProblems) log(`  ✗ 覆盖不足：${p}`)

  const archive = arg('archive')
  if (archive) {
    fs.mkdirSync(archive, { recursive: true })
    const target = path.join(archive, `${shanghaiDate(new Date(asOf))}.json`)
    fs.writeFileSync(target, JSON.stringify({ ...snapshot, reconciled: result.ok }, null, 2))
    log(`快照已归档：${target}`)
  }

  if (!result.ok) {
    log('与前台对不上：这批数字不能用于文章。几分钟后重跑；仍不一致就停下，报告里贴 reconcile.json。')
    process.exitCode = 1
    return
  }
  log(`与前台有效供给逐项一致。输出目录：${out}`)
}

main().catch((err) => {
  console.error('[news:data] failed:', err)
  process.exit(1)
})
