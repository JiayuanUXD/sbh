/**
 * 高德坐标采集脚本（Task 20 半自动采集，独立于离线导入脚本 import-geography.ts）
 *
 * 用法：
 *   node --env-file-if-exists=.env.local --import tsx scripts/collect-geography.ts --skeleton seed/geography/_collect/hangzhou.skeleton.json
 *   node --env-file-if-exists=.env.local --import tsx scripts/collect-geography.ts --all
 *
 * 输入：骨架 JSON（名称 + immutableCode + slug + 层级，坐标为 null/缺省），
 *       结构同 SeedFile（见 seed/geography/schema.md）。
 * 输出：填充坐标的完整种子 JSON，写到 seed/geography/{slug}.json。
 *
 * 行为：
 *   - 行政区→高德地理编码 v3/geocode/geo（城市+区名）。
 *   - 商圈→高德 POI 文本搜索 v3/place/text（keywords=商圈名，city=城市）。
 *   - 地铁站→高德 POI 文本搜索 v3/place/text（keywords=站名，city=城市，types=150500 地铁站）。
 *   - 城市中心→地理编码（城市名）。
 *   - 逐条限速（默认 ~330ms，3 QPS），失败节点记入清单并写 null，供人工修名后重跑。
 *
 * 约束：脚本自身联网（仅调用高德 Web 服务），与离线导入脚本职责分离；
 *       API key 只读环境变量 AMAP_KEY，绝不入库。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const KEY = process.env.AMAP_WEB_SERVICE_KEY ?? process.env.AMAP_KEY ?? ''
const RATE_MS = Number(process.env.AMAP_RATE_MS ?? 330)
const BASE = 'https://restapi.amap.com/v3'

if (!KEY) {
  console.error('缺少 AMAP_WEB_SERVICE_KEY（或 AMAP_KEY）环境变量（高德 Web 服务 key）。请配置到 .env.local')
  process.exit(2)
}

const ALL = process.argv.includes('--all')
const skeletonArg = process.argv.indexOf('--skeleton')
let skeletonFiles: string[] = []
if (ALL) {
  const dir = 'seed/geography/_collect'
  skeletonFiles = readdirSync(dir).filter((f) => f.endsWith('.skeleton.json')).sort()
} else if (skeletonArg !== -1) {
  skeletonFiles.push(process.argv[skeletonArg + 1])
} else {
  console.error('用法：--skeleton <path> 或 --all')
  process.exit(2)
}

// —— 限流 ——
let last = 0
async function pace(): Promise<void> {
  const now = Date.now()
  const wait = last ? Math.max(0, RATE_MS - (now - last)) : 0
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
}

async function amap(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  await pace()
  const qs = new URLSearchParams({ key: KEY, ...params }).toString()
  const res = await fetch(`${BASE}${path}?${qs}`)
  if (!res.ok) throw new Error(`高德 HTTP ${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

/** 行政区 / 城市中心：地理编码。返回 [lng, lat] 或 null。 */
async function geocode(address: string): Promise<[number, number] | null> {
  const j = await amap('/geocode/geo', { address, city: address })
  const geocodes = j.geocodes as Array<{ location?: string }> | undefined
  const loc = geocodes?.[0]?.location
  if (!loc) return null
  const [lng, lat] = loc.split(',').map(Number)
  if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat]
  return null
}

/** POI 文本搜索。返回 { name, lng, lat } 或 null。 */
async function poiSearch(keywords: string, city: string, types?: string): Promise<{ name: string; location: [number, number] } | null> {
  const params: Record<string, string> = {
    keywords,
    city,
    citylimit: 'true',
    offset: '1',
    extensions: 'base',
  }
  if (types) params.types = types
  const j = await amap('/place/text', params)
  const pois = j.pois as Array<{ name?: string; location?: string }> | undefined
  const p = pois?.[0]
  if (!p?.location) return null
  const [lng, lat] = p.location.split(',').map(Number)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return { name: p.name ?? '', location: [lng, lat] }
}

type Counters = { ok: number; fail: number }
const failures: string[] = []

