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
 *   - **存量为准、只补差集**（审核修复 P0-1）：种子节点可声明 legacyCodes（存量旧编码）；
 *     命中后沿用存量节点（不改名/不改码/不改 slug），只把它当作下级父级，避免同一个
 *     现实对象被当成新节点再建一遍而产生「重复双树」。每城结束报告未认领的存量节点。
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

// —— 非本地库防护（审核修复 P0-2）——
// 生产是共享 TencentDB，误对着它跑 --apply 会直接写入 1500+ 条且没有一键回滚。
// dry-run 只读，任何库都放行；--apply 对非 localhost 库要求显式声明目标库名。
if (APPLY) {
  const dbUrl = process.env.DATABASE_URL ?? ''
  let host = ''
  let dbName = ''
  try {
    const u = new URL(dbUrl)
    host = u.hostname
    dbName = u.pathname.replace(/^\//, '')
  } catch {
    console.error(`✗ DATABASE_URL 无法解析，拒绝 --apply：${dbUrl ? '(格式非法)' : '(未设置)'}`)
    process.exit(2)
  }
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  if (!isLocal) {
    const confirmArg = process.argv.indexOf('--confirm-db')
    const confirmed = confirmArg !== -1 ? process.argv[confirmArg + 1] : undefined
    if (confirmed !== dbName) {
      console.error(
        [
          `✗ 目标库不在本机（host=${host}, db=${dbName}），拒绝 --apply。`,
          `  确认这是你要写入的库后，追加：--confirm-db ${dbName}`,
          `  写入生产前请先备份，并已核对 dry-run 输出的冲突清单。`,
        ].join('\n'),
      )
      process.exit(2)
    }
    console.warn(`⚠ 正在对非本机库执行写入：host=${host}, db=${dbName}`)
  }
}
const seedFiles: string[] = []
if (ALL) {
  const dir = 'seed/geography'
  const names = readFilePaths(dir)
  // readdirSync 只返回文件名，必须拼上目录才是可读路径（原实现漏了 join，
  // --all 一直是「文件不存在」全量失败，此前的分城导入都是逐个 --file 跑的）
  seedFiles.push(...names.filter((n) => !n.endsWith('_template.json')).sort().map((n) => join(dir, n)))
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

/**
 * 按 immutableCode 或存量别名查已存在记录（depth 0，拿 parent id / version）。
 *
 * 「存量为准、只补差集」（审核修复 P0-1）：先按本规范的 immutableCode 精确匹配；
 * 未命中再按种子声明的 legacyCodes 匹配存量旧编码。命中别名时返回 matchedByLegacy，
 * 调用方据此**沿用存量节点**（不改名/不改码/不改 slug），只把它当作下级的父级。
 */
async function findExisting(
  code: string,
  legacyCodes: readonly string[] = [],
): Promise<(ExistingDoc & { matchedByLegacy?: string }) | null> {
  const byCode = await payload.find({
    collection: 'locations',
    where: { immutableCode: { equals: code } },
    limit: 1,
    depth: 0,
  })
  if (byCode.docs[0]) return byCode.docs[0] as unknown as ExistingDoc

  for (const legacy of legacyCodes) {
    const res = await payload.find({
      collection: 'locations',
      where: { immutableCode: { equals: legacy } },
      limit: 1,
      depth: 0,
    })
    if (res.docs[0]) {
      return { ...(res.docs[0] as unknown as ExistingDoc), matchedByLegacy: legacy }
    }
  }
  return null
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

/** 名称归一化：去掉行政区划后缀与空白，用于「可能对应」提示（仅提示，不自动合并） */
function normalizeName(name: string): string {
  return name.trim().replace(/[市区县]$/u, '').replace(/\s+/g, '')
}

/** 摊平种子的全部节点（含站点），返回 [code, name] 与 legacyCodes 集合 */
function seedNodeIndex(seed: SeedFile): {
  codes: Set<string>
  legacy: Set<string>
  byNormName: Map<string, string>
} {
  const codes = new Set<string>()
  const legacy = new Set<string>()
  const byNormName = new Map<string, string>()
  const add = (n: { name: string; immutableCode: string; legacyCodes?: string[] }) => {
    codes.add(n.immutableCode)
    for (const l of n.legacyCodes ?? []) legacy.add(l)
    const key = normalizeName(n.name)
    if (!byNormName.has(key)) byNormName.set(key, n.immutableCode)
  }
  add(seed.city)
  seed.districts.forEach(add)
  seed.businessAreas.forEach(add)
  seed.metroLines.forEach((m) => {
    add(m)
    ;(m.stations ?? []).forEach(add)
  })
  return { codes, legacy, byNormName }
}

/**
 * 报告该城下未被种子认领的存量节点。
 *
 * 「未认领」= 存量节点的 immutableCode 既不在种子 codes 里、也不在任何 legacyCodes 里。
 * 这类节点要么是种子该覆盖但漏了 legacyCodes 声明（→ 会造成重复建点），
 * 要么是真正的历史遗留（→ 该停用或删除）。两种都需要人工判断，脚本不自动处置。
 */
async function reportUnclaimed(seed: SeedFile, cityId: number | string | null): Promise<void> {
  // dry-run 下城市是合成负 id（库里还没有），无存量可查
  if (cityId === null || (typeof cityId === 'number' && cityId < 0)) return

  const { codes, legacy, byNormName } = seedNodeIndex(seed)
  const res = await payload.find({
    collection: 'locations',
    where: { or: [{ id: { equals: cityId } }, { city: { equals: cityId } }] },
    limit: 5000,
    depth: 0,
  })
  const unclaimed = (res.docs as unknown as Array<{ id: number | string; name?: unknown; type?: unknown; immutableCode?: unknown }>)
    .filter((d) => {
      const code = typeof d.immutableCode === 'string' ? d.immutableCode : ''
      return code !== '' && !codes.has(code) && !legacy.has(code)
    })

  if (unclaimed.length === 0) return
  log(`  ⚠ 该城有 ${unclaimed.length} 个存量节点未被种子认领：`)
  for (const d of unclaimed.slice(0, 50)) {
    const name = typeof d.name === 'string' ? d.name : ''
    const guess = byNormName.get(normalizeName(name))
    const hint = guess ? `  ← 疑似对应种子 ${guess}，若确认请在种子里加 legacyCodes: ["${String(d.immutableCode)}"]` : '  （种子里无同名节点，可能是应停用的历史遗留）'
    log(`      ${String(d.type)} 「${name}」(${String(d.immutableCode)}, id=${d.id})${hint}`)
  }
  if (unclaimed.length > 50) log(`      …另有 ${unclaimed.length - 50} 个未列出`)
}

// —— 逐节点写入（幂等 + 冲突检测） ——
type Counters = {
  created: number
  skipped: number
  conflicts: number
  updated: number
  failed: number
  /** 命中存量别名、按「存量为准」沿用的节点数 */
  adopted: number
}

async function upsertNode(args: {
  code: string
  type: 'city' | 'district' | 'business_area' | 'metro_line' | 'metro_station'
  data: Record<string, unknown>
  content: ContentFields
  expectedParentId: number | string | null
  counters: Counters
  legacyCodes?: readonly string[]
}): Promise<void> {
  const { code, type, data, content, expectedParentId, counters, legacyCodes = [] } = args
  const existing = await findExisting(code, legacyCodes)

  // —— 存量为准：命中别名即沿用存量节点，不改名/不改码/不改 slug ——
  // 这里必须 return，绝不能走下面的 fieldDiff/更新分支：种子里的规范名称与
  // 新编码只在「库里还没有这个现实对象」时才用得上；对象已存在时，改它的名字
  // 或编码会波及所有引用它的房源 / 线索 / 楼盘，正是本策略要避免的。
  if (existing?.matchedByLegacy) {
    counters.adopted++
    knownIds.set(code, existing.id)
    const cur = contentOf(existing)
    log(
      `  ≡ 沿用存量 ${type}「${cur.name}」(存量码 ${existing.matchedByLegacy} ← 种子码 ${code}, id=${existing.id})`,
    )
    if (cur.name !== content.name) {
      log(`      名称差异（保留存量，不改写）：${cur.name} ← 种子「${content.name}」`)
    }
    return
  }
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
  const counters: Counters = { created: 0, skipped: 0, conflicts: 0, updated: 0, failed: 0, adopted: 0 }
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
    legacyCodes: seed.city.legacyCodes ?? [],
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
      legacyCodes: d.legacyCodes ?? [],
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
      legacyCodes: b.legacyCodes ?? [],
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
      legacyCodes: m.legacyCodes ?? [],
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
        legacyCodes: s.legacyCodes ?? [],
      })
    }
  }

  // 5. 未认领存量节点报告（「存量为准」的审计面）
  //
  // 种子没有 legacyCodes 声明时，同一个现实对象会被当成新节点再建一遍 —— 这正是
  // 重复双树的成因，且它「静默成功」，不报错。故每城结束后反查：该城下还有哪些
  // 存量节点既不在种子的 immutableCode 集合、也不在 legacyCodes 集合里，并按名称
  // 给出可能的对应关系供人工判断。只报告、不自动合并。
  await reportUnclaimed(seed, cityId)

  log(`  ── 合计：新建 ${counters.created} ｜ 沿用存量 ${counters.adopted} ｜ 跳过 ${counters.skipped} ｜ 冲突 ${counters.conflicts} ｜ 更新 ${counters.updated} ｜ 失败 ${counters.failed}`)
  if (counters.failed > 0) anyFailure = true

  // 归档日志
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const logFile = join(logDir, `geography-import-${cityCode}-${ts}.log`)
  writeFileSync(logFile, logLines.join('\n') + '\n', 'utf-8')
  logLines.length = 0
}

if (!APPLY) log('\n（dry-run，未写库；--apply 才执行）')
process.exit(anyFailure ? 1 : 0)