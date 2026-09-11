/**
 * 迁移快照漂移守卫（scripts/migrate-drift-check.ts）的判定与重试回归测试。
 *
 * 背景（2026-09-11，master a0cf599 的 CI）：`migrate:create` 以退出码 0 结束，
 * 输出只有一行 `[site-config] ...`，既没有 `No schema changes detected` 也没生成文件。
 * 旧脚本把它判成「快照漂移」让部署被跳过，重跑即过。这里锁三种输出形态：
 * 干净 / 漂移 / 空输出，以及空输出的「重试一次、两次才失败」契约。
 */
import { describe, expect, it } from 'vitest'

import {
  CLEAN_MARKER,
  CREATED_MARKER,
  MAX_ATTEMPTS,
  classifyProbe,
  runDriftCheck,
  type ProbeResult,
} from '../scripts/migrate-drift-check'

/** 真实 CLI 干净时的输出片段：pino 日志 + prompts 渲染的确认框（含 ANSI 转义） */
const CLEAN_OUTPUT = [
  '[site-config] NEXT_PUBLIC_SITE_URL 缺失，开发环境使用 fallback：http://localhost:3717',
  '[17:53:04] \x1b[33mWARN\x1b[39m: \x1b[36mNo email adapter provided.\x1b[39m',
  '[17:53:04] \x1b[32mINFO\x1b[39m: \x1b[36mStarting migration: generating UP statements...\x1b[39m',
  `\x1b[?25l\x1b[2K\x1b[1G\x1b[36m?\x1b[39m \x1b[1m${CLEAN_MARKER}. Would you like to create a blank migration file?\x1b[22m \x1b[90m(y/N)\x1b[39m`,
].join('\n')

/** 真实 CLI 漂移时的输出片段 */
const DRIFT_OUTPUT = [
  '[site-config] NEXT_PUBLIC_SITE_URL 缺失，开发环境使用 fallback：http://localhost:3717',
  '[17:53:04] INFO: Starting migration: generating UP statements...',
  `[17:53:04] INFO: ${CREATED_MARKER} at /x/src/migrations/20260911_000000_ci_drift_probe.ts`,
].join('\n')

/** 2026-09-11 CI 实录：退出码 0，只有 config 加载时那一行 */
const EMPTY_OUTPUT =
  '[site-config] NEXT_PUBLIC_SITE_URL 缺失，开发环境使用 fallback：http://localhost:3717\n'

const clean: ProbeResult = { code: 0, output: CLEAN_OUTPUT, createdFiles: [] }
const drift: ProbeResult = {
  code: 0,
  output: DRIFT_OUTPUT,
  createdFiles: ['20260911_000000_ci_drift_probe.json', '20260911_000000_ci_drift_probe.ts'],
}
const empty: ProbeResult = { code: 0, output: EMPTY_OUTPUT, createdFiles: [] }

describe('classifyProbe：三种输出形态', () => {
  it('干净：无新文件 + 有 No schema changes detected 提示（穿过 ANSI 转义仍能命中）', () => {
    expect(classifyProbe(clean)).toEqual({ kind: 'clean' })
  })

  it('漂移：生成了新的迁移文件——文件是判据，不依赖提示文案', () => {
    expect(classifyProbe(drift)).toEqual({
      kind: 'drift',
      createdFiles: drift.createdFiles,
    })
    // 就算日志全丢，只要文件落盘就是漂移
    expect(classifyProbe({ ...drift, output: EMPTY_OUTPUT })).toEqual({
      kind: 'drift',
      createdFiles: drift.createdFiles,
    })
  })

  it('漂移优先于干净：文件与提示同时出现时以文件为准', () => {
    expect(classifyProbe({ ...drift, output: CLEAN_OUTPUT }).kind).toBe('drift')
  })

  it('空输出：退出码 0、无提示、无新文件 → 无法判定，而不是漂移', () => {
    expect(classifyProbe(empty)).toEqual({ kind: 'indeterminate' })
  })

  it('非零退出码 → 命令本身失败，与三态无关', () => {
    expect(classifyProbe({ ...clean, code: 1 })).toEqual({ kind: 'error' })
    expect(classifyProbe({ ...empty, code: 130 })).toEqual({ kind: 'error' })
  })
})

type Capture = { logs: string[]; errors: string[] }

function makeDeps(sequence: ProbeResult[]) {
  const capture: Capture = { logs: [], errors: [] }
  let calls = 0
  const deps = {
    probe: async () => {
      const next = sequence[calls]
      calls++
      if (!next) throw new Error(`probe 被调用了第 ${calls} 次，超出脚本给定的序列`)
      return next
    },
    log: (m: string) => capture.logs.push(m),
    error: (m: string) => capture.errors.push(m),
  }
  return { deps, capture, callCount: () => calls }
}

describe('runDriftCheck：重试与文案契约', () => {
  it('MAX_ATTEMPTS 恰为 2：一次重试，不多不少', () => {
    expect(MAX_ATTEMPTS).toBe(2)
  })

  it('干净：一次通过，不重试', async () => {
    const { deps, capture, callCount } = makeDeps([clean])
    await expect(runDriftCheck(deps)).resolves.toBe(true)
    expect(callCount()).toBe(1)
    expect(capture.logs.join('\n')).toContain('OK')
    expect(capture.errors).toEqual([])
  })

  it('漂移：一次失败，不重试，报「快照漂移」并列出生成的文件', async () => {
    const { deps, capture, callCount } = makeDeps([drift])
    await expect(runDriftCheck(deps)).resolves.toBe(false)
    expect(callCount()).toBe(1)
    const msg = capture.errors.join('\n')
    expect(msg).toContain('快照漂移')
    expect(msg).toContain('20260911_000000_ci_drift_probe.json')
  })

  it('空输出一次、随后干净：自动重试后通过（2026-09-11 那次 CI 本应如此）', async () => {
    const { deps, capture, callCount } = makeDeps([empty, clean])
    await expect(runDriftCheck(deps)).resolves.toBe(true)
    expect(callCount()).toBe(2)
    expect(capture.logs.join('\n')).toContain('无法判定')
    expect(capture.logs.join('\n')).toContain('重试')
    expect(capture.errors).toEqual([])
  })

  it('空输出两次：失败，原因是「无法判定」而不是「快照漂移」', async () => {
    const { deps, capture, callCount } = makeDeps([empty, empty])
    await expect(runDriftCheck(deps)).resolves.toBe(false)
    expect(callCount()).toBe(2)
    const msg = capture.errors.join('\n')
    expect(msg).toContain('无法判定')
    expect(msg).toContain(CLEAN_MARKER)
    expect(msg).not.toContain('快照漂移：')
    // 把最后一次原始输出带上，方便对照 CI 日志
    expect(msg).toContain('[site-config]')
  })

  it('空输出后第二次探到漂移：仍判漂移', async () => {
    const { deps, capture, callCount } = makeDeps([empty, drift])
    await expect(runDriftCheck(deps)).resolves.toBe(false)
    expect(callCount()).toBe(2)
    expect(capture.errors.join('\n')).toContain('快照漂移')
  })

  it('命令失败（非零退出码）：立即失败，不重试', async () => {
    const { deps, capture, callCount } = makeDeps([{ ...empty, code: 1 }])
    await expect(runDriftCheck(deps)).resolves.toBe(false)
    expect(callCount()).toBe(1)
    expect(capture.errors.join('\n')).toContain('执行失败')
  })
})
