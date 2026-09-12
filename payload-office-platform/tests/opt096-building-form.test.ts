/**
 * OPT-096：房源「建筑形态」多选字段的域层契约。
 */
import { describe, expect, it } from 'vitest'
import { Listings } from '@/collections/Listings'
import { publishRequiredFieldNames } from '@/collections/listing-publish-marks'
import { BUILDING_FORMS, BUILDING_FORM_LABELS, isBuildingForm } from '@/domain/review/listing-fields'
import { LISTING_SPEC_FIELDS } from '@/lib/frontend/detail-spec/fields'
import { buildListingOverviewGroupsFromRegistry, type ListingSpecContext } from '@/lib/frontend/detail-spec/listing-rows'

/** 从 collection 配置里按 name 深度查找字段（跨 tabs / row / group）。 */
function findField(fields: unknown, name: string): Record<string, unknown> | null {
  if (!Array.isArray(fields)) return null
  for (const raw of fields) {
    if (!raw || typeof raw !== 'object') continue
    const field = raw as Record<string, unknown>
    if (field.name === name) return field
    for (const key of ['fields', 'tabs']) {
      const nested = findField(field[key], name)
      if (nested) return nested
    }
  }
  return null
}

describe('OPT-096 建筑形态：域枚举', () => {
  it('三个取值与中文标签', () => {
    expect(BUILDING_FORMS).toEqual(['detached', 'double-row', 'townhouse'])
    expect(BUILDING_FORM_LABELS).toEqual({ detached: '独栋', 'double-row': '双排', townhouse: '联排' })
  })

  it('isBuildingForm 只认三个取值', () => {
    expect(isBuildingForm('detached')).toBe(true)
    expect(isBuildingForm('townhouse')).toBe(true)
    expect(isBuildingForm('serviced-office')).toBe(false)
    expect(isBuildingForm(null)).toBe(false)
    expect(isBuildingForm(1)).toBe(false)
  })
})

describe('OPT-096 建筑形态：Listings 字段', () => {
  it('是非必填的多选 select，选项由枚举生成', () => {
    const field = findField(Listings.fields, 'buildingForm')
    expect(field).not.toBeNull()
    expect(field?.type).toBe('select')
    expect(field?.hasMany).toBe(true)
    expect(field?.required).toBeUndefined()
    const options = (field?.options as Array<{ value: string; label: string }>).map((o) => [o.value, o.label])
    expect(options).toEqual([['detached', '独栋'], ['double-row', '双排'], ['townhouse', '联排']])
  })

  it('不参与发布完整度', () => {
    expect(publishRequiredFieldNames().has('buildingForm')).toBe(false)
  })
})

describe('OPT-096 建筑形态：详情参数登记表', () => {
  it('space 组里有 buildingForm，默认可见', () => {
    const entry = LISTING_SPEC_FIELDS.find((f) => f.key === 'buildingForm')
    expect(entry).toEqual({ key: 'buildingForm', label: '建筑形态', group: 'space', defaultVisible: true })
  })
})

describe('OPT-096 建筑形态：详情参数表行', () => {
  const base: ListingSpecContext = { factGroups: [], price: null, availableFrom: null, building: null, buildingForm: [] }
  const rowOf = (ctx: ListingSpecContext) =>
    buildListingOverviewGroupsFromRegistry(ctx).flatMap((g) => g.rows).find((r) => r.label === '建筑形态')

  it('有值时按「、」拼中文标签', () => {
    expect(rowOf({ ...base, buildingForm: ['detached', 'townhouse'] })?.value).toBe('独栋、联排')
  })

  it('无值时该行不渲染', () => {
    expect(rowOf(base)).toBeUndefined()
  })

  it('站点设置关掉后不渲染', () => {
    const groups = buildListingOverviewGroupsFromRegistry({ ...base, buildingForm: ['detached'] }, { buildingForm: false })
    expect(groups.flatMap((g) => g.rows).some((r) => r.label === '建筑形态')).toBe(false)
  })
})
