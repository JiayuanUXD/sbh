import type { BotGuardMode } from './config'
import type { GuardClass } from './path-class'

/**
 * 结构化日志与 5 分钟汇总。
 * 只记哈希后的 IP、UA 族名、类别、规则；绝不记原始 IP、完整 UA、路径、query。
 * `se_verified` 与 `ip_unresolved` 量大且无需逐条定位，只计入汇总。
 * 日志写入失败必须被吞掉：日志不能影响请求。
 */
export type GuardDecisionKind =
  | 'would_limit'
  | 'would_deny'
  | 'limited'
  | 'denied'
  | 'se_verified'
  | 'se_spoofed'
  | 'ip_unresolved'
  | 'guard_error'

export type GuardLogEvent = Readonly<{
  kind: GuardDecisionKind
  mode: BotGuardMode
  cls: GuardClass
  rule: string | null
  ip: string | null
  uaFamily: string
  xffChainLength: number | null
}>

/** 只计数、不逐条写的决策。 */
const COUNT_ONLY: ReadonlySet<GuardDecisionKind> = new Set<GuardDecisionKind>([
  'se_verified',
  'ip_unresolved',
])

type ChainBucket = '0' | '1' | '2' | '3+'

function bucketOf(length: number): ChainBucket {
  if (length <= 0) return '0'
  if (length === 1) return '1'
  if (length === 2) return '2'
  return '3+'
}

export function createGuardLogger(
  deps: Readonly<{
    write(line: string): void
    now(): number
    hashIp(ip: string): string
    summaryIntervalMs: number
  }>,
): Readonly<{ record(event: GuardLogEvent): void }> {
  let counts = new Map<string, number>()
  let chain: Record<ChainBucket, number> = { '0': 0, '1': 0, '2': 0, '3+': 0 }
  let windowStart = deps.now()

  function safeWrite(row: Record<string, unknown>): void {
    try {
      deps.write(JSON.stringify(row))
    } catch {
      // 日志落盘失败不得影响请求
    }
  }

  function flushIfDue(): void {
    const now = deps.now()
    if (now - windowStart < deps.summaryIntervalMs) return
    safeWrite({
      ts: now,
      tag: 'bot-guard',
      kind: 'summary',
      windowMs: now - windowStart,
      counts: Object.fromEntries(counts),
      xffChainLength: chain,
    })
    counts = new Map()
    chain = { '0': 0, '1': 0, '2': 0, '3+': 0 }
    windowStart = now
  }

  return {
    record(event) {
      try {
        const key = `${event.kind}:${event.cls}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
        if (event.kind === 'ip_unresolved' && event.xffChainLength !== null) {
          chain[bucketOf(event.xffChainLength)] += 1
        }
        if (!COUNT_ONLY.has(event.kind)) {
          safeWrite({
            ts: deps.now(),
            tag: 'bot-guard',
            kind: event.kind,
            mode: event.mode,
            cls: event.cls,
            rule: event.rule,
            ip: event.ip === null ? null : deps.hashIp(event.ip),
            uaFamily: event.uaFamily,
          })
        }
        flushIfDue()
      } catch {
        // hashIp 等异常同样吞掉
      }
    },
  }
}
