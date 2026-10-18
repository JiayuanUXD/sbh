import { describe, expect, it } from 'vitest'
import { BUILDING_GRADE_LABELS, getBuildingGradeLabel } from '@/components/frontend/building-grade'
import { applyBuildingFilters, parseBuildingSearchInput, sortBuildings } from '@/domain/public-catalog/building-search'
import { searchBuildingsFiltered, createSearchContext } from '@/domain/public-catalog'
import { makeBuilding, makeHomepageAdapter } from './helpers/opt035-fixtures'
import type { Field, PayloadRequest, SanitizedCollectionConfig } from 'payload'
import { Buildings } from '@/collections/Buildings'
import { buildingGradeWhere, filterBuildingGradeOptions, normalizeBuildingGradeInput } from '@/domain/supply/building-grade'
import { mapMiniBuildingCard, mapMiniBuildingDetail } from '@/domain/mini-program/mappers'
import { mapBuildingDetail, mapBuildingSummary } from '@/domain/public-catalog/mappers'
import { BUILDING_JINGAN_CENTER } from '@/test/frontend/payload-documents'

function findGrade(fields: readonly Field[]): Extract<Field, { type: 'select' }> | undefined {
  for (const field of fields) {
    if (field.type === 'select' && field.name === 'grade') return field
    const children = 'fields' in field ? field.fields : field.type === 'tabs' ? field.tabs.flatMap(tab => tab.fields) : []
    if (children?.length) {
      const found = findGrade(children)
      if (found) return found
    }
  }
  return undefined
}

const gradeField = findGrade(Buildings.fields)
if (!gradeField) throw new Error('缺少 grade 字段')
const runInput = (data: Record<string, unknown>, operation: 'create' | 'update' = 'update') => normalizeBuildingGradeInput({
  data, operation, collection: Buildings as SanitizedCollectionConfig, context: {}, req: {} as PayloadRequest,
}) as Record<string, unknown>

