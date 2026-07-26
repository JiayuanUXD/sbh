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

