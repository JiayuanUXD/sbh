/**
 * OPT-016 迁移互斥锁脚本入口
 *
 * 用法：pnpm exec tsx scripts/migrate-locked.ts
 * Dockerfile CMD: pnpm exec tsx scripts/migrate-locked.ts && pnpm start
 *
 * 用 PG advisory lock（会话级）确保 CloudRun 多实例只有一个执行 payload migrate：
 *   - 首个实例拿锁 -> 执行 migrate -> 释放锁
 *   - 其他实例轮询等锁 -> 拿到后 migrate 幂等跳过（payload_migrations 表已记录）
 *   - 等待超时 -> 跳过（依赖幂等性，安全）
 *
 * 生产 fail-closed：payload.init 触发 onInit -> config-guard（OPT-015），
 * 生产 env 缺失时此处抛错，容器启动失败，不切流量。
 */
import payload from 'payload'
import config from '../src/payload.config'
import {
  closeMigrationDb,
  flushProcessOutput,
  runMigrateLocked,
} from '../src/lib/runtime/migrate-lock'

/** advisory lock 标识（'SBMG' = sbh migration guard），所有实例共用同一 ID 才能互斥 */
const LOCK_ID = 0x53424d47
const MAX_WAIT_MS = 180_000
const POLL_MS = 3_000

// 用本地接口描述所需 DB 形状，避免直接 import 'pg'（pnpm 严格模式下非项目直接依赖）
interface PoolClientLike {
  query<T = { acquired?: boolean }>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  release(): void
}
interface PoolLike {
  connect(): Promise<PoolClientLike>
  end(): Promise<void>
}
interface MigratableDb {
  pool: PoolLike
  migrate(): Promise<void>
  destroy?(): Promise<void>
}

async function main(): Promise<void> {
  // 不 disableOnInit：让 OPT-015 config-guard 在迁移前跑（生产 env 缺失则拒绝）
  await payload.init({ config })
  const db = payload.db as unknown as MigratableDb
  const client = await db.pool.connect()

  try {
    const result = await runMigrateLocked({
      tryAcquire: async () => {
        const r = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [LOCK_ID])
        return Boolean(r.rows[0]?.acquired)
      },
      release: async () => {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID])
      },
      runMigrate: async () => {
        await db.migrate()
      },
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
      now: () => Date.now(),
      maxWaitMs: MAX_WAIT_MS,
      pollMs: POLL_MS,
      onStatus: (msg) => {
        if (msg === 'acquired') {
          payload.logger.info('[migrate-locked] 获取迁移锁，执行迁移')
        } else if (msg === 'timeout') {
          payload.logger.warn('[migrate-locked] 等待迁移锁超时，跳过（依赖 payload_migrations 幂等性）')
        } else {
          payload.logger.info('[migrate-locked] 等待迁移锁...')
        }
      },
    })
    if (result === 'acquired') {
      payload.logger.info('[migrate-locked] 迁移完成，已释放锁')
    }
  } finally {
    client.release()
    const closed = await closeMigrationDb(db)
    if (closed !== 'closed') {
      // 不是错误：Payload adapter 会永久占用一个 client，pool.end() 本就可能不返回。
      // 记一行日志便于线上确认走到了这里，随后由 exitProcess 强制退出。
      payload.logger.warn(`[migrate-locked] 连接池未能优雅关闭（${closed}），将强制退出进程`)
    }
  }
}

/**
 * 一次性迁移进程必须**确定性退出**，否则 Dockerfile 的
 * `pnpm exec tsx scripts/migrate-locked.ts && pnpm start` 永远等不到 Next.js 启动。
 *
 * 迁移已经提交到 payload_migrations，此刻残留的句柄（Payload adapter 永不 release 的
 * PostgreSQL client、S3 keep-alive socket 等）都没有清理价值，直接退出是安全的。
 */
async function exitProcess(code: number): Promise<never> {
  await flushProcessOutput()
  process.exit(code)
}

main()
  .then(async () => {
    payload.logger.info('[migrate-locked] 迁移阶段结束，退出码 0，交给 pnpm start')
    await exitProcess(0)
  })
  .catch(async (err) => {
    payload.logger.error({ err }, '[migrate-locked] 迁移失败')
    // 退出码 1 阻止 Shell 继续执行 pnpm start，带着失败的迁移启动服务更危险
    await exitProcess(1)
  })
