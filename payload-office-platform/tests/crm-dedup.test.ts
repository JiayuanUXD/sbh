import { describe, expect, it } from 'vitest'

import {
  detectDuplicateLead,
  DEDUP_HANDLING_PATHS,
  type LeadHistoryEntry,
  type DedupResult,
} from '@/domain/crm/dedup'
import { DEDUP_WINDOW_DAYS } from '@/domain/crm/policy'

/**
 * M5.3 手机号查重纯逻辑单测（design §3.6 / R6 / M5 验收门）
 *
 * 输入:规范化手机号 + 该号全部客户历史线索 + 当前时刻。
 * 输出:是否重复(30 天窗口)、命中的既有客户、可选处理路径三选一。
 * 验收门:重复手机号提供三种明确处理路径(合并已有客户 / 创建新需求 / 取消)。
 *
 * 纯逻辑不查库——历史线索由调用方(领域服务)预先加载后传入。
 */

const NOW = new Date('2026-07-26T00:00:00.000Z')

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)
}

describe('crm-dedup/窗口常量', () => {
  it('30 天窗口', () => {
    expect(DEDUP_WINDOW_DAYS).toBe(30)
  })
})

describe('crm-dedup/无历史', () => {
  it('新号无历史 → 非重复,无候选客户', () => {
    const r = detectDuplicateLead({ phoneNormalized: '13800001111', history: [], now: NOW })
    expect(r.isDuplicate).toBe(false)
    expect(r.existingCustomerId).toBeNull()
    expect(r.handlingPaths).toEqual([])
  })
})

describe('crm-dedup/30 天窗口判定', () => {
  const history: LeadHistoryEntry[] = [
    { leadId: 1, customerId: 100, createdAt: daysAgo(10) },
  ]

  it('窗口内(10 天前)→ 重复,给出三种处理路径', () => {
    const r = detectDuplicateLead({ phoneNormalized: '13800001111', history, now: NOW })
    expect(r.isDuplicate).toBe(true)
    expect(r.existingCustomerId).toBe(100)
    expect(r.handlingPaths).toEqual(DEDUP_HANDLING_PATHS)
    expect(r.handlingPaths).toEqual(['merge_customer', 'new_demand', 'cancel'])
  })

  it('恰好 30 天(边界内)→ 重复', () => {
    const r = detectDuplicateLead({
      phoneNormalized: '13800001111',
      history: [{ leadId: 1, customerId: 100, createdAt: daysAgo(30) }],
      now: NOW,
    })
    expect(r.isDuplicate).toBe(true)
  })

  it('超过 30 天(31 天前)→ 非重复', () => {
    const r = detectDuplicateLead({
      phoneNormalized: '13800001111',
      history: [{ leadId: 1, customerId: 100, createdAt: daysAgo(31) }],
      now: NOW,
    })
    expect(r.isDuplicate).toBe(false)
    expect(r.handlingPaths).toEqual([])
  })
})

describe('crm-dedup/多条历史取最近', () => {
  it('多客户历史,命中窗口内最近一条对应的客户', () => {
    const history: LeadHistoryEntry[] = [
      { leadId: 1, customerId: 100, createdAt: daysAgo(40) }, // 窗口外
      { leadId: 2, customerId: 200, createdAt: daysAgo(5) }, // 窗口内最近
      { leadId: 3, customerId: 100, createdAt: daysAgo(20) }, // 窗口内更早
    ]
    const r = detectDuplicateLead({ phoneNormalized: '13800001111', history, now: NOW })
    expect(r.isDuplicate).toBe(true)
    expect(r.existingCustomerId).toBe(200)
  })

  it('全部窗口外 → 非重复但仍返回最近客户供合并参考', () => {
    const history: LeadHistoryEntry[] = [
      { leadId: 1, customerId: 100, createdAt: daysAgo(40) },
      { leadId: 2, customerId: 200, createdAt: daysAgo(60) },
    ]
    const r = detectDuplicateLead({ phoneNormalized: '13800001111', history, now: NOW })
    expect(r.isDuplicate).toBe(false)
    expect(r.existingCustomerId).toBe(100) // 最近的一条
    expect(r.handlingPaths).toEqual([])
  })
})