interface Node {
  name: string
  immutableCode: string
  slug: string
  centerLatitude?: number | null
  centerLongitude?: number | null
  sortOrder?: number
}
interface District extends Node {}
interface BA extends Node { districtCode: string }
interface Station extends Node {}
interface Line { name: string; immutableCode: string; slug: string; sortOrder?: number; stations?: Station[] }
interface City extends Node {}
interface Skeleton {
  city: City
  districts: District[]
  businessAreas: BA[]
  metroLines: Line[]
}

function withCoords(node: Node, coords: [number, number] | null, kind: string, counters: Counters): void {
  if (coords) {
    node.centerLatitude = Number(coords[1].toFixed(6))
    node.centerLongitude = Number(coords[0].toFixed(6))
    counters.ok++
  } else {
    node.centerLatitude = null
    node.centerLongitude = null
    counters.fail++
    failures.push(`[${kind}] ${node.immutableCode} ${node.name} 未解析到坐标`)
  }
}

async function run(skeletonPath: string): Promise<void> {
  const raw = readFileSync(skeletonPath, 'utf-8')
  const s = JSON.parse(raw) as Skeleton
  const cityCode = s.city.immutableCode
  const cityName = s.city.name
  const counters: Counters = { ok: 0, fail: 0 }
  console.log(`\n===== 采集 ${cityName} ${cityCode} =====`)

  // 城市中心
  const cityCoord = await geocode(cityName)
  withCoords(s.city, cityCoord, 'city', counters)
  console.log(`  城市 ${cityName}: ${s.city.centerLatitude}, ${s.city.centerLongitude}`)

  // 行政区
  for (const d of s.districts) {
    const c = await geocode(`${cityName}${d.name}`)
    withCoords(d, c, 'district', counters)
    console.log(`  区 ${d.name}: ${d.centerLatitude}, ${d.centerLongitude}`)
  }

  // 商圈
  for (const b of s.businessAreas) {
    const p = await poiSearch(b.name, cityName)
    withCoords(b, p ? p.location : null, 'business_area', counters)
    console.log(`  商圈 ${b.name}: ${b.centerLatitude}, ${b.centerLongitude}${p && p.name !== b.name ? `（POI 命中「${p.name}」）` : ''}`)
  }

  // 线路 → 站点
  for (const m of s.metroLines) {
    for (const st of m.stations ?? []) {
      // 带类型 150500 搜索失败时，去掉类型过滤兜底重试一次（部分站点高德未归入地铁站类型）
      let p = await poiSearch(st.name, cityName, '150500')
      if (!p) p = await poiSearch(st.name, cityName)
      withCoords(st, p ? p.location : null, 'metro_station', counters)
      console.log(`  站 ${st.name}: ${st.centerLatitude}, ${st.centerLongitude}`)
    }
  }

  console.log(`  ── 解析成功 ${counters.ok} ｜ 失败 ${counters.fail}`)

  // 写输出（骨架可带 _header:string[] 作为文件头注释行，逐行写 // 前缀）
  const outDir = 'seed/geography'
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const slug = s.city.slug
  const outPath = join(outDir, `${slug}.json`)
  const header = (s as { _header?: string[] })._header ?? []
  const headerBlock = header.length > 0 ? header.map((h) => `// ${h}`).join('\n') : ''
  delete (s as { _header?: unknown })._header
  const body = JSON.stringify(s, null, 2)
  writeFileSync(outPath, (headerBlock ? headerBlock + '\n' : '') + body + '\n', 'utf-8')
  console.log(`  已写 ${outPath}`)
}

for (const f of skeletonFiles) {
  if (!existsSync(f)) {
    console.error(`✗ 骨架不存在: ${f}`)
    continue
  }
  await run(f)
}

console.log('\n—— 未解析节点清单 ——')
if (failures.length === 0) {
  console.log('（无）')
} else {
  failures.forEach((x) => console.log('  ' + x))
  console.log(`\n共 ${failures.length} 个未解析。请核对节点名后修正骨架重跑。`)
  process.exitCode = 1
}