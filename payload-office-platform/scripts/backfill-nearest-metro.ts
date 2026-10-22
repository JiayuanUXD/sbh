/**
 * 楼盘「最近地铁」按坐标回填（OPT-125）。
 *
 * 背景：2026-10-22 生产 4,313 栋楼里只有 14 栋填了 nearestMetro，而 4,308 栋有经纬度、1,236 个地铁站都有坐标。
 * 这个字段前台在用：楼盘卡片「近 X 站」、详情页「地铁」、房源 / 楼盘的地铁筛选、站内搜索按站名匹配——几乎全是空的。
 * 算法与边界见 scripts/lib/nearest-metro.ts。
 *
 * 用法（三步，各自独立，执行前必须有人看过计划）：
 *
 *   pnpm buildings:nearest-metro:plan --out=<目录> [--city=shanghai] [--max-distance=2000]
 *       只读：数据库连接强制 default_transaction_read_only=on、不启动任务队列。输出 plan.json 与 plan-summary.md。
 *       计划阈值可以放宽，用来看分布；真正写多少由 execute 的 --max-distance 决定。
 *
 *   pnpm buildings:nearest-metro:execute --plan=<plan.json> --max-distance=<米> --out=<目录>
 *       写库：只执行计划里距离 ≤ max-distance 的建议（不能比计划阈值更宽）。逐栋复核：仍未填、坐标没变，
 *       再带上读到的 version 经 Local API 更新（并发改过会触发乐观锁冲突、跳过）。每写一栋就追加一行到
 *       applied-<时间>.jsonl，中途中断也能回滚。计划里记录的数据库与当前连接不一致时拒绝执行。
 *
 *   pnpm buildings:nearest-metro:rollback --applied=<applied-….jsonl> --out=<目录>
 *       回滚：只把「当前值仍等于当时写入值」的楼盘改回空，之后被人改过的不动。
 *
 * 幂等：重复执行 execute 时，已填过的楼会因「已有最近地铁」被跳过。
 */
import fs from 'node:fs'
import path from 'node:path'

import {
  DISTANCE_BUCKETS,
  buildNearestMetroPlan,
  lineCoverage,
  selectProposals,
  type BuildingPoint,
  type NearestMetroPlan,
  type Proposal,
  type StationPoint,
} from './lib/nearest-metro'

type Mode = 'plan' | 'execute' | 'rollback'

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}
// biome-ignore lint/suspicious/noConsole: CLI script
const log = (...args: unknown[]) => console.log('[nearest-metro]', ...args)

function modeOf(): Mode {
  if (process.argv.includes('--execute')) return 'execute'
  if (process.argv.includes('--rollback')) return 'rollback'
  return 'plan'
}

