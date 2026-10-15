import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { Buildings } from '@/collections/Buildings'
import { mapBuildingDetail } from '@/domain/public-catalog/mappers'
import { BUILDING_TYPES } from '@/domain/supply/building'
import {
  BUILDING_TYPE_DISPLAY_LABELS,
  LEGACY_BUILDING_TYPES,
  buildingTypeLabel,
  filterBuildingTypeOptions,
  normalizeBuildingType,
  normalizeLegacyBuildingType,
} from '@/domain/supply/building-type-legacy'
import { BUILDING_JINGAN_CENTER } from '@/test/frontend/payload-documents'

/**
 * OPT-115 第一期（扩展）：物业类型新旧值共存。
 *
 * 发布时新容器先跑迁移、旧版本仍承接流量（冒烟失败只回滚流量、不跑 down），
 * 所以第一期只给枚举加新值、不删旧值、不动数据；旧版本照常读写。新代码负责「双读」：
 * 读到旧值按映射显示新名称，保存时把旧值换成新值。第二期全量上线后再回填并删旧值。
 */

function findField(fields: readonly Field[], name: string): Field | undefined {
  for (const field of fields) {
    if ('name' in field && field.name === name) return field
    if ('fields' in field && Array.isArray(field.fields)) {
      const found = findField(field.fields, name)
      if (found) return found
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        const found = findField(tab.fields, name)
        if (found) return found
      }
    }
  }
  return undefined
}

describe('旧值映射', () => {
  it('旧值与新值互不重叠', () => {
    for (const legacy of LEGACY_BUILDING_TYPES) {
      expect(BUILDING_TYPES as readonly string[]).not.toContain(legacy)
    }
  })

  it.each([
    ['office_building', 'traditional_office'],
    ['serviced_office', 'coworking'],
    ['commercial_complex', null],
    ['business_park', 'business_park'],
    ['full_floor', 'full_floor'],
  ])('normalizeBuildingType(%s) → %s', (input, expected) => {
    expect(normalizeBuildingType(input)).toBe(expected)
  })

  it('空值与未知值原样返回（未知值交给 building-protect 拒绝）', () => {
    expect(normalizeBuildingType(null)).toBeNull()
    expect(normalizeBuildingType(undefined)).toBeUndefined()
    expect(normalizeBuildingType('castle')).toBe('castle')
  })

  it.each([
    ['traditional_office', '传统办公'],
    ['office_building', '传统办公'],
    ['serviced_office', '联合办公'],
    ['commercial_complex', null],
    [null, null],
    ['castle', null],
  ])('buildingTypeLabel(%s) → %s', (input, expected) => {
    expect(buildingTypeLabel(input)).toBe(expected)
  })
})

describe('Buildings.buildingType 字段', () => {
  const field = findField(Buildings.fields, 'buildingType')

  it('选项含新值与旧值（数据库枚举在第一期是两者并集，配置必须与之一致）', () => {
    expect(field?.type).toBe('select')
    const values = field && field.type === 'select'
      ? field.options.map((o) => (typeof o === 'string' ? o : o.value))
      : []
    expect(values).toEqual([...BUILDING_TYPES, ...LEGACY_BUILDING_TYPES])
  })

  it('下拉默认只给新值；当前值是旧值时保留它，保存才不被校验拦下', () => {
    expect(field && field.type === 'select' ? field.filterOptions : undefined).toBe(
      filterBuildingTypeOptions,
    )
    const options = field && field.type === 'select' ? field.options : []
    const valuesFor = (data: Record<string, unknown>) =>
      filterBuildingTypeOptions({ data, options, req: {} as never, siblingData: data }).map((o) =>
        typeof o === 'string' ? o : o.value,
      )
    expect(valuesFor({ buildingType: 'traditional_office' })).toEqual([...BUILDING_TYPES])
    expect(valuesFor({})).toEqual([...BUILDING_TYPES])
    expect(valuesFor({ buildingType: 'office_building' })).toEqual([
      ...BUILDING_TYPES,
      'office_building',
    ])
  })

  it('beforeValidate 挂了旧值转换钩子', () => {
    expect(Buildings.hooks?.beforeValidate).toContain(normalizeLegacyBuildingType)
  })
})

describe('normalizeLegacyBuildingType（保存时转换）', () => {
  const run = (data: Record<string, unknown>) =>
    normalizeLegacyBuildingType({ data } as never) as Record<string, unknown>

  it('旧值换成新值', () => {
    expect(run({ buildingType: 'office_building' }).buildingType).toBe('traditional_office')
    expect(run({ buildingType: 'serviced_office' }).buildingType).toBe('coworking')
  })

  it('商业综合体没有对应项，清空', () => {
    expect(run({ buildingType: 'commercial_complex' }).buildingType).toBeNull()
  })

  it('新值不动；本次没提交物业类型时不凭空写入', () => {
    expect(run({ buildingType: 'full_floor' }).buildingType).toBe('full_floor')
    expect('buildingType' in run({ name: '某楼' })).toBe(false)
  })
})

describe('前台详情读到旧值', () => {
  const typeFact = (buildingType: string) =>
    mapBuildingDetail({ ...BUILDING_JINGAN_CENTER, buildingType } as never)
      ?.factGroups.flatMap((group) => group.facts)
      .find((fact) => fact.label === '物业类型')

  it('写字楼按映射显示「传统办公」', () => {
    expect(typeFact('office_building')?.value).toBe('传统办公')
  })

  it('商业综合体无对应项，不显示', () => {
    expect(typeFact('commercial_complex')?.value ?? null).toBeNull()
  })
})

describe('BUILDING_TYPE_DISPLAY_LABELS（后台列表）', () => {
  it('新旧值都有中文名，旧值按映射显示，不把英文值原样露出来', () => {
    expect(Object.keys(BUILDING_TYPE_DISPLAY_LABELS).sort()).toEqual(
      [...BUILDING_TYPES, ...LEGACY_BUILDING_TYPES].sort(),
    )
    expect(BUILDING_TYPE_DISPLAY_LABELS.office_building).toBe('传统办公')
    expect(BUILDING_TYPE_DISPLAY_LABELS.serviced_office).toBe('联合办公')
    expect(BUILDING_TYPE_DISPLAY_LABELS.commercial_complex).toBe('商业综合体（待重选）')
    expect(BUILDING_TYPE_DISPLAY_LABELS.full_floor).toBe('整层办公')
  })
})
