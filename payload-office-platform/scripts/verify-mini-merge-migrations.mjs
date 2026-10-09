/** 仅用于本次集成的独立本地库：验证主线升级、原表行数及幂等重跑。 */
import { getPayload } from 'payload'
import config from '../src/payload.config.ts'
import { migrations } from '../src/migrations/index.ts'

async function main() {
  if (process.env.DATABASE_URL !== 'postgres://liujiayuan@127.0.0.1:5432/sbh_dev_mp_merge_20261009') {
    throw new Error('拒绝在指定独立本地库之外执行迁移验证')
  }
  const payload = await getPayload({ config })
  try {
    const mode = process.argv[2]
    const baseline = migrations.slice(0, -1)
    if (mode === 'baseline') {
      await payload.db.migrate({ migrations: baseline })
      console.log(JSON.stringify({ mode, migrationCount: baseline.length }))
      return
    }
    if (mode !== 'upgrade') throw new Error('仅接受 baseline 或 upgrade')
    const tables = await payload.db.pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'payload_migrations' ORDER BY tablename",
    )
    async function counts() {
      const out = {}
      for (const { tablename } of tables.rows) {
        const quoted = tablename.replaceAll('"', '""')
        const result = await payload.db.pool.query(`SELECT count(*)::text AS count FROM "${quoted}"`)
        out[tablename] = Number(result.rows[0].count)
      }
      return out
    }
    const before = await counts()
    await payload.db.migrate({ migrations })
    const after = await counts()
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('主线原表行数发生变化')
    await payload.db.migrate({ migrations })
    const replay = await counts()
    if (JSON.stringify(after) !== JSON.stringify(replay)) throw new Error('幂等重跑改变原表行数')
    const applied = await payload.db.pool.query('SELECT count(*)::text AS count FROM payload_migrations')
    if (Number(applied.rows[0].count) !== migrations.length) throw new Error('实际迁移数量不匹配')
    console.log(JSON.stringify({ mode, before, after, replay, migrationCount: migrations.length }))
  } finally {
    await payload.destroy()
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