/** 数据库标识（主机 + 库名，不含凭据）：计划与执行必须对着同一个库。 */
function databaseFingerprint(url: string): string {
  const u = new URL(url)
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`
}

function requireOut(): string {
  const out = arg('out')
  if (!out) throw new Error('缺少 --out=<目录>')
  fs.mkdirSync(out, { recursive: true })
  return out
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

type PlanFile = NearestMetroPlan & Readonly<{
  generatedAt: string
  database: string
  city: string
  lineNames: Record<string, string>
}>

type DbPool = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

async function plan(): Promise<void> {
  const out = requireOut()
  const city = arg('city') ?? 'shanghai'
  const maxDistance = Number(arg('max-distance') ?? 2000)
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) throw new Error('缺少 DATABASE_URL')
  // 只读：先改连接串再加载配置（同 scripts/verify-homepage-stats-parity.ts）
  const url = new URL(rawUrl)
  url.searchParams.set('options', '-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=120000')
  process.env.DATABASE_URL = url.toString()
  process.env.PAYLOAD_DISABLE_JOB_AUTORUN = '1'
  const { getPayload } = await import('payload')
  const { default: config } = await import('../src/payload.config')
  const payload = await getPayload({ config })
  const pool = (payload.db as unknown as { pool: DbPool }).pool
  try {
    const ro = await pool.query('SHOW default_transaction_read_only')
    if (ro.rows[0]?.default_transaction_read_only !== 'on') throw new Error('数据库连接没有进入只读模式，停止')

    const cityRow = (await pool.query(`SELECT id FROM locations WHERE type = 'city' AND slug = $1`, [city])).rows[0]
    if (!cityRow) throw new Error(`没有 slug=${city} 的城市`)
    const cityId = Number(cityRow.id)
    const stations: StationPoint[] = (
      await pool.query(
        `SELECT id, name, slug, parent_id, city_id, center_latitude, center_longitude FROM locations
         WHERE type = 'metro_station' AND status = 'active' AND city_id = $1
           AND center_latitude IS NOT NULL AND center_longitude IS NOT NULL`,
        [cityId],
      )
    ).rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      slug: String(r.slug),
      lineId: num(r.parent_id),
      cityId: num(r.city_id),
      lat: Number(r.center_latitude),
      lng: Number(r.center_longitude),
    }))
    const lineNames: Record<string, string> = {}
    for (const r of (await pool.query(`SELECT id, name FROM locations WHERE type = 'metro_line' AND city_id = $1`, [cityId])).rows) {
      lineNames[String(r.id)] = String(r.name)
    }
    const buildings: BuildingPoint[] = (
      await pool.query(
        `SELECT id, slug, name, status, city_id, latitude, longitude, nearest_metro_id FROM buildings
         WHERE deleted_at IS NULL AND city_id = $1 ORDER BY id`,
        [cityId],
      )
    ).rows.map((r) => ({
      id: Number(r.id),
      slug: String(r.slug),
      name: String(r.name),
      status: r.status === null ? null : String(r.status),
      cityId: num(r.city_id),
      lat: num(r.latitude),
      lng: num(r.longitude),
      nearestMetroId: num(r.nearest_metro_id),
    }))

    const result = buildNearestMetroPlan({ buildings, stations, maxDistanceMeters: maxDistance })
    const file: PlanFile = { generatedAt: new Date().toISOString(), database: databaseFingerprint(rawUrl), city, lineNames, ...result }
    fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(file, null, 2))
    fs.writeFileSync(path.join(out, 'plan-summary.md'), summarize(file, stations))
    log(`计划已写入 ${out}：建议 ${result.counts.proposals} 栋（≤ ${maxDistance}m），超出阈值 ${result.counts.tooFar} 栋，坐标异常 ${result.counts.invalidCoordinates} 栋`)
  } finally {
    await payload.db.destroy?.()
  }
}

function summarize(file: PlanFile, stations: readonly StationPoint[]): string {
  const c = file.counts
  const d = file.distribution
  const pct = (n: number) => (d.count === 0 ? '0%' : `${((n / d.count) * 100).toFixed(1)}%`)
  const stationName = new Map(stations.map((s) => [s.id, s.name]))
  const lines = new Map(Object.entries(file.lineNames).map(([id, name]) => [Number(id), name]))
  const byStation = new Map<number, number>()
  for (const p of file.proposals) byStation.set(p.stationId, (byStation.get(p.stationId) ?? 0) + 1)
  const topStations = [...byStation.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  const sample = file.proposals.filter((_, i) => i % Math.max(1, Math.floor(file.proposals.length / 20)) === 0).slice(0, 20)
  const disagreements = file.alreadySet.filter((a) => a.computed && a.computed.stationId !== a.currentStationId)
  const row = (p: Proposal) => `| ${p.buildingId} | ${p.buildingName} | ${p.stationName} | ${lines.get(p.lineId ?? -1) ?? '—'} | ${p.distanceMeters} |`
  return [
    `# 楼盘最近地铁回填计划（OPT-125）`,
    '',
    `- 生成时间：${file.generatedAt}`,
    `- 数据库：${file.database}（只读连接）`,
    `- 城市：${file.city}；站点 ${stations.length} 个；计划阈值 ${file.maxDistanceMeters}m（直线距离）`,
    '',
    '## 数量',
    '',
    '| 项 | 楼盘数 |',
    '| --- | --- |',
    `| 本城市楼盘（未删除） | ${c.buildings} |`,
    `| 已填最近地铁（不动） | ${c.alreadySet} |`,
    `| 没有坐标 | ${c.noCoordinates} |`,
    `| 坐标异常（人工处理） | ${c.invalidCoordinates} |`,
    `| 参与计算 | ${d.count} |`,
    `| 阈值内，建议回填 | ${c.proposals} |`,
    `| 超出阈值，不回填 | ${c.tooFar} |`,
    '',
    '## 到最近站的直线距离',
    '',
    `P10 ${d.p10}m · P25 ${d.p25}m · 中位数 ${d.median}m · P75 ${d.p75}m · P90 ${d.p90}m · 最远 ${d.max}m`,
    '',
    '| 阈值（直线） | 能回填的楼盘 | 占参与计算 |',
    '| --- | --- | --- |',
    ...DISTANCE_BUCKETS.map((b) => `| ≤ ${b}m | ${d.within[String(b)]} | ${pct(d.within[String(b)])} |`),
    '',
    '步行距离一般比直线长 20%–40%：直线 800m 大约是步行 1 公里出头。',
    '',
    '## 按线路（阈值内建议）',
    '',
    '换乘站在库里只挂首开线路，换乘站多的线路（1、2、8、10 号线等）会被低估。',
    '',
    '| 线路 | 楼盘数 |',
    '| --- | --- |',
    ...lineCoverage(file.proposals, lines).map((l) => `| ${l.lineName} | ${l.buildings} |`),
    '',
    '## 楼盘最多的站（阈值内建议，前 15）',
    '',
    '| 站 | 楼盘数 |',
    '| --- | --- |',
    ...topStations.map(([id, n]) => `| ${stationName.get(id) ?? id} | ${n} |`),
    '',
    '## 抽样（按 id 均匀取 20 条，供人工核对）',
    '',
    '| 楼盘 id | 楼盘 | 最近站 | 线路 | 直线距离 m |',
    '| --- | --- | --- | --- | --- |',
    ...sample.map(row),
    '',
    `## 坐标异常（${file.invalid.length}，不回填）`,
    '',
    ...(file.invalid.length === 0 ? ['无'] : ['| 楼盘 id | 楼盘 | 纬度 | 经度 | 原因 |', '| --- | --- | --- | --- | --- |', ...file.invalid.map((i) => `| ${i.buildingId} | ${i.buildingName} | ${i.lat} | ${i.lng} | ${i.reason} |`)]),
    '',
    `## 已填值与坐标计算不一致（${disagreements.length}，不改，供人工看）`,
    '',
    ...(disagreements.length === 0
      ? ['无']
      : ['| 楼盘 id | 楼盘 | 现填站 | 按坐标最近站 | 距离 m |', '| --- | --- | --- | --- | --- |', ...disagreements.map((a) => `| ${a.buildingId} | ${a.buildingName} | ${stationName.get(a.currentStationId) ?? a.currentStationId} | ${a.computed?.stationName} | ${a.computed?.distanceMeters} |`)]),
    '',
    '## 超出阈值、离得最远的 20 栋',
    '',
    '| 楼盘 id | 楼盘 | 最近站 | 线路 | 直线距离 m |',
    '| --- | --- | --- | --- | --- |',
    ...[...file.tooFar].sort((a, b) => b.distanceMeters - a.distanceMeters).slice(0, 20).map(row),
    '',
  ].join('\n')
}

