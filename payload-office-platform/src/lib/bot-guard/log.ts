import type { BotGuardMode } from './config'
import type { GuardClass } from './path-class'

/**
 * 结构化日志与 5 分钟汇总。
 * 只记哈希后的 IP、UA 族名、类别、规则；绝不记原始 IP、完整 UA、路径、query。
 * IP 解析结果和 `se_verified` 只计入汇总。
 * 日志写入失败必须被吞掉：日志不能影响请求。
 */
export type GuardDecisionKind =
  | 'would_limit'
  | 'would_deny'
  | 'limited'
  | 'denied'
  | 'se_verified'
  | 'se_spoofed'
  | 'ip_resolved'
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
  'ip_resolved',
  'ip_unresolved',
])

/** 每个 kind:cls 每个汇总窗口最多逐条写的行数；超出只计数，防洪水日志。 */
export const MAX_LINES_PER_KEY_PER_WINDOW = 20

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
    maxLinesPerKeyPerWindow?: number
  }>,
): Readonly<{ record(event: GuardLogEvent): void }> {
  const cap = deps.maxLinesPerKeyPerWindow ?? MAX_LINES_PER_KEY_PER_WINDOW
  let counts = new Map<string, number>()
  let written = new Map<string, number>()
  let suppressed = new Map<string, number>()
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
      suppressed: Object.fromEntries(suppressed),
    })
    counts = new Map()
    written = new Map()
    suppressed = new Map()
    chain = { '0': 0, '1': 0, '2': 0, '3+': 0 }
    windowStart = now
  }

  return {
    record(event) {
      try {
        const key = `${event.kind}:${event.cls}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
        if ((event.kind === 'ip_resolved' || event.kind === 'ip_unresolved') && event.xffChainLength !== null) {
          chain[bucketOf(event.xffChainLength)] += 1
        }
        const lines = written.get(key) ?? 0
        if (!COUNT_ONLY.has(event.kind) && lines >= cap) {
          suppressed.set(key, (suppressed.get(key) ?? 0) + 1)
        } else if (!COUNT_ONLY.has(event.kind)) {
          written.set(key, lines + 1)
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
