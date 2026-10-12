/** 对首页适配器各查询计时；连接强制只读，不记录房源内容。 */
import { writeFile } from 'node:fs/promises'
import { getPayload } from 'payload'
import { getHomepage } from '@/domain/public-catalog/facade'
import { createPayloadSupplyAdapter, type SupplyAdapter } from '@/domain/public-catalog/supply-adapter'
import { createSearchContext } from '@/domain/public-catalog/types'

const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
databaseUrl.searchParams.set('options', '-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=120000')
process.env.DATABASE_URL = databaseUrl.toString()
process.env.PAYLOAD_DISABLE_JOB_AUTORUN = '1'
const { default: config } = await import('@/payload.config')
const payload = await getPayload({ config })
const pool = (payload.db as unknown as {
  pool: { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }
}).pool
const records: { query: string; elapsedMs: number; count?: number }[] = []
const sqlRecords: { query: string; elapsedMs: number; count: number }[] = []
const query = pool.query.bind(pool)
pool.query = async (sql, values) => {
  const kind = typeof sql !== 'string' ? null
    : sql.includes('SELECT l.listing_type::text') ? 'types'
    : sql.includes('SELECT l.id, l.slug') ? 'nearby' : null
  if (!kind) return query(sql, values)
  const start = Date.now()
  console.log(JSON.stringify({ sql: kind, phase: 'start' }))
  const result = await query(sql, values)
  const record = { query: kind, elapsedMs: Date.now() - start, count: result.rows.length }
  sqlRecords.push(record)
  console.log(JSON.stringify(record))
  if (process.env.PROFILE_EXPLAIN === '1') {
    const explained = await query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, values)
    const plan = explained.rows[0]?.['QUERY PLAN'] as { Plan: Record<string, unknown>; 'Execution Time': number }[]
    const nodes: Record<string, unknown>[] = []
    const visit = (node: Record<string, unknown>) => {
      nodes.push({ node: node['Node Type'], relation: node['Relation Name'],
        time: node['Actual Total Time'], loops: node['Actual Loops'], rows: node['Actual Rows'],
        removed: node['Rows Removed by Filter'], read: node['Shared Read Blocks'], hit: node['Shared Hit Blocks'] })
      for (const child of (node.Plans ?? []) as Record<string, unknown>[]) visit(child)
    }
    visit(plan[0].Plan)
    console.log(JSON.stringify({ sql: kind, executionMs: plan[0]['Execution Time'], nodes }))
  }
  return result
}
try {
  const readOnly = await pool.query('SHOW default_transaction_read_only')
  if (readOnly.rows[0]?.default_transaction_read_only !== 'on') throw new Error('首页诊断连接未进入只读模式')
  const adapter = createPayloadSupplyAdapter()
  const traced = new Proxy(adapter, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return async (...args: unknown[]) => {
        const start = Date.now()
        console.log(JSON.stringify({ query: String(property), phase: 'start' }))
        const result: unknown = await value.apply(target, args)
        const record = { query: String(property), elapsedMs: Date.now() - start,
          ...(Array.isArray(result) ? { count: result.length } : {}) }
        records.push(record)
        console.log(JSON.stringify(record))
        return result
      }
    },
  }) as SupplyAdapter
  const start = Date.now()
  const ctx = createSearchContext(process.argv[2] ?? 'shanghai', new Date(), 'lease')
  const homepage = await getHomepage(ctx, {}, traced)
  const result = { at: new Date().toISOString(), city: ctx.city, elapsedMs: Date.now() - start,
    stats: homepage.stats, records, sqlRecords }
  console.log(JSON.stringify(result))
  if (process.env.PROFILE_OUTPUT) await writeFile(process.env.PROFILE_OUTPUT, JSON.stringify(result, null, 2))
} finally {
  await payload.db.destroy?.()
}
process.exit(0)
