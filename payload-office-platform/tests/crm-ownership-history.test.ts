import { describe, expect, it } from 'vitest'

import {
  OWNERSHIP_ACTIONS,
  OWNERSHIP_ACTION_LABELS,
  OWNERSHIP_STATUSES,
  OWNERSHIP_STATUS_LABELS,
  isOwnershipAction,
  isOwnershipStatus,
  ownershipStatusAfterAction,
  requiresReason,
} from '@/domain/crm/ownership'

/**
 * M5.4/M5.8 归属动作与归属状态纯逻辑单测（design §3.6 lead_ownership_history / R6, R8）
 *
 * 归属历史为追加式不可改写:分配 / 认领 / 转派 / 进入公海 / 回收各是一条记录。
 * 归属状态(unassigned | assigned | public_pool)独立于线索阶段。
 * 本模块只做枚举 + 动作→结果状态的纯推导,不查库、不写库。
 */

describe('crm-ownership/归属动作枚举', () => {
  it('五种动作齐全且有标签', () => {
    expect(OWNERSHIP_ACTIONS).toEqual([
      'assign',
      'claim',
      'transfer',
      'to_public_pool',
      'reclaim',
    ])
    for (const a of OWNERSHIP_ACTIONS) {
      expect(OWNERSHIP_ACTION_LABELS[a]).toBeTruthy()
    }
  })

  it('类型守卫', () => {
    expect(isOwnershipAction('assign')).toBe(true)
    expect(isOwnershipAction('delete')).toBe(false)
  })
})

describe('crm-ownership/归属状态枚举', () => {
  it('三种状态齐全且有标签', () => {
    expect(OWNERSHIP_STATUSES).toEqual(['unassigned', 'assigned', 'public_pool'])
    for (const s of OWNERSHIP_STATUSES) {
      expect(OWNERSHIP_STATUS_LABELS[s]).toBeTruthy()
    }
  })

  it('类型守卫', () => {
    expect(isOwnershipStatus('public_pool')).toBe(true)
    expect(isOwnershipStatus('converted')).toBe(false)
  })
})

describe('crm-ownership/动作→结果归属状态', () => {
  it('分配/认领/转派 → assigned', () => {
    expect(ownershipStatusAfterAction('assign')).toBe('assigned')
    expect(ownershipStatusAfterAction('claim')).toBe('assigned')
    expect(ownershipStatusAfterAction('transfer')).toBe('assigned')
  })

  it('进入公海/回收 → public_pool', () => {
    expect(ownershipStatusAfterAction('to_public_pool')).toBe('public_pool')
    expect(ownershipStatusAfterAction('reclaim')).toBe('public_pool')
  })
})

describe('crm-ownership/负向动作要求原因', () => {
  it('进入公海/回收要求原因,正向不要求', () => {
    expect(requiresReason('to_public_pool')).toBe(true)
    expect(requiresReason('reclaim')).toBe(true)
    expect(requiresReason('assign')).toBe(false)
    expect(requiresReason('claim')).toBe(false)
    expect(requiresReason('transfer')).toBe(false)
  })
})
