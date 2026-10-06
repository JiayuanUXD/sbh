/**
 * 汇租选址：原始页面 → 规范化同步包 + 解析报告（OPT-104 阶段 3）。
 *
 *   HZX_DATA_DIR=E:/hzx-data pnpm exec tsx scripts/import-huizuxuanzhi/build-dataset.ts
 *
 * 只读 `raw/` 与 `state/`，不发请求、不碰库。产物写到 `dataset/`：
 *
 *   buildings.ndjson / listings.ndjson   全部通过 parseHuizuSyncRow 校验的行
 *   rejected.ndjson                      校验不过的行 + 原因（不进同步包）
 *   report.json                          计数、字段缺失率、解析问题分布、区/装修分布、对账差异
 *   chunks/NNNN-{b|l}.ndjson.gz          上传用的同步包，每包 ≤ CHUNK_ROWS 行；楼盘包排在房源包前面
 *
 * 「对方已消失」的旧数据不在这里推断——那需要生产现有的 externalId 清单，见 reconcile.ts。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

import { pinyin } from 'pinyin-pro'

import { parseHuizuSyncRow, type HuizuBuildingRow, type HuizuListingRow } from '@/domain/supply-sync/huizuxuanzhi-row'

import { parseBuildingPage, parseListingPage, type ParseIssue } from './parse'

/**
 * 「仲盛金融中心」→ `zhong-sheng-jin-rong-zhong-xin`。逐字拼音以连字符相连，非汉字原样保留后
 * 规范化——与 2026-08 那轮生产 slug（`zhong-sheng-jin-rong-zhong-xin-1`）同格式。
 */
export function pinyinSlug(text: string): string {
  return pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const buildingSlug = (name: string, id: string) => [pinyinSlug(name), id].filter(Boolean).join('-')
/** 标题拼音截到 60 字符再接 `-huizu-<xid>`，与 2026-08 那轮（`…-huizu-63425`）同格式 */
const listingSlug = (title: string, xid: string) =>
  [pinyinSlug(title).slice(0, 60).replace(/-+$/, ''), 'huizu', xid].filter(Boolean).join('-')

/**
 * 人工确认过的挂靠决定：`decisions/attach.json` = { "<对方楼盘id>": <本站楼盘id> }。
 * 由 reconcile.ts 出建议清单，人逐条确认后写进这个文件；没有文件就是一个都不挂靠。
 */
function loadAttachDecisions(): Map<string, number> {
  const f = join(DATA, 'decisions', 'attach.json')
  if (!existsSync(f)) return new Map()
  const raw = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>
  const out = new Map<string, number>()
  for (const [ext, id] of Object.entries(raw))
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) out.set(ext, id)
  return out
}

/**
 * 人工确认过的区名修正：`decisions/district-overrides.json` = { "<对方楼盘id>": "闵行区" }。
 * 来源是 reconcile.ts --regeo 的坐标反查建议（对方把「万科时一区」标成长宁区，坐标在闵行）。
 */
function loadDistrictOverrides(): Map<string, string> {
  const f = join(DATA, 'decisions', 'district-overrides.json')
  if (!existsSync(f)) return new Map()
  const raw = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>
  const out = new Map<string, string>()
  for (const [ext, name] of Object.entries(raw)) if (typeof name === 'string' && /区$/.test(name)) out.set(ext, name)
  return out
}

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(process.env.HZX_DATA_DIR || join(HERE, 'data'))
const OUT = join(DATA, 'dataset')
const CHUNK_ROWS = Number(process.env.HZX_CHUNK_ROWS || 1000)

const readGz = (f: string) => gunzipSync(readFileSync(f)).toString('utf8')
const readJson = <T>(f: string, fallback: T): T =>
  existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback
const shard = (id: string) => String(Math.floor(Number(id) / 1000))
const bFile = (id: string) => join(DATA, 'raw', 'b', shard(id), `${id}.html.gz`)
const lFile = (id: string) => join(DATA, 'raw', 'l', shard(id), `${id}.html.gz`)

function countBy<T>(items: readonly T[], key: (t: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const it of items) {
    const k = key(it) ?? '(空)'
    out[k] = (out[k] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}

/** 每个字段的非空率，用来一眼看出模板改版（某字段突然全空）。 */
function fillRates<T extends Record<string, unknown>>(rows: readonly T[]): Record<string, string> {
  if (!rows.length) return {}
  const out: Record<string, string> = {}
  for (const key of Object.keys(rows[0])) {
    const filled = rows.filter((r) => {
      const v = r[key]
      return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
    }).length
    out[key] = `${((filled / rows.length) * 100).toFixed(1)}%`
  }
  return out
}

function main() {
  const enumBuildings = readJson<string[]>(join(DATA, 'state', 'enum-buildings.json'), [])
  const enumListings = readJson<[string, string][]>(join(DATA, 'state', 'enum-listings.json'), [])
  const enumMeta = readJson<unknown>(join(DATA, 'state', 'enum-meta.json'), null)
  const gone = new Set<string>()
  const goneFile = join(DATA, 'state', 'gone.jsonl')
  if (existsSync(goneFile))
    for (const line of readFileSync(goneFile, 'utf8').split('\n'))
      if (line.trim()) {
        const g = JSON.parse(line) as { kind: string; id: string }
        gone.add(`${g.kind}:${g.id}`)
      }

  const issues: ParseIssue[] = []
  const rejected: { kind: string; id: string; errors: readonly string[] }[] = []
  const buildings: HuizuBuildingRow[] = []
  const claimed = new Map<string, number | null>()
  const unmappedDistrictIds: Record<string, number> = {}
  let missingBuildingPages = 0
  const attach = loadAttachDecisions()
  const districtOverrides = loadDistrictOverrides()

  for (const id of enumBuildings) {
    if (gone.has(`b:${id}`)) continue
    const f = bFile(id)
    if (!existsSync(f)) {
      missingBuildingPages++
      continue
    }
    const parsed = parseBuildingPage(readGz(f), id)
    issues.push(...parsed.issues)
    claimed.set(id, parsed.extras.claimedListingCount)
    if (parsed.row.districtName === null && parsed.extras.siteDistrictId !== null) {
      const k = String(parsed.extras.siteDistrictId)
      unmappedDistrictIds[k] = (unmappedDistrictIds[k] ?? 0) + 1
    }
    const full: HuizuBuildingRow = {
      ...parsed.row,
      districtName: districtOverrides.get(id) ?? parsed.row.districtName,
      slug: buildingSlug(parsed.row.name, id),
      attachToBuildingId: attach.get(id) ?? null,
    }
    const checked = parseHuizuSyncRow(JSON.parse(JSON.stringify(full)))
    if (checked.ok) buildings.push(full)
    else rejected.push({ kind: 'building', id, errors: checked.errors })
  }

  const buildingIds = new Set(buildings.map((b) => b.externalId))
  const listings: HuizuListingRow[] = []
  let missingListingPages = 0
  const orphanListings: string[] = []
  for (const [id, b] of enumListings) {
    if (gone.has(`l:${id}`)) continue
    const f = lFile(id)
    if (!existsSync(f)) {
      missingListingPages++
      continue
    }
    const parsed = parseListingPage(readGz(f), id, b)
    issues.push(...parsed.issues)
    const full: HuizuListingRow = {
      ...parsed.row,
      slug: listingSlug(parsed.row.title, id),
    }
    const checked = parseHuizuSyncRow(JSON.parse(JSON.stringify(full)))
    if (!checked.ok) {
      rejected.push({ kind: 'listing', id, errors: checked.errors })
      continue
    }
    // 楼盘没抓到 / 校验不过的房源不进包：同步任务找不到楼盘只能报错
    if (!buildingIds.has(full.buildingExternalId)) {
      orphanListings.push(id)
      continue
    }
    listings.push(full)
  }

  // 楼盘页声称的在租套数 vs 实际解析到的房源数
  const perBuilding = countBy(listings, (l) => l.buildingExternalId)
  const countMismatch = [...claimed.entries()]
    .map(([id, c]) => ({ id, claimed: c, got: perBuilding[id] ?? 0 }))
    .filter((x) => x.claimed !== null && x.claimed !== x.got)
    .sort((a, b) => Math.abs((b.claimed ?? 0) - b.got) - Math.abs((a.claimed ?? 0) - a.got))

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(join(OUT, 'chunks'), { recursive: true })
  const ndjson = (rows: readonly unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')
  writeFileSync(join(OUT, 'buildings.ndjson'), ndjson(buildings))
  writeFileSync(join(OUT, 'listings.ndjson'), ndjson(listings))
  writeFileSync(join(OUT, 'rejected.ndjson'), ndjson(rejected))

  let chunkNo = 0
  const writeChunks = (rows: readonly unknown[], tag: 'b' | 'l') => {
    for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
      chunkNo++
      const name = `${String(chunkNo).padStart(4, '0')}-${tag}.ndjson.gz`
      writeFileSync(join(OUT, 'chunks', name), gzipSync(Buffer.from(ndjson(rows.slice(i, i + CHUNK_ROWS)), 'utf8')))
    }
  }
  writeChunks(buildings, 'b')
  writeChunks(listings, 'l')

  const issueSummary = countBy(issues, (i) => `${i.kind}.${i.field}：${i.note}`)
  const report = {
    generatedAt: new Date().toISOString(),
    enumMeta,
    counts: {
      enumeratedBuildings: enumBuildings.length,
      enumeratedListings: enumListings.length,
      goneBuildings: [...gone].filter((g) => g.startsWith('b:')).length,
      goneListings: [...gone].filter((g) => g.startsWith('l:')).length,
      missingBuildingPages,
      missingListingPages,
      buildingsOut: buildings.length,
      listingsOut: listings.length,
      rejected: rejected.length,
      orphanListings: orphanListings.length,
      chunks: chunkNo,
    },
    fillRates: {
      buildings: fillRates(buildings),
      listings: fillRates(listings),
    },
    issueSummary,
    issueSamples: Object.fromEntries(
      Object.keys(issueSummary).map((k) => [
        k,
        issues
          .filter((i) => `${i.kind}.${i.field}：${i.note}` === k)
          .slice(0, 5)
          .map((i) => ({ id: i.id, raw: i.raw })),
      ]),
    ),
    unmappedDistrictIds,
    districts: countBy(buildings, (b) => b.districtName),
    decorationRaw: countBy(listings, (l) => l.decorationRaw),
    floors: countBy(listings, (l) => l.floor),
    claimedVsParsedTop: countMismatch.slice(0, 50),
    claimedVsParsedMismatchCount: countMismatch.length,
    orphanListingSamples: orphanListings.slice(0, 20),
    rejectedSamples: rejected.slice(0, 20),
  }
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.counts, null, 2))
  console.log(`报告：${join(OUT, 'report.json')}`)
}

// 被测试 import 时不跑（测试只要 pinyinSlug）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
