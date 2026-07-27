/**
 * 迁移执行互斥锁（OPT-016：迁移单次执行）
 *
 * 完成标准：迁移在发布流程中单次执行，多实例不并发竞争。
 *
 * 背景：Dockerfile CMD `payload migrate && pnpm start` 在 CloudRun 多实例部署时，
 * 多个新实例同时启动会并发跑迁移，竞争 payload_migrations 表。本模块用 PG
 * advisory lock（会话级）作为互斥信号量：第一个实例拿锁执行迁移，其他实例
 * 等待锁释放后再跑（此时 payload_migrations 表已记录，migrate 幂等跳过）。
 *
 * 设计：runMigrateLocked 是纯函数，所有副作用（tryAcquire / release / runMigrate /
 * sleep / now）通过注入提供，便于单元测试覆盖重试、超时、异常释放路径。
 * 脚本入口 scripts/migrate-locked.ts 负责接 PG pool 并调用本函数。
 */

export type TryAcquireLock = () => Promise<boolean>
export type ReleaseLock = () => Promise<void>
export type RunMigrate = () => Promise<void>
export type Sleeper = (ms: number) => Promise<void>
export type Now = () => number
export type StatusReporter = (msg: string) => void

type ClosableMigrationDb = {
  destroy?: () => Promise<void>
  pool: {
    end: () => Promise<void>
  }
}

/** setTimeout 的可注入形式，返回取消函数；便于单测不依赖真实计时器 */
export type TimerCanceller = () => void
export type TimerScheduler = (fn: () => void, ms: number) => TimerCanceller

const defaultScheduler: TimerScheduler = (fn, ms) => {
  const timer = setTimeout(fn, ms)
  // 看门狗自身不能把进程钉在事件循环里
  timer.unref?.()
  return () => clearTimeout(timer)
}

export type MigrateLockedResult = 'acquired' | 'timeout'

export type RunMigrateLockedOptions = {
  tryAcquire: TryAcquireLock
  release: ReleaseLock
  runMigrate: RunMigrate
  sleep: Sleeper
  now: Now
  maxWaitMs: number
  pollMs: number
  onStatus?: StatusReporter
}

/**
 * 在 advisory lock 保护下执行迁移。
 *
 * 流程：
 *   1. 轮询 tryAcquire 直到拿到锁或超时
 *   2. 拿到锁 -> 执行 runMigrate -> finally 释放锁
 *   3. 超时 -> 返回 'timeout'，不执行迁移（依赖 payload_migrations 幂等性，跳过安全）
 *
 * @returns 'acquired' 表示本实例执行了迁移；'timeout' 表示等待锁超时跳过
 */
export async function runMigrateLocked(
  opts: RunMigrateLockedOptions,
): Promise<MigrateLockedResult> {
  const { tryAcquire, release, runMigrate, sleep, now, maxWaitMs, pollMs, onStatus } = opts

  const start = now()
  let acquired = false
  while (now() - start < maxWaitMs) {
    if (await tryAcquire()) {
      acquired = true
      break
    }
    onStatus?.('retry')
    await sleep(pollMs)
  }

  if (!acquired) {
    onStatus?.('timeout')
    return 'timeout'
  }

  onStatus?.('acquired')
  try {
    await runMigrate()
  } finally {
    // 即使迁移抛错也必须释放锁，否则其他实例会等到超时
    await release().catch(() => {})
  }
  return 'acquired'
}

export type CloseMigrationDbResult = 'closed' | 'failed' | 'timeout'

export type CloseMigrationDbOptions = {
  timeoutMs?: number
  schedule?: TimerScheduler
}

/** 关闭连接池的等待上界：超过就放弃优雅关闭，交由调用方强制退出 */
export const CLOSE_DB_TIMEOUT_MS = 5_000

/**
 * 尽力关闭迁移用的数据库连接，**带超时上界且绝不抛错**。
 *
 * 为什么必须有上界（sbh-011 / sbh-012 启动失败的真因）：
 *   1. Payload 3.86 postgres adapter 的 destroy() 只重置 adapter 内部状态，不碰 pg.Pool。
 *   2. adapter 的 connect() 里 connectWithReconnect 会 `await pool.connect()` 取一个 client
 *      挂 'error' 监听，**并且永不 release**（见 @payloadcms/db-postgres/dist/connect.js）。
 *   3. pg 的 pool.end() 会等所有 checked-out client 归还 —— 那个 client 永远不还，
 *      于是 pool.end() 永久 pending，一次性迁移进程卡在"迁移完成"之后，
 *      Shell 里的 `&& pnpm start` 永远不执行，容器不监听 80，健康检查失败。
 *
 * 所以这里只做"尽力而为"的清理：能关就关，关不掉就如实返回状态，
 * 由脚本入口显式 process.exit 结束进程（迁移已提交，退出是安全的）。
 */
export async function closeMigrationDb(
  db: ClosableMigrationDb,
  opts: CloseMigrationDbOptions = {},
): Promise<CloseMigrationDbResult> {
  const { timeoutMs = CLOSE_DB_TIMEOUT_MS, schedule = defaultScheduler } = opts

  const closing: Promise<CloseMigrationDbResult> = (async () => {
    try {
      try {
        await db.destroy?.()
      } finally {
        await db.pool.end()
      }
      return 'closed'
    } catch {
      // 迁移已经提交，关连接失败不该让部署失败
      return 'failed'
    }
  })()

  let cancel: TimerCanceller = () => {}
  const timedOut = new Promise<CloseMigrationDbResult>((resolve) => {
    cancel = schedule(() => resolve('timeout'), timeoutMs)
  })

  try {
    return await Promise.race([closing, timedOut])
  } finally {
    cancel()
  }
}

type WritableLike = {
  write: (chunk: string, cb: () => void) => unknown
}

export type FlushOutputOptions = {
  streams?: WritableLike[]
  timeoutMs?: number
  schedule?: TimerScheduler
}

/** 冲刷输出的等待上界：日志重要，但不能为了日志卡住退出 */
export const FLUSH_OUTPUT_TIMEOUT_MS = 1_000

/**
 * 在 process.exit 前把 stdout/stderr 写穿。
 *
 * 容器里 stdout 是管道（异步写），直接 process.exit 会截掉最后几行日志——
 * 而这几行恰好是判断"迁移是否真的走完"的唯一证据。同样带超时上界。
 */
export async function flushProcessOutput(opts: FlushOutputOptions = {}): Promise<void> {
  const {
    streams = [process.stdout, process.stderr],
    timeoutMs = FLUSH_OUTPUT_TIMEOUT_MS,
    schedule = defaultScheduler,
  } = opts

  const drained = Promise.all(
    streams.map(
      (stream) =>
        new Promise<void>((resolve) => {
          try {
            stream.write('', () => resolve())
          } catch {
            resolve()
          }
        }),
    ),
  ).then(() => undefined)

  let cancel: TimerCanceller = () => {}
  const timedOut = new Promise<void>((resolve) => {
    cancel = schedule(() => resolve(), timeoutMs)
  })

  try {
    await Promise.race([drained, timedOut])
  } finally {
    cancel()
  }
}