async function withPayload<T>(fn: (payload: import('payload').Payload) => Promise<T>): Promise<T> {
  process.env.PAYLOAD_DISABLE_JOB_AUTORUN = '1'
  const { getPayload } = await import('payload')
  const { default: config } = await import('../src/payload.config')
  const payload = await getPayload({ config })
  try {
    return await fn(payload)
  } finally {
    await payload.db.destroy?.()
  }
}

const idOf = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'number' ? (v as { id: number }).id : null)
/** numeric 列经不同读法可能是 number 或数字字符串，按数值比较 */
const sameCoord = (a: unknown, b: number) => (typeof a === 'number' || (typeof a === 'string' && a.trim() !== '')) && Math.abs(Number(a) - b) < 1e-9

async function execute(): Promise<void> {
  const out = requireOut()
  const planPath = arg('plan')
  const maxRaw = arg('max-distance')
  if (!planPath || !maxRaw) throw new Error('执行要同时给 --plan=<plan.json> 和 --max-distance=<米>（阈值必须显式确认）')
  const file = JSON.parse(fs.readFileSync(planPath, 'utf8')) as PlanFile
  const current = databaseFingerprint(process.env.DATABASE_URL ?? '')
  if (file.database !== current) throw new Error(`计划是对着 ${file.database} 出的，当前连接是 ${current}：拒绝执行`)
  const selected = selectProposals(file, Number(maxRaw))
  const appliedPath = path.join(out, `applied-${timestamp()}.jsonl`)
  const skipped: Array<{ buildingId: number; reason: string }> = []
  let applied = 0
  log(`执行计划 ${planPath}：阈值 ${maxRaw}m 内 ${selected.length} 栋 → 回滚清单 ${appliedPath}`)
  await withPayload(async (payload) => {
    for (const [i, p] of selected.entries()) {
      try {
        const doc = (await payload.findByID({ collection: 'buildings', id: p.buildingId, depth: 0 })) as unknown as Record<string, unknown>
        if (idOf(doc.nearestMetro) !== null) skipped.push({ buildingId: p.buildingId, reason: '已有最近地铁' })
        else if (!sameCoord(doc.latitude, p.lat) || !sameCoord(doc.longitude, p.lng)) skipped.push({ buildingId: p.buildingId, reason: '坐标与计划时不同' })
        else {
          await payload.update({
            collection: 'buildings',
            id: p.buildingId,
            data: { nearestMetro: p.stationId, version: typeof doc.version === 'number' ? doc.version : undefined },
            depth: 0,
          })
          fs.appendFileSync(appliedPath, `${JSON.stringify({ buildingId: p.buildingId, stationId: p.stationId, distanceMeters: p.distanceMeters, at: new Date().toISOString() })}\n`)
          applied += 1
        }
      } catch (error) {
        skipped.push({ buildingId: p.buildingId, reason: error instanceof Error ? error.message : String(error) })
      }
      if ((i + 1) % 200 === 0) log(`  进度 ${i + 1}/${selected.length}，已写 ${applied}`)
    }
  })
  fs.writeFileSync(path.join(out, `execute-skipped-${timestamp()}.json`), JSON.stringify(skipped, null, 2))
  log(`完成：写入 ${applied} 栋，跳过 ${skipped.length} 栋（原因见 execute-skipped-*.json）`)
}

