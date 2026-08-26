import { describe, expect, it } from 'vitest'

import {
  isSupplyImportPollTimedOut,
  SUPPLY_IMPORT_POLL_TIMEOUT_MS,
} from '@/domain/supply-import/poll-timeout'

/**
 * 最终评审 Important 7：规格 §8「已中断」态的判定纯函数。客户端轮询效果里的
 * 超时决策抽到这里单测，不必起 React Testing Library。
 */
describe('isSupplyImportPollTimedOut', () => {
  it('running 态，耗时未达阈值 → 不超时', () => {
    expect(isSupplyImportPollTimedOut('running', SUPPLY_IMPORT_POLL_TIMEOUT_MS - 1)).toBe(false)
  })

  it('running 态，耗时恰好达到阈值 → 超时（含边界）', () => {
    expect(isSupplyImportPollTimedOut('running', SUPPLY_IMPORT_POLL_TIMEOUT_MS)).toBe(true)
  })

  it('running 态，耗时远超阈值 → 超时', () => {
    expect(isSupplyImportPollTimedOut('running', SUPPLY_IMPORT_POLL_TIMEOUT_MS * 3)).toBe(true)
  })

  it('queued 态同样受超时约束（Job 可能一直没被 autoRun 捡起）', () => {
    expect(isSupplyImportPollTimedOut('queued', SUPPLY_IMPORT_POLL_TIMEOUT_MS + 1)).toBe(true)
  })

  it('completed 态永远不算超时，即使耗时早已超过阈值', () => {
    expect(isSupplyImportPollTimedOut('completed', SUPPLY_IMPORT_POLL_TIMEOUT_MS * 100)).toBe(false)
  })

  it('failed 态永远不算超时', () => {
    expect(isSupplyImportPollTimedOut('failed', SUPPLY_IMPORT_POLL_TIMEOUT_MS * 100)).toBe(false)
  })

  it('自定义阈值：调用方可以传更短的 timeoutMs（例如测试用）', () => {
    expect(isSupplyImportPollTimedOut('running', 1000, 500)).toBe(true)
    expect(isSupplyImportPollTimedOut('running', 100, 500)).toBe(false)
  })
})
