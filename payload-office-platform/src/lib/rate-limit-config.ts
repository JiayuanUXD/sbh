/**
 * 限流配置（OPT-017 / OPT-018 共享）
 *
 * inquiries 端点与 SLI 端点都依赖同一份 windowMs/max，
 * 提取到独立文件避免两处定义漂移。
 *
 * - 每 IP 每分钟 5 次（design.md §13：429 + 合理 Retry-After）；
 * - maxKeys 容量保护：表内 key 数上限，防攻击者制造海量不同 IP 哈希撑爆表；
 * - pruneIntervalMs：TTL 清理间隔，过期窗口的 key 周期性删除；
 * - failOpen：PG 不可用时放行（公开端点优先可用性，下游幂等键 + schema 兜底）。
 */

import type { RateLimitConfig } from './rate-limit-distributed'

/** 咨询端点限流配置：每 IP 每分钟 5 次 */
export const INQUIRY_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  max: 5,
  maxKeys: 100_000,
  pruneIntervalMs: 5 * 60_000,
  failOpen: true,
}

/**
 * 纠错端点限流配置（FPD-P1 Task 6）：每 IP 每分钟 3 次。
 *
 * 纠错频率应低于询盘（用户只在发现错误时提交），配额独立。
 * 与 INQUIRY_RATE_LIMIT_CONFIG 共享 inquiry_rate_limit 表，但限流键加
 * 'correction:' 前缀（见 route.ts），配额互不影响。
 */
export const CORRECTION_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  max: 3,
  maxKeys: 100_000,
  pruneIntervalMs: 5 * 60_000,
  failOpen: true,
}

/**
 * 路线摘要端点限流配置（FPD-P2 Task 2）：每 IP 每分钟 10 次。
 *
 * 路线由用户主动点击触发，一次交互可能尝试多种出行方式（transit/driving/
 * walking），配额略高于询盘。与 INQUIRY_RATE_LIMIT_CONFIG 共享 inquiry_rate_limit
 * 表，但限流键加 'route:' 前缀（见 api/routes/route.ts），配额互不影响。
 */
export const ROUTE_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  max: 10,
  maxKeys: 100_000,
  pruneIntervalMs: 5 * 60_000,
  failOpen: true,
}

/**
 * 投放房源端点限流配置：每 IP 每分钟 3 次。
 *
 * 业主提交频率天然很低（一处房源提交一次），配额与纠错端点一致。
 * 与 INQUIRY_RATE_LIMIT_CONFIG 共享 inquiry_rate_limit 表，但限流键加
 * 'supply:' 前缀（见 api/supply-submissions/route.ts），配额互不影响。
 */
export const SUPPLY_SUBMISSION_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  max: 3,
  maxKeys: 100_000,
  pruneIntervalMs: 5 * 60_000,
  failOpen: true,
}

