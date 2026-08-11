/**
 * 地理种子数据导入脚本（Task 19）
 *
 * 用法：
 *   node --env-file-if-exists=.env.local --import tsx scripts/import-geography.ts --file seed/geography/hangzhou.json
 *   node --env-file-if-exists=.env.local --import tsx scripts/import-geography.ts --file seed/geography/hangzhou.json --apply
 *   node --env-file-if-exists=.env.local --import tsx scripts/import-geography.ts --file seed/geography/hangzhou.json --apply --update-existing
 *   node --env-file-if-exists=.env.local --import tsx scripts/import-geography.ts --all --dry-run
 *
 * 行为（见计划 Task 19）：
 *   - 先校验后写：解析 → 纯函数校验（src/domain/geography/import-validation.ts）→ 任一失败整文件拒绝。
 *   - dry-run 是默认，--apply 才真正写入。
 *   - 幂等：按 immutableCode 查已存在记录 —— 一致则跳过；不一致则列出差异并默认跳过，
 *     --update-existing 才更新。绝不静默覆盖。
 *   - 严格按 城市 → 行政区 → 商圈 / 线路 → 站点 顺序，逐条 payload.create（过 protectLocation hook）。
 *   - 每条失败单独记录并继续，最后汇总失败清单，退出码非 0。
 *   - 全程日志写 .tmp/geography-import-<city>-<timestamp>.log。
 *
 * 约束：走 Local API，不直接写库，不 overrideAccess。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPayload } from 'payload'
import config from '@/payload.config'
import {
  parseSeedJson,
  validateSeedFile,
  type ImportValidationIssue,
  type SeedBusinessArea,
  type SeedDistrict,
  type SeedFile,
  type SeedMetroLine,
  type SeedStation,
} from '@/domain/geography/import-validation'

const APPLY = process.argv.includes('--apply')
const UPDATE_EXISTING = process.argv.includes('--update-existing')
const ALL = process.argv.includes('--all')
const fileArg = process.argv.indexOf('--file')

// —— 参数处理 ——
if (!ALL && fileArg === -1) {
  console.error('用法：--file <path> 或 --all（--dry-run 默认，--apply 才写库）')
  process.exit(2)
}
const seedFiles: string[] = []
if (ALL) {
  const dir = 'seed/geography'
  const names = readFilePaths(dir)
  seedFiles.push(...names.filter((n) => !n.endsWith('_template.json')).sort())
} else {
  seedFiles.push(process.argv[fileArg + 1])
}

function readFilePaths(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json'))
}

// —— 日志 ——
const logDir = '.tmp'
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
const logLines: string[] = []
function log(line: string): void {
  logLines.push(line)
  console.log(line)
}

// —— 装载 ——
const payload = await getPayload({ config })

type ExistingDoc = {
  id: number | string
  name?: unknown
  status?: unknown
  frontendVisible?: unknown
  sortOrder?: unknown
  centerLatitude?: unknown
  centerLongitude?: unknown
  version?: unknown
  parent?: unknown
}

/** 按 immutableCode 查已存在记录（depth 0，拿 parent id / version）。 */
async function findExisting(code: string): Promise<ExistingDoc | null> {
  const res = await payload.find({
    collection: 'locations',
    where: { immutableCode: { equals: code } },
    limit: 1,
    depth: 0,
  })
  const doc = res.docs[0]
  return doc ? (doc as unknown as ExistingDoc) : null
}
function toId(v: unknown): number | string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'object' && 'id' in (v as object)) {
    const id = (v as { id: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

/** 本运行内已创建/已解析的 code → id，供父级引用解析。 */
const knownIds = new Map<string, number | string>()

/** dry-run 合成的负 id（计划节点无真实 id，仅供父级解析与报告）。 */
let syntheticId = -1

async function resolveId(code: string): Promise<number | string | null> {
  const known = knownIds.get(code)
  if (known !== undefined) return known
  const existing = await findExisting(code)
  if (existing) {
    knownIds.set(code, existing.id)
    return existing.id
  }
  return null
}

// —— 字段(内容)比较：种子控制的可变字段 ——
type ContentFields = {
  name: string
  status: string
  frontendVisible: boolean
  sortOrder: number
  centerLatitude: number | null
  centerLongitude: number | null
}
function contentOf(existing: ExistingDoc): ContentFields {
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
  return {
    name: typeof existing.name === 'string' ? existing.name : '',
    status: existing.status === 'disabled' ? 'disabled' : 'active',
    frontendVisible: existing.frontendVisible === true,
    sortOrder: typeof existing.sortOrder === 'number' ? existing.sortOrder : 100,
    centerLatitude: num(existing.centerLatitude),
    centerLongitude: num(existing.centerLongitude),
  }
}
function seedContent(
  node: { name: string; sortOrder?: number; centerLatitude?: number | null; centerLongitude?: number | null },
): ContentFields {
  return {
    name: node.name,
    status: 'active',
    frontendVisible: false,
    sortOrder: node.sortOrder ?? 100,
    centerLatitude: node.centerLatitude ?? null,
    centerLongitude: node.centerLongitude ?? null,
  }
}
function fieldDiff(existing: ExistingDoc, seed: ContentFields): string[] {
  const cur = contentOf(existing)
  const diffs: string[] = []
  const c = seed
  if (cur.name !== c.name) diffs.push(`name: ${cur.name} → ${c.name}`)
  if (cur.status !== c.status) diffs.push(`status: ${cur.status} → ${c.status}`)
  if (cur.frontendVisible !== c.frontendVisible) diffs.push(`frontendVisible: ${cur.frontendVisible} → ${c.frontendVisible}`)
  if (cur.sortOrder !== c.sortOrder) diffs.push(`sortOrder: ${cur.sortOrder} → ${c.sortOrder}`)
  if (cur.centerLatitude !== c.centerLatitude) diffs.push(`centerLatitude: ${String(cur.centerLatitude)} → ${String(c.centerLatitude)}`)
  if (cur.centerLongitude !== c.centerLongitude) diffs.push(`centerLongitude: ${String(cur.centerLongitude)} → ${String(c.centerLongitude)}`)
  return diffs
}

// —— 逐节点写入（幂等 + 冲突检测） ——
type Counters = { created: number; skipped: number; conflicts: number; updated: number; failed: number }

async function upsertNode(args: {
  code: string
  type: 'city' | 'district' | 'business_area' | 'metro_line' | 'metro_station'
  data: Record<string, unknown>
  content: ContentFields
  expectedParentId: number | string | null
  counters: Counters
}): Promise<void> {
  const { code, type, data, content, expectedParentId, counters } = args
  const existing = await findExisting(code)
  if (!existing) {
    counters.created++
    log(`  ＋ 新建 ${type}「${data.name}」(${code})`)
    if (APPLY) {
      try {
        const created = await payload.create({ collection: 'locations', data: data as never })
        const newId = toId(created?.id) ?? (await reFindId(code))
        if (newId !== null) knownIds.set(code, newId)
      } catch (err) {
        counters.failed++
        log(`  ✗ 新建失败 ${code}: ${errorMessage(err)}`)
      }
    } else {
      // dry-run：注册合成 id，使下游父级解析（城市后的区/线/站）能继续报告。
      knownIds.set(code, syntheticId--)
    }
    return
  }
  knownIds.set(code, existing.id)
  // 父级一致性：existing.parent 须等于预期父级（预期必填时，缺失或不同均记差异）
  const parentDiff: string[] = []
  const curParent = toId(existing.parent)
  if (expectedParentId !== null && (curParent === null || String(curParent) !== String(expectedParentId))) {
    parentDiff.push(`parent: ${curParent === null ? '(空)' : String(curParent)} → ${String(expectedParentId)}`)
  }
  const contentDiffs = fieldDiff(existing, content)
  if (parentDiff.length === 0 && contentDiffs.length === 0) {
    counters.skipped++
    log(`  = 跳过 ${type}「${data.name}」(${code}) 已存在且一致`)
    return
  }
  // 冲突
  counters.conflicts++
  const diffs = [...parentDiff, ...contentDiffs]
  log(`  ! 冲突 ${type}「${data.name}」(${code}):`)
  diffs.forEach((d, i) => log(`      ${i === 0 ? '  ' : ''}${d}`))
  if (!APPLY || !UPDATE_EXISTING) {
    log(`      （默认跳过；--update-existing 才更新）`)
    return
  }
  // --apply --update-existing：更新可变字段
  counters.updated++
  try {
    await payload.update({
      collection: 'locations',
      id: existing.id,
      data: {
        name: content.name,
        status: content.status,
        frontendVisible: content.frontendVisible,
        sortOrder: content.sortOrder,
        centerLatitude: content.centerLatitude ?? null,
        centerLongitude: content.centerLongitude ?? null,
        version: typeof existing.version === 'number' ? existing.version : 1,
      } as never,
    })
  } catch (err) {
    counters.failed++
    log(`  ✗ 更新失败 ${code}: ${errorMessage(err)}`)
  }
}

async function reFindId(code: string): Promise<number | string | null> {
  const existing = await findExisting(code)
  return existing ? existing.id : null
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & { code?: string }
    return e.code ? `${e.code}: ${e.message}` : e.message
  }
  return String(err)
}

// —— 主流程 ——
let anyFailure = false
for (const file of seedFiles) {
  if (!existsSync(file)) {
    log(`✗ 文件不存在: ${file}`)
    anyFailure = true
    continue
  }
  const raw = readFileSync(file, 'utf-8')
  // 解析 + 校验
  let seed: SeedFile
  let issues: ImportValidationIssue[]
  try {
    seed = parseSeedJson(raw) as SeedFile
    issues = validateSeedFile(seed)
  } catch (err) {
    log(`✗ 文件解析失败: ${file} (${errorMessage(err)})`)
    anyFailure = true
    continue
  }
  if (issues.length > 0) {
    log(`✗ 校验失败，整文件拒绝: ${file}`)
    issues.forEach((i) => log(`    [${i.code}] ${i.path}: ${i.message}`))
    anyFailure = true
    continue
  }

  const cityName = seed.city.name
  const cityCode = seed.city.immutableCode
  const counters: Counters = { created: 0, skipped: 0, conflicts: 0, updated: 0, failed: 0 }
  log(`\n===== ${cityName} ${cityCode}（${APPLY ? 'apply' : 'dry-run'}${UPDATE_EXISTING ? ' + update-existing' : ''}）=====`)

  // 1. 城市
  const cityContent = seedContent(seed.city)
  await upsertNode({
    code: cityCode,
    type: 'city',
    data: { name: seed.city.name, slug: seed.city.slug, type: 'city', immutableCode: cityCode, status: 'active', frontendVisible: false, sortOrder: seed.city.sortOrder ?? 100, centerLatitude: seed.city.centerLatitude ?? null, centerLongitude: seed.city.centerLongitude ?? null },
    content: cityContent,
    expectedParentId: null,
    counters,
  })
  const cityId = await resolveId(cityCode)
  if (cityId === null) {
    log(`✗ 城市 ${cityCode} 未能解析 id，跳过该城后续节点`)
    anyFailure = true
    continue
  }

  // 2. 行政区
  for (const d of seed.districts as SeedDistrict[]) {
    await upsertNode({
      code: d.immutableCode,
      type: 'district',
      data: { name: d.name, slug: d.slug, type: 'district', immutableCode: d.immutableCode, parent: cityId, status: 'active', frontendVisible: false, sortOrder: d.sortOrder ?? 100, centerLatitude: d.centerLatitude ?? null, centerLongitude: d.centerLongitude ?? null },
      content: seedContent(d),
      expectedParentId: cityId,
      counters,
    })
  }

  // 3. 商圈（挂行政区）
  for (const b of seed.businessAreas as SeedBusinessArea[]) {
    const districtId = await resolveId(b.districtCode)
    if (districtId === null) {
      counters.failed++
      log(`  ✗ 商圈「${b.name}」的行政区 ${b.districtCode} 未解析，跳过`)
      continue
    }
    await upsertNode({
      code: b.immutableCode,
      type: 'business_area',
      data: { name: b.name, slug: b.slug, type: 'business_area', immutableCode: b.immutableCode, parent: districtId, status: 'active', frontendVisible: false, sortOrder: b.sortOrder ?? 100, centerLatitude: b.centerLatitude ?? null, centerLongitude: b.centerLongitude ?? null },
      content: seedContent(b),
      expectedParentId: districtId,
      counters,
    })
  }

  // 4. 地铁线路 → 站点
  for (const m of seed.metroLines as SeedMetroLine[]) {
    await upsertNode({
      code: m.immutableCode,
      type: 'metro_line',
      data: { name: m.name, slug: m.slug, type: 'metro_line', immutableCode: m.immutableCode, parent: cityId, status: 'active', frontendVisible: false, sortOrder: m.sortOrder ?? 100, centerLatitude: m.centerLatitude ?? null, centerLongitude: m.centerLongitude ?? null },
      content: seedContent(m),
      expectedParentId: cityId,
      counters,
    })
    const lineId = await resolveId(m.immutableCode)
    if (lineId === null) {
      counters.failed++
      log(`  ✗ 线路「${m.name}」未能解析 id，跳过其站点`)
      continue
    }
    for (const s of (m.stations ?? []) as SeedStation[]) {
      await upsertNode({
        code: s.immutableCode,
        type: 'metro_station',
        data: { name: s.name, slug: s.slug, type: 'metro_station', immutableCode: s.immutableCode, parent: lineId, status: 'active', frontendVisible: false, sortOrder: s.sortOrder ?? 100, centerLatitude: s.centerLatitude ?? null, centerLongitude: s.centerLongitude ?? null },
        content: seedContent(s),
        expectedParentId: lineId,
        counters,
      })
    }
  }

  log(`  ── 合计：新建 ${counters.created} ｜ 跳过 ${counters.skipped} ｜ 冲突 ${counters.conflicts} ｜ 更新 ${counters.updated} ｜ 失败 ${counters.failed}`)
  if (counters.failed > 0) anyFailure = true

  // 归档日志
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const logFile = join(logDir, `geography-import-${cityCode}-${ts}.log`)
  writeFileSync(logFile, logLines.join('\n') + '\n', 'utf-8')
  logLines.length = 0
}

if (!APPLY) log('\n（dry-run，未写库；--apply 才执行）')
process.exit(anyFailure ? 1 : 0)