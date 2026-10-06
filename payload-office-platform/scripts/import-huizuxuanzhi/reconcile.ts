/**
 * 汇租选址：同步包 × 生产快照 → 对账报告 + 下架包 + 挂靠建议（OPT-104 阶段 4）。
 *
 *   HZX_DATA_DIR=E:/hzx-data pnpm exec tsx scripts/import-huizuxuanzhi/reconcile.ts [--regeo] [--force]
 *
 * 输入（都在 HZX_DATA_DIR 下）：
 *   dataset/buildings.ndjson、dataset/listings.ndjson、dataset/report.json   build-dataset 的产物
 *   state/gone.jsonl                                                          对方已不存在的 id
 *   prod-snapshot/buildings.json        生产楼盘快照（只读 SQL 导出）
 *   prod-snapshot/listings-published.txt 生产里来源为 huizuxuanzhi、且已上架的房源 externalId，逗号或换行分隔
 *                                        ——**生成下架包前必须重新导出**，别用几天前的
 *
 * 输出：
 *   dataset/chunks/NNNN-r.ndjson.gz          下架包（只列显式要下架的；见 HuizuRetireRow 注释）
 *   decisions/attach.suggested.json          手工楼盘的疑似同栋建议；人确认后另存为 decisions/attach.json，
 *                                            再跑一遍 build-dataset 才会生效
 *   decisions/district-overrides.suggested.json  --regeo 时：坐标反查的区与对方标注不一致的楼盘
 *   dataset/reconcile-report.json            汇总
 *
 * 安全阀：同步包没覆盖全部枚举（有详情页没抓到）时拒绝生成下架包，除非 --force。
 * 漏抓的房源会被误判成「对方已消失」，下架包一旦上传就是前台成片消失。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import type { HuizuBuildingRow, HuizuListingRow, HuizuRetireRow } from '@/domain/supply-sync/huizuxuanzhi-row'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(process.env.HZX_DATA_DIR || join(HERE, 'data'))
const FORCE = process.argv.includes('--force')
const REGEO = process.argv.includes('--regeo')
const CHUNK_ROWS = 1000

const readNdjson = <T>(f: string): T[] =>
  existsSync(f)
    ? readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as T)
    : []

type ProdBuilding = {
  id: number
  name: string
  address: string | null
  district: string | null
  src: string | null
  ext: string | null
  listings: number
}

/** 名称归一：去空白、标点、括号内容、「上海」前缀，用于找「疑似同一栋」。 */
export function normalizeName(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/^上海(市)?/, '')
    .replace(/[\s·・\-—_.,，。、]/g, '')
    .toLowerCase()
}

/** 地址里的「路名 + 门牌号」，如「南京西路1266号」→「南京西路1266」。 */
export function addressKey(address: string | null): string | null {
  if (!address) return null
  const m = address.replace(/\s/g, '').match(/([\u4e00-\u9fa5]{1,10}(?:路|街|道|大道|弄))(\d+)/)
  return m ? `${m[1]}${m[2]}` : null
}

async function regeoDistricts(points: { ext: string; lng: number; lat: number }[]): Promise<Map<string, string>> {
  const key = process.env.AMAP_WEB_SERVICE_KEY
  if (!key) throw new Error('--regeo 需要 AMAP_WEB_SERVICE_KEY（.env.local 里有）')
  const out = new Map<string, string>()
  for (let i = 0; i < points.length; i += 20) {
    const batch = points.slice(i, i + 20)
    const location = batch.map((p) => `${p.lng},${p.lat}`).join('|')
    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${key}&location=${encodeURIComponent(location)}&batch=true`
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    const json = (await res.json()) as {
      status?: string
      info?: string
      regeocodes?: { addressComponent?: { district?: unknown } }[]
    }
    if (json.status !== '1') throw new Error(`高德逆地理失败：${json.info ?? res.status}`)
    json.regeocodes?.forEach((r, j) => {
      const d = r.addressComponent?.district
      if (typeof d === 'string' && d) out.set(batch[j].ext, d)
    })
    await new Promise((r) => setTimeout(r, 300))
  }
  return out
}

async function main() {
  const buildings = readNdjson<HuizuBuildingRow>(join(DATA, 'dataset', 'buildings.ndjson'))
  const listings = readNdjson<HuizuListingRow>(join(DATA, 'dataset', 'listings.ndjson'))
  const datasetReport = existsSync(join(DATA, 'dataset', 'report.json'))
    ? (JSON.parse(readFileSync(join(DATA, 'dataset', 'report.json'), 'utf8')) as {
        counts: Record<string, number>
      })
    : null
  if (!buildings.length) throw new Error('dataset/buildings.ndjson 为空，先跑 build-dataset')

  const gone = new Set<string>()
  const goneFile = join(DATA, 'state', 'gone.jsonl')
  if (existsSync(goneFile))
    for (const line of readFileSync(goneFile, 'utf8').split('\n'))
      if (line.trim()) {
        const g = JSON.parse(line) as { kind: string; id: string }
        if (g.kind === 'l') gone.add(g.id)
      }

  const prodBuildings = (
    JSON.parse(readFileSync(join(DATA, 'prod-snapshot', 'buildings.json'), 'utf8')) as { rows: ProdBuilding[] }
  ).rows
  const publishedFile = join(DATA, 'prod-snapshot', 'listings-published.txt')
  const prodPublished = existsSync(publishedFile)
    ? readFileSync(publishedFile, 'utf8')
        .split(/[\s,]+/)
        .filter((s) => /^\d+$/.test(s))
    : null

  // ── 1. 下架包 ──
  const alive = new Set(listings.map((l) => l.externalId))
  const missing = (datasetReport?.counts.missingListingPages ?? 0) + (datasetReport?.counts.missingBuildingPages ?? 0)
  const retire: HuizuRetireRow[] = []
  let retireBlocked: string | null = null
  if (!prodPublished) retireBlocked = '缺 prod-snapshot/listings-published.txt'
  else if (missing > 0 && !FORCE)
    retireBlocked = `同步包还有 ${missing} 个详情页没抓到，下架包会误伤；抓全后再跑，或确认无误后加 --force`
  else
    for (const ext of prodPublished)
      if (!alive.has(ext))
        retire.push({ kind: 'retire', externalId: ext, reason: gone.has(ext) ? 'gone' : 'not-enumerated' })

  const chunkDir = join(DATA, 'dataset', 'chunks')
  mkdirSync(chunkDir, { recursive: true })
  for (const f of readdirSync(chunkDir))
    if (f.endsWith('-r.ndjson.gz')) throw new Error(`已有下架包 ${f}，先删掉再重跑（避免新旧混传）`)
  const nextNo = readdirSync(chunkDir).filter((f) => f.endsWith('.ndjson.gz')).length + 1
  for (let i = 0; i < retire.length; i += CHUNK_ROWS) {
    const name = `${String(nextNo + i / CHUNK_ROWS).padStart(4, '0')}-r.ndjson.gz`
    const text = retire
      .slice(i, i + CHUNK_ROWS)
      .map((r) => JSON.stringify(r))
      .join('\n')
    writeFileSync(join(chunkDir, name), gzipSync(Buffer.from(text + '\n', 'utf8')))
  }

  // ── 2. 挂靠建议：手工楼盘 × 同步包楼盘 ──
  const huizuExtInProd = new Set(prodBuildings.filter((b) => b.src === 'huizuxuanzhi').map((b) => b.ext))
  const byName = new Map<string, HuizuBuildingRow[]>()
  const byAddr = new Map<string, HuizuBuildingRow[]>()
  for (const b of buildings) {
    if (huizuExtInProd.has(b.externalId)) continue
    const n = normalizeName(b.name)
    byName.set(n, [...(byName.get(n) ?? []), b])
    const a = addressKey(b.address)
    if (a) byAddr.set(a, [...(byAddr.get(a) ?? []), b])
  }
  const suggestions = prodBuildings
    .filter((p) => !p.src)
    .map((p) => {
      const nameHits = byName.get(normalizeName(p.name)) ?? []
      const a = addressKey(p.address)
      const addrHits = a ? (byAddr.get(a) ?? []) : []
      const seen = new Set<string>()
      const candidates = [...nameHits.map((b) => ({ b, via: '名称' })), ...addrHits.map((b) => ({ b, via: '地址' }))]
        .filter(({ b }) => (seen.has(b.externalId) ? false : (seen.add(b.externalId), true)))
        .map(({ b, via }) => ({
          externalId: b.externalId,
          name: b.name,
          address: b.address,
          district: b.districtName,
          via: nameHits.includes(b) && addrHits.includes(b) ? '名称+地址' : via,
        }))
      return { prodId: p.id, prodName: p.name, prodAddress: p.address, prodDistrict: p.district, candidates }
    })
    .filter((s) => s.candidates.length > 0)
  // 生产里本身就有重复的手工楼盘（如金茂大厦 140 / 168），同一个对方楼盘只能挂一栋
  const extClaims = new Map<string, number[]>()
  for (const s of suggestions)
    for (const c of s.candidates) extClaims.set(c.externalId, [...(extClaims.get(c.externalId) ?? []), s.prodId])

  const decisionsDir = join(DATA, 'decisions')
  mkdirSync(decisionsDir, { recursive: true })
  writeFileSync(
    join(decisionsDir, 'attach.suggested.json'),
    JSON.stringify(
      {
        note: '人工逐条确认：确认的写进 decisions/attach.json，格式 { "<对方楼盘id>": <本站楼盘id> }，再跑 build-dataset',
        conflicts: [...extClaims.entries()]
          .filter(([, ids]) => ids.length > 1)
          .map(([ext, ids]) => ({ ext, prodIds: ids })),
        suggestions,
      },
      null,
      2,
    ),
  )

  // ── 3. 坐标反查行政区（可选）──
  let districtMismatch: { ext: string; name: string; site: string | null; regeo: string }[] = []
  if (REGEO) {
    const pts = buildings
      .filter((b) => b.latitude !== null && b.longitude !== null)
      .map((b) => ({ ext: b.externalId, lng: b.longitude as number, lat: b.latitude as number }))
    const regeo = await regeoDistricts(pts)
    districtMismatch = buildings
      .filter((b) => regeo.has(b.externalId) && regeo.get(b.externalId) !== b.districtName)
      .map((b) => ({ ext: b.externalId, name: b.name, site: b.districtName, regeo: regeo.get(b.externalId) as string }))
    writeFileSync(
      join(decisionsDir, 'district-overrides.suggested.json'),
      JSON.stringify(
        {
          note: '对方标注与坐标反查不一致。确认以坐标为准的，写进 decisions/district-overrides.json：{ "<对方楼盘id>": "闵行区" }',
          rows: districtMismatch,
        },
        null,
        2,
      ),
    )
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: { buildings: buildings.length, listings: listings.length, missingDetailPages: missing },
    prod: {
      huizuBuildings: huizuExtInProd.size,
      manualBuildings: prodBuildings.filter((b) => !b.src).length,
      publishedHuizuListings: prodPublished?.length ?? null,
    },
    willCreate: {
      buildings: buildings.filter((b) => !huizuExtInProd.has(b.externalId) && b.attachToBuildingId === null).length,
      buildingsAttached: buildings.filter((b) => b.attachToBuildingId !== null).length,
    },
    retire: retireBlocked
      ? { blocked: retireBlocked }
      : {
          total: retire.length,
          gone: retire.filter((r) => r.reason === 'gone').length,
          notEnumerated: retire.filter((r) => r.reason === 'not-enumerated').length,
          stillAlive: (prodPublished?.length ?? 0) - retire.length,
        },
    attachSuggestions: suggestions.length,
    districtMismatch: REGEO ? districtMismatch.length : '未跑（加 --regeo）',
  }
  writeFileSync(join(DATA, 'dataset', 'reconcile-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
