// 分布式固定窗口限流（OPT-017）。
//
// 目标：替换进程内 Map 限流，让 CloudRun 多实例共享原子额度。
// 设计：
//   - 纯函数核心（窗口对齐 / 决策 / TTL 触发 / 容量保护 / 失败策略）全部可单测；
//   - PG 适配器（rate-limit-pg.ts）实现原子递增 + 过期清理，依赖注入到 runDistributedRateLimit；
//   - 失败策略 fail-open：询盘是公开提交端点，存储不可用时放行，依赖下游幂等键 + schema 校验兜底，
//     避免限流故障误伤正常用户（与 route.ts 幂等检查失败的"继续创建"策略一致）。

/** 原子递增返回的计数结果 */
export type AcquiredCount = { count: number; windowStart: number }

/** 限流决策 */
export type RateLimitDecision = {
  allowed: boolean
  retryAfterSeconds: number
  remaining: number
}

/** 存储失败时的决策 */
export type StoreFailureDecision = { allowed: boolean; failOpen: boolean }

/** 容量保护决策 */
export type CapacityDecision = 'allow' | 'prune_first'

/**
 * 固定窗口对齐：把任意时间戳落到其所属窗口的起始边界（ms）。
 * 同一窗口内所有请求共享同一个 windowStart，实现固定窗口配额。
 */
export function computeWindowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs
}

/**
 * 计算重试等待秒数：当前窗口结束 - now，向上取整。
 * now 已超出当前窗口时返回 0（不应发生，但防御性处理）。
 */
export function computeRetryAfterSeconds(windowStart: number, windowMs: number, now: number): number {
  const nextWindowStart = windowStart + windowMs
  const remainingMs = Math.max(0, nextWindowStart - now)
  return Math.ceil(remainingMs / 1000)
}

export type EvaluateOptions = {
  max: number
  windowMs: number
  now: number
}

/**
 * 根据原子递增返回的计数决定是否放行。
 * acquired.count 已包含本次请求（原子递增先增再判）。
 */
export function evaluateAcquired(acquired: AcquiredCount, opts: EvaluateOptions): RateLimitDecision {
  const { max, windowMs, now } = opts
  if (acquired.count <= max) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, max - acquired.count),
    }
  }
  return {
    allowed: false,
    retryAfterSeconds: computeRetryAfterSeconds(acquired.windowStart, windowMs, now),
    remaining: 0,
  }
}

/**
 * 决定是否触发 TTL 清理。
 * 基于上次清理时间 + 清理间隔，避免每次请求都清理拖慢路径。
 */
export function shouldPrune(now: number, lastPruneAt: number, intervalMs: number): boolean {
  return now - lastPruneAt >= intervalMs
}

/**
 * 容量保护：新 key 创建前检查总 key 数是否超上限。
 * - key 已存在：递增不占新槽，直接放行；
 * - 未达上限：放行；
 * - 达上限：返回 prune_first，先清理过期 key 腾位再写入。
 */
export function checkCapacity(currentKeyCount: number, maxKeys: number, keyExists: boolean): CapacityDecision {
  if (keyExists) return 'allow'
  if (currentKeyCount < maxKeys) return 'allow'
  return 'prune_first'
}

/**
 * 失败策略：存储不可用时的决策。
 * failOpen=true -> 放行（公开端点优先可用性，下游幂等 + schema 兜底）；
 * failOpen=false -> 拒绝（强配额场景）。
 */
export function decideOnStoreFailure(failOpen: boolean): StoreFailureDecision {
  return failOpen ? { allowed: true, failOpen: true } : { allowed: false, failOpen: false }
}

/** 注入的存储依赖（PG 适配器实现） */
export type RateLimitDeps = {
  acquire: (key: string, windowStart: number) => Promise<AcquiredCount>
  pruneExpired: (cutoff: number) => Promise<number>
  countKeys: () => Promise<number>
  keyExists: (key: string) => Promise<boolean>
  now: () => number
}

export type RateLimitConfig = {
  windowMs: number
  max: number
  maxKeys: number
  pruneIntervalMs: number
  failOpen: boolean
}

/** 跨调用共享的清理时间戳（引用对象，便于注入测试） */
export type PruneTimestampRef = { value: number }

/**
 * 协调一次限流检查：TTL 回收 -> 容量保护 -> 原子递增 -> 决策。
 * 任一存储操作抛错 -> 走失败策略（fail-open 放行 / fail-closed 拒绝）。
 */
export async function runDistributedRateLimit(
  deps: RateLimitDeps,
  config: RateLimitConfig,
  key: string,
  pruneRef: PruneTimestampRef,
): Promise<RateLimitDecision & { failedOpen: boolean }> {
  const now = deps.now()
  const windowStart = computeWindowStart(now, config.windowMs)
  const expiredCutoff = windowStart - config.windowMs

  try {
    // 1. 周期性 TTL 回收（不让表无限增长）
    if (shouldPrune(now, pruneRef.value, config.pruneIntervalMs)) {
      await deps.pruneExpired(expiredCutoff)
      pruneRef.value = now
    }

    // 2. 容量保护：新 key 写入前检查总 key 数
    const exists = await deps.keyExists(key)
    if (!exists) {
      const keyCount = await deps.countKeys()
      if (checkCapacity(keyCount, config.maxKeys, false) === 'prune_first') {
        await deps.pruneExpired(expiredCutoff)
      }
    }

    // 3. 原子递增 + 决策
    const acquired = await deps.acquire(key, windowStart)
    const decision = evaluateAcquired(acquired, {
      max: config.max,
      windowMs: config.windowMs,
      now,
    })
    return { ...decision, failedOpen: false }
  } catch {
    const fail = decideOnStoreFailure(config.failOpen)
    return {
      allowed: fail.allowed,
      retryAfterSeconds: 0,
      remaining: 0,
      failedOpen: fail.failOpen,
    }
  }
}
