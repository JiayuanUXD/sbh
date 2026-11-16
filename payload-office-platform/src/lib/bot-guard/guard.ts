import {
  CLASS_LIMITS,
  ENFORCED_CLASSES,
  UNRESOLVED_ENGINE_LIMIT_FACTOR,
  type BotGuardConfig,
} from './config'
import type { createLimiter, ClassLimits } from './limiter'
import type { createGuardLogger, GuardDecisionKind, GuardLogEvent } from './log'
import { classifyPath, type GuardClass } from './path-class'
import { claimedEngine, type SearchEngineVerdict } from './search-engine'
import { classifyUserAgent } from './user-agent'
import { resolveTrustedClientIp } from '../api/trusted-client-ip'

/**
 * 守卫编排（纯逻辑，依赖全部注入）。顺序：
 * mode off → 分类 → 可信 IP → allowIps → 搜索引擎验真 → UA 规则 → 限速。
 * 任何内部异常一律放行并记 guard_error——守卫绝不能让 proxy 抛出而全站 500。
 */
export type GuardInput = Readonly<{
  method: string
  pathname: string
  headers: Readonly<{
    userAgent: string | null
    xForwardedFor: string | null
    isPrefetch: boolean
  }>
}>

export type GuardAction =
  | Readonly<{ action: 'allow' }>
  | Readonly<{ action: 'deny'; status: 403 }>
  | Readonly<{ action: 'limit'; status: 429; retryAfterSeconds: number }>

export type GuardDeps = Readonly<{
  config: BotGuardConfig
  limiter: ReturnType<typeof createLimiter>
  verifyEngine: (ip: string, ua: string | null) => Promise<SearchEngineVerdict>
  logger: ReturnType<typeof createGuardLogger>
}>

const ALLOW: GuardAction = { action: 'allow' }

/** 候选处置（尚未应用模式）。 */
type Candidate =
  | Readonly<{ type: 'deny'; rule: string }>
  | Readonly<{ type: 'limit'; rule: string; retryAfterSeconds: number }>

function chainLengthOf(xff: string | null): number {
  return xff ? xff.split(',').length : 0
}

function scale(limits: ClassLimits, factor: number): ClassLimits {
  return {
    burst: limits.burst * factor,
    perMinute: limits.perMinute * factor,
    perHour: limits.perHour * factor,
  }
}

/**
 * 模式转换集中在这里：observe 与不强制的类别（mini-read）把 deny/limit
 * 改写为 allow + would_* 日志；只有 enforce 且类别被强制才真正处置。
 */
function applyMode(
  candidate: Candidate,
  ctx: Readonly<{ config: BotGuardConfig; cls: GuardClass; ip: string; uaFamily: string }>,
): Readonly<{ action: GuardAction; event: GuardLogEvent }> {
  // mini-read 一期只 observe：ENFORCED_CLASSES 不含它，故脚本 UA 在 enforce 下
  // 也只降级为 would_deny 并放行（有意为之，不是漏拦）。
  const enforcing = ctx.config.mode === 'enforce' && ENFORCED_CLASSES.has(ctx.cls)
  const kind: GuardDecisionKind =
    candidate.type === 'deny'
      ? enforcing ? 'denied' : 'would_deny'
      : enforcing ? 'limited' : 'would_limit'
  const event: GuardLogEvent = {
    kind,
    mode: ctx.config.mode,
    cls: ctx.cls,
    rule: candidate.rule,
    ip: ctx.ip,
    uaFamily: ctx.uaFamily,
    xffChainLength: null,
  }
  if (!enforcing) return { action: ALLOW, event }
  return {
    action:
      candidate.type === 'deny'
        ? { action: 'deny', status: 403 }
        : { action: 'limit', status: 429, retryAfterSeconds: Math.max(1, candidate.retryAfterSeconds) },
    event,
  }
}

export async function evaluateGuard(input: GuardInput, deps: GuardDeps): Promise<GuardAction> {
  const { config, limiter, verifyEngine, logger } = deps
  // 遥测尽力而为：日志写入失败绝不能改变拦截结果
  const safeRecord = (event: GuardLogEvent): void => {
    try {
      logger.record(event)
    } catch {
      // 吞掉
    }
  }
  if (config.mode === 'off') return ALLOW

  let cls: GuardClass = 'exempt'
  let uaFamily = 'other'
  try {
    cls = classifyPath({
      method: input.method,
      pathname: input.pathname,
      isPrefetch: input.headers.isPrefetch,
    })
    if (cls === 'exempt') return ALLOW

    const ua = input.headers.userAgent
    const uaVerdict = classifyUserAgent(ua)
    uaFamily = uaVerdict.family

    const xff = input.headers.xForwardedFor
    const resolved = resolveTrustedClientIp(xff, config.trustedProxyHops)
    safeRecord({
      kind: resolved.ok ? 'ip_resolved' : 'ip_unresolved',
      mode: config.mode,
      cls,
      rule: resolved.ok ? null : resolved.reason,
      ip: null,
      uaFamily,
      // 未配置跳数时解析器不读取头部，仍记录链长度供观察期核对。
      xffChainLength: chainLengthOf(xff),
    })
    if (!resolved.ok) return ALLOW
    const ip = resolved.ip
    if (config.allowIps.has(ip)) return ALLOW

    let unresolvedEngine = false
    if (claimedEngine(ua) !== null) {
      const verdict = await verifyEngine(ip, ua)
      if (verdict.kind === 'verified') {
        safeRecord({ kind: 'se_verified', mode: config.mode, cls, rule: verdict.engine, ip, uaFamily, xffChainLength: null })
        return ALLOW
      }
      if (verdict.kind === 'spoofed') {
        safeRecord({ kind: 'se_spoofed', mode: config.mode, cls, rule: verdict.engine, ip, uaFamily, xffChainLength: null })
      } else if (verdict.kind === 'unresolved') {
        unresolvedEngine = true
      }
    }

    // 未决的引擎不做 UA 拦截（DNS 不可用不能伤 SEO）
    if (!unresolvedEngine && uaVerdict.deny && uaVerdict.rule !== null) {
      const out = applyMode({ type: 'deny', rule: uaVerdict.rule }, { config, cls, ip, uaFamily })
      safeRecord(out.event)
      return out.action
    }

    const base = CLASS_LIMITS[cls]
    const limits = unresolvedEngine ? scale(base, UNRESOLVED_ENGINE_LIMIT_FACTOR) : base
    const decision = limiter.check(`${ip}|${cls}`, limits)
    if (!decision.allowed) {
      const out = applyMode(
        { type: 'limit', rule: decision.window, retryAfterSeconds: decision.retryAfterSeconds },
        { config, cls, ip, uaFamily },
      )
      safeRecord(out.event)
      return out.action
    }
    return ALLOW
  } catch {
    // 内部异常按设计放行（fail-open）；cls 取不到时保持 'exempt'，
    // GuardLogEvent.cls 的导出类型不含 'unknown'，故不改签名
    safeRecord({ kind: 'guard_error', mode: config.mode, cls, rule: null, ip: null, uaFamily, xffChainLength: null })
    return ALLOW
  }
}
