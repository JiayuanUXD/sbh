import { describe, expect, it } from 'vitest'

import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  TEAM_STATUSES,
  TEAM_STATUS_LABELS,
  isEmploymentStatus,
  isTeamStatus,
} from '@/domain/auth/org'

/**
 * M2.5 组织结构枚举单测（design §3.3）
 * 纯函数：团队状态 + 经纪人在职状态守卫与标签。
 */

describe('org/团队状态', () => {
  it('枚举与标签一一对应', () => {
    expect(TEAM_STATUSES).toEqual(['active', 'disabled'])
    for (const s of TEAM_STATUSES) {
      expect(TEAM_STATUS_LABELS[s]).toBeTruthy()
    }
    expect(TEAM_STATUS_LABELS.active).toBe('启用')
    expect(TEAM_STATUS_LABELS.disabled).toBe('停用')
  })

  it('isTeamStatus 命中合法值', () => {
    expect(isTeamStatus('active')).toBe(true)
    expect(isTeamStatus('disabled')).toBe(true)
  })

  it('isTeamStatus 拒绝非法值', () => {
    expect(isTeamStatus('locked')).toBe(false)
    expect(isTeamStatus('')).toBe(false)
    expect(isTeamStatus(1)).toBe(false)
    expect(isTeamStatus(null)).toBe(false)
    expect(isTeamStatus(undefined)).toBe(false)
  })
})

describe('org/经纪人在职状态', () => {
  it('枚举与标签一一对应', () => {
    expect(EMPLOYMENT_STATUSES).toEqual(['active', 'disabled'])
    for (const s of EMPLOYMENT_STATUSES) {
      expect(EMPLOYMENT_STATUS_LABELS[s]).toBeTruthy()
    }
    expect(EMPLOYMENT_STATUS_LABELS.active).toBe('在职')
    expect(EMPLOYMENT_STATUS_LABELS.disabled).toBe('停用')
  })

  it('isEmploymentStatus 命中合法值', () => {
    expect(isEmploymentStatus('active')).toBe(true)
    expect(isEmploymentStatus('disabled')).toBe(true)
  })

  it('isEmploymentStatus 拒绝非法值', () => {
    expect(isEmploymentStatus('resigned')).toBe(false)
    expect(isEmploymentStatus('')).toBe(false)
    expect(isEmploymentStatus(0)).toBe(false)
    expect(isEmploymentStatus(null)).toBe(false)
    expect(isEmploymentStatus(undefined)).toBe(false)
  })
})