async function rollback(): Promise<void> {
  const out = requireOut()
  const appliedPath = arg('applied')
  if (!appliedPath) throw new Error('缺少 --applied=<applied-….jsonl>')
  const entries = fs
    .readFileSync(appliedPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { buildingId: number; stationId: number })
  const resultPath = path.join(out, `rollback-${timestamp()}.jsonl`)
  let reverted = 0
  await withPayload(async (payload) => {
    for (const e of entries) {
      let outcome: string
      try {
        const doc = (await payload.findByID({ collection: 'buildings', id: e.buildingId, depth: 0 })) as unknown as Record<string, unknown>
        if (idOf(doc.nearestMetro) !== e.stationId) outcome = '当前值已不是当时写入的站，不动'
        else {
          await payload.update({
            collection: 'buildings',
            id: e.buildingId,
            data: { nearestMetro: null, version: typeof doc.version === 'number' ? doc.version : undefined },
            depth: 0,
          })
          outcome = '已改回空'
          reverted += 1
        }
      } catch (error) {
        outcome = `失败：${error instanceof Error ? error.message : String(error)}`
      }
      fs.appendFileSync(resultPath, `${JSON.stringify({ ...e, outcome })}\n`)
    }
  })
  log(`回滚完成：${reverted}/${entries.length} 栋改回空，明细 ${resultPath}`)
}

const mode = modeOf()
;(mode === 'execute' ? execute() : mode === 'rollback' ? rollback() : plan())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[nearest-metro] failed:', err)
    process.exit(1)
  })
