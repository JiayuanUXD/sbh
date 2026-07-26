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
