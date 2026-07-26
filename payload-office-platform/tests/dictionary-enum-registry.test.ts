import { describe, expect, it } from 'vitest'
import {
  ENUM_DICTIONARIES,
  getEnumDictionary,
  listEnumDictionaries,
} from '../src/domain/dictionary/enum-registry'
import {
  MERCHANT_TYPES,
  MERCHANT_TYPE_LABELS,
  MERCHANT_STATUSES,
  MERCHANT_STATUS_LABELS,
  QUALIFICATION_STATUSES,
  QUALIFICATION_STATUS_LABELS,
} from '../src/domain/supply/merchant'
import {
  TEAM_STATUSES,
  TEAM_STATUS_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
} from '../src/domain/auth/org'
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
} from '../src/domain/geography/location-hierarchy'
import {
  BUILDING_OPERATIONAL_STATUSES,
  BUILDING_OPERATIONAL_STATUS_LABELS,
  BUILDING_TYPES,
  BUILDING_TYPE_LABELS,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_LABELS,
  REGISTRATION_CAPABILITIES,
  REGISTRATION_CAPABILITY_LABELS,
} from '../src/domain/supply/building'

/**
 * 只读枚举字典发布基线一致性测试（M2.6 Part A）。
 *
 * 核心意图：注册表不复制枚举值，而是从各领域真源映射生成。
 * 一旦真源新增/删除值而注册表漏更新，逐项对比即转红。
 */

// 每个字典 code → 对应真源数组 + 标签表，作为断言基准。
const EXPECTED: Record<
  string,
  { values: readonly string[]; labels: Record<string, string> }
> = {
  'merchant.type': { values: MERCHANT_TYPES, labels: MERCHANT_TYPE_LABELS },
  'merchant.status': { values: MERCHANT_STATUSES, labels: MERCHANT_STATUS_LABELS },
  'merchant.qualification_status': {
    values: QUALIFICATION_STATUSES,
    labels: QUALIFICATION_STATUS_LABELS,
  },
  'team.status': { values: TEAM_STATUSES, labels: TEAM_STATUS_LABELS },
  'employment.status': { values: EMPLOYMENT_STATUSES, labels: EMPLOYMENT_STATUS_LABELS },
  'location.type': { values: LOCATION_TYPES, labels: LOCATION_TYPE_LABELS },
  'building.operational_status': {
    values: BUILDING_OPERATIONAL_STATUSES,
    labels: BUILDING_OPERATIONAL_STATUS_LABELS,
  },
  'building.type': { values: BUILDING_TYPES, labels: BUILDING_TYPE_LABELS },
  'building.verification_status': {
    values: VERIFICATION_STATUSES,
    labels: VERIFICATION_STATUS_LABELS,
  },
  'building.registration_capability': {
    values: REGISTRATION_CAPABILITIES,
    labels: REGISTRATION_CAPABILITY_LABELS,
  },
}

describe('ENUM_DICTIONARIES 发布基线', () => {
  it('覆盖且仅覆盖预期的 10 个字典 code', () => {
    const codes = ENUM_DICTIONARIES.map((d) => d.code).sort()
    expect(codes).toEqual(Object.keys(EXPECTED).sort())
  })

  it('每个 code 唯一', () => {
    const codes = ENUM_DICTIONARIES.map((d) => d.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('全部标记为 readonly', () => {
    for (const dict of ENUM_DICTIONARIES) {
      expect(dict.readonly).toBe(true)
    }
  })

  it.each(Object.entries(EXPECTED))(
    '%s 的 entries 与真源数组逐项一致',
    (code, { values, labels }) => {
      const dict = getEnumDictionary(code)
      expect(dict).toBeDefined()
      expect(dict!.entries).toHaveLength(values.length)
      expect(dict!.entries.map((e) => e.value)).toEqual([...values])
      for (const entry of dict!.entries) {
        expect(entry.label).toBe(labels[entry.value])
      }
    },
  )

  it('每个 entry 都有非空中文 label', () => {
    for (const dict of ENUM_DICTIONARIES) {
      for (const entry of dict.entries) {
        expect(typeof entry.label).toBe('string')
        expect(entry.label.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('字典查询函数', () => {
  it('getEnumDictionary 命中返回定义', () => {
    expect(getEnumDictionary('merchant.type')?.label).toBe('商户类型')
  })

  it('getEnumDictionary 未命中返回 undefined', () => {
    expect(getEnumDictionary('nope.nope')).toBeUndefined()
  })

  it('listEnumDictionaries 返回全部字典', () => {
    expect(listEnumDictionaries()).toBe(ENUM_DICTIONARIES)
    expect(listEnumDictionaries()).toHaveLength(10)
  })
})
