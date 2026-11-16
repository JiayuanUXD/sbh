import { describe, expect, it } from 'vitest'

import { createGuardLogger, type GuardLogEvent } from '../src/lib/bot-guard/log'

const RAW_IP = '203.0.113.77'

function setup(opts?: { writeThrows?: boolean }) {
  const lines: string[] = []
  let t = 1_000_000
  const logger = createGuardLogger({
    write: (line) => {
      if (opts?.writeThrows) throw new Error('disk full')
      lines.push(line)
    },
    now: () => t,
    hashIp: (ip) => `h_${ip.length}`,
    summaryIntervalMs: 300_000,
  })
  return { lines, logger, advance: (ms: number) => (t += ms) }
}

const base: GuardLogEvent = {
  kind: 'would_limit',
  mode: 'observe',
  cls: 'page',
  rule: 'burst',
  ip: RAW_IP,
  uaFamily: 'Mozilla',
  xffChainLength: null,
}

describe('createGuardLogger', () => {
  it.each(['would_limit', 'limited', 'denied', 'would_deny', 'se_spoofed'] as const)(
    '%s 逐条写一行 JSON，IP 只以哈希出现',
    (kind) => {
      const { lines, logger } = setup()
      logger.record({ ...base, kind, rule: 'python-requests', uaFamily: 'python-requests' })
      expect(lines).toHaveLength(1)
      expect(lines[0]).not.toContain(RAW_IP)
      const row = JSON.parse(lines[0]!)
      expect(row).toMatchObject({
        kind,
        mode: 'observe',
        cls: 'page',
        rule: 'python-requests',
        ip: `h_${RAW_IP.length}`,
        uaFamily: 'python-requests',
      })
      expect(Object.keys(row).some((k) => /path|query|url/i.test(k))).toBe(false)
    },
  )

  it('se_verified 与 ip_unresolved 只计数不逐条写', () => {
    const { lines, logger } = setup()
    logger.record({ ...base, kind: 'se_verified' })
    logger.record({ ...base, kind: 'ip_unresolved', ip: null, xffChainLength: 2 })
    expect(lines).toHaveLength(0)
  })

  it('满间隔后下一次 record 追加汇总，含 kind×cls 与 xff 分布，并清零', () => {
    const { lines, logger, advance } = setup()
    logger.record({ ...base, kind: 'se_verified' })
    logger.record({ ...base, kind: 'ip_unresolved', ip: null, xffChainLength: 0 })
    logger.record({ ...base, kind: 'ip_unresolved', ip: null, xffChainLength: 1 })
    logger.record({ ...base, kind: 'ip_unresolved', ip: null, xffChainLength: 2 })
    logger.record({ ...base, kind: 'ip_unresolved', ip: null, xffChainLength: 7 })
    logger.record({ ...base, kind: 'limited', cls: 'sitemap' })
    expect(lines).toHaveLength(1) // 只有 limited 那行
    advance(300_000)
    logger.record({ ...base, kind: 'se_verified' })
    const summary = JSON.parse(lines[lines.length - 1]!)
    expect(summary.kind).toBe('summary')
    expect(summary.counts['ip_unresolved:page']).toBe(4)
    expect(summary.counts['se_verified:page']).toBe(2)
    expect(summary.counts['limited:sitemap']).toBe(1)
    expect(summary.xffChainLength).toEqual({ '0': 1, '1': 1, '2': 1, '3+': 1 })
    expect(lines.join('\n')).not.toContain(RAW_IP)

    // 清零：再过一个间隔，只剩新计数
    advance(300_000)
    logger.record({ ...base, kind: 'se_verified' })
    const second = JSON.parse(lines[lines.length - 1]!)
    expect(second.counts).toEqual({ 'se_verified:page': 1 })
    expect(second.xffChainLength).toEqual({ '0': 0, '1': 0, '2': 0, '3+': 0 })
  })

  it('write 抛错不向外传播', () => {
    const { logger, advance } = setup({ writeThrows: true })
    expect(() => logger.record({ ...base, kind: 'denied' })).not.toThrow()
    advance(300_000)
    expect(() => logger.record({ ...base, kind: 'se_verified' })).not.toThrow()
  })
})
