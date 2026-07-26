import { describe, expect, it } from 'vitest'

import {
  BUILDING_GALLERY_MAX,
  BUILDING_OPERATIONAL_STATUSES,
  BUILDING_OPERATIONAL_STATUS_LABELS,
  BUILDING_TYPES,
  BUILDING_TYPE_LABELS,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_LABELS,
  REGISTRATION_CAPABILITIES,
  REGISTRATION_CAPABILITY_LABELS,
  isBuildingOperationalStatus,
  isBuildingType,
  isVerificationStatus,
  isRegistrationCapability,
  isBuildingOperational,
} from '@/domain/supply/building'

/**
 * M3.1 楼盘扩展字段纯函数单测（Requirement R3）
 *
 * 覆盖四个固定枚举的守卫、标签完整性，图集上限常量，
 * 以及楼盘启停可用态判定。所有函数无 payload 依赖，纯内存断言。
 */

describe('building/图集上限', () => {
  it('上限为 20（tasks.md M3.1）', () => {
    expect(BUILDING_GALLERY_MAX).toBe(20)
  })
})

describe('building/启停状态枚举', () => {
  it('每个状态都有非空中文 label', () => {
    for (const s of BUILDING_OPERATIONAL_STATUSES) {
      expect(BUILDING_OPERATIONAL_STATUS_LABELS[s].trim().length).toBeGreaterThan(0)
    }
  })

  it('isBuildingOperationalStatus 守卫', () => {
    expect(isBuildingOperationalStatus('active')).toBe(true)
    expect(isBuildingOperationalStatus('disabled')).toBe(true)
    expect(isBuildingOperationalStatus('published')).toBe(false)
    expect(isBuildingOperationalStatus(1)).toBe(false)
    expect(isBuildingOperationalStatus(null)).toBe(false)
  })
})

describe('building/物业类型枚举', () => {
  it('每个类型都有非空中文 label', () => {
    for (const t of BUILDING_TYPES) {
      expect(BUILDING_TYPE_LABELS[t].trim().length).toBeGreaterThan(0)
    }
  })

  it('isBuildingType 守卫', () => {
    expect(isBuildingType('office_building')).toBe(true)
    expect(isBuildingType('nope')).toBe(false)
    expect(isBuildingType(undefined)).toBe(false)
  })
})

describe('building/认证状态枚举', () => {
  it('每个状态都有非空中文 label', () => {
    for (const s of VERIFICATION_STATUSES) {
      expect(VERIFICATION_STATUS_LABELS[s].trim().length).toBeGreaterThan(0)
    }
  })

  it('isVerificationStatus 守卫', () => {
    expect(isVerificationStatus('verified')).toBe(true)
    expect(isVerificationStatus('pending')).toBe(true)
    expect(isVerificationStatus('nope')).toBe(false)
  })
})

describe('building/注册能力枚举', () => {
  it('每个能力都有非空中文 label', () => {
    for (const c of REGISTRATION_CAPABILITIES) {
      expect(REGISTRATION_CAPABILITY_LABELS[c].trim().length).toBeGreaterThan(0)
    }
  })

  it('isRegistrationCapability 守卫', () => {
    expect(isRegistrationCapability('supported')).toBe(true)
    expect(isRegistrationCapability('conditional')).toBe(true)
    expect(isRegistrationCapability('not_supported')).toBe(true)
    expect(isRegistrationCapability('maybe')).toBe(false)
  })
})

describe('building/isBuildingOperational', () => {
  it('active → 可用', () => {
    expect(isBuildingOperational('active')).toBe(true)
  })

  it('disabled / 其他值 → 不可用', () => {
    expect(isBuildingOperational('disabled')).toBe(false)
    expect(isBuildingOperational('published')).toBe(false)
    expect(isBuildingOperational(null)).toBe(false)
    expect(isBuildingOperational(undefined)).toBe(false)
  })
})