describe('OPT-121 等级规范与兼容', () => {
  it('正式选项只有规范四值，旧值和空值显示未评级', () => {
    expect(Object.keys(BUILDING_GRADE_LABELS)).toEqual(['super-grade-a', 'grade-a', 'grade-b', 'ungraded'])
    for (const grade of ['creative-park', 'serviced-office', null, undefined]) expect(getBuildingGradeLabel(grade)).toBe('未评级')
    expect(getBuildingGradeLabel('grade-b')).toBe('乙级')
    expect(getBuildingGradeLabel('garbage')).toBeUndefined()
  })
  it('等级筛选只接收新四值', () => {
    expect(parseBuildingSearchInput(new URLSearchParams('grade=grade-b&grade=ungraded&grade=creative-park')).grade).toEqual(['grade-b', 'ungraded'])
  })
  it('未评级内存筛选兼容旧两值、null及缺失并按统一序位排序', () => {
    const docs = ['creative-park', null, 'serviced-office', undefined, 'ungraded', 'grade-b', 'grade-a', 'super-grade-a'].map((grade, i) => ({ id: i, slug: `b${i}`, name: `b${i}`, grade } as Parameters<typeof sortBuildings>[0][number]))
    const input = { sort: 'grade' as const, page: 1, pageSize: 24 as const, grade: ['ungraded'] }
    expect(applyBuildingFilters(docs, input).map(doc => doc.id)).toEqual([0, 1, 2, 3, 4])
    expect(sortBuildings(docs, 'grade').map(doc => doc.id)).toEqual([7, 6, 5, 0, 1, 2, 3, 4])
  })
  it('公开mapper和分面将旧值与null合并为未评级', async () => {
    const docs = ['creative-park', 'serviced-office', null].map((grade, i) => makeBuilding({ id: i + 1, slug: `b${i}`, grade: grade as 'creative-park' | 'serviced-office' | null }))
    const result = await searchBuildingsFiltered({ sort: 'grade', page: 1, pageSize: 24, grade: ['ungraded'] }, createSearchContext('shanghai'), makeHomepageAdapter({ findEffectiveBuildings: async () => docs }))
    expect(result.totalDocs).toBe(3)
    expect(result.docs.map(doc => doc.grade)).toEqual(['ungraded', 'ungraded', 'ungraded'])
    expect(result.facets.grades).toEqual([{ value: 'ungraded', count: 3 }])
  })
  it('schema保留旧枚举，正式下拉只给四值，读取空值和旧值均为未评级', async () => {
    expect(gradeField.defaultValue).toBeTypeOf('function')
    const defaultValue = gradeField.defaultValue as () => string
    expect(defaultValue()).toBe('ungraded')
    expect(gradeField.options.map(option => typeof option === 'string' ? option : option.value)).toEqual(['super-grade-a', 'grade-a', 'grade-b', 'ungraded', 'creative-park', 'serviced-office'])
    expect(filterBuildingGradeOptions({ options: gradeField.options }).map(option => typeof option === 'string' ? option : option.value)).toEqual(['super-grade-a', 'grade-a', 'grade-b', 'ungraded'])
    const afterRead = gradeField.hooks?.afterRead?.[0]
    expect(afterRead).toBeTypeOf('function')
    for (const value of ['creative-park', 'serviced-office', null, undefined]) expect(await afterRead?.({ value } as never)).toBe('ungraded')
  })
  it('部分更新不注入grade，新建默认未评级，显式旧值和空值保存为未评级', () => {
    expect(runInput({ name: '新名称' })).toEqual({ name: '新名称' })
    expect(runInput({ name: '新楼盘' }, 'create').grade).toBe('ungraded')
    for (const grade of ['creative-park', 'serviced-office', null, '']) expect(runInput({ grade }).grade).toBe('ungraded')
    for (const grade of ['super-grade-a', 'grade-a', 'grade-b', 'ungraded']) expect(runInput({ grade }).grade).toBe(grade)
  })
  it('非法输入不静默降级，字段校验拒绝字符串及非字符串垃圾输入', async () => {
    expect(gradeField.validate).toBeTypeOf('function')
    for (const grade of ['garbage', 42, {}, []]) {
      expect(runInput({ grade }).grade).toBe(grade)
      expect(await gradeField.validate?.(grade as never, {} as never)).not.toBe(true)
    }
  })
  it('后台未评级条件同时覆盖旧值和NULL', () => {
    expect(buildingGradeWhere('ungraded')).toEqual({ or: [{ grade: { in: ['ungraded', 'creative-park', 'serviced-office'] } }, { grade: { exists: false } }] })
    expect(buildingGradeWhere('grade-b')).toEqual({ grade: { equals: 'grade-b' } })
  })
  it.each(['grade-b', 'ungraded', 'creative-park', 'serviced-office', null] as const)('mini卡片和详情输出规范等级：%s', grade => {
    const detail = mapBuildingDetail({ ...BUILDING_JINGAN_CENTER, grade })
    expect(detail).not.toBeNull()
    if (!detail) throw new Error('缺少详情')
    const expected = grade === 'grade-b' ? 'grade-b' : 'ungraded'
    const summary = mapBuildingSummary({ ...BUILDING_JINGAN_CENTER, grade })
    if (!summary) throw new Error('缺少卡片')
    expect(mapMiniBuildingCard({ ...summary, grade }, 'https://example.com').grade).toBe(expected)
    expect(mapMiniBuildingDetail(detail, { asOf: '2026-10-18T00:00:00Z', groups: [], availableGroups: [], totalEffectiveListings: 0, resultCount: 0, validationErrors: [] }, [], 'https://example.com', 'v1').grade).toBe(expected)
    expect(detail.factGroups.flatMap(group => group.facts).find(fact => fact.label === '楼宇等级')?.value).toBe(grade === 'grade-b' ? '乙级' : '未评级')
  })
})
