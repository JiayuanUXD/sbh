import { beforeChangeTraverseFields, beforeValidateTraverseFields, deepCopyObjectSimple, type PayloadRequest, type SanitizedCollectionConfig, type SelectField } from 'payload'
import { describe, expect, it } from 'vitest'
import { Buildings } from '@/collections/Buildings'
import { normalizeBuildingGradeInput } from '@/domain/supply/building-grade'

function gradeField(fields: typeof Buildings.fields): SelectField | undefined {
  for (const field of fields) {
    if (field.type === 'select' && field.name === 'grade') return field
    const nested = 'fields' in field ? field.fields : field.type === 'tabs' ? field.tabs.flatMap(tab => tab.fields) : []
    const found = nested && gradeField(nested)
    if (found) return found
  }
}
const field = gradeField(Buildings.fields)
if (!field) throw new Error('缺少grade字段')

/** 使用 Payload 公开导出的真实字段遍历器，复现 updateDocument 的合并与校验顺序。 */
async function runPipeline(rawGrade: string | null, patch: Record<string, unknown>, req?: PayloadRequest) {
  const raw = { id: 42, grade: rawGrade, slug: 'original-building' }
  const readGrade = await field?.hooks?.afterRead?.[0]({ value: rawGrade } as never)
  const doc = { ...raw, grade: readGrade }
  const request = req ?? { context: {}, payload: { config: { localization: false } } } as unknown as PayloadRequest
  const collection = { ...Buildings, fields: [field] } as SanitizedCollectionConfig
  let data: Record<string, unknown> = { ...patch }
  const base = { collection, context: {}, doc, global: null, operation: 'update' as const,
    overrideAccess: true, req: request, parentIndexPath: '', parentIsLocalized: false,
    parentPath: '', parentSchemaPath: '' }
  await beforeValidateTraverseFields({ ...base, data, fields: [field] as SelectField[], siblingData: data, siblingDoc: doc })
  for (const hook of Buildings.hooks?.beforeValidate ?? []) {
    data = await hook({ collection, context: {}, data, operation: 'update', originalDoc: doc, req: request }) ?? data
  }
  data = deepCopyObjectSimple({ ...data, id: raw.id })
  const errors: { message: string; path: string }[] = []
  await beforeChangeTraverseFields({ ...base, data, fields: [field] as SelectField[], docWithLocales: raw,
    errors, mergeLocaleActions: [], fieldLabelPath: '', siblingData: data, siblingDoc: doc,
    siblingDocWithLocales: raw, skipValidation: false })
  expect(errors).toEqual([])
  return data
}

describe('Payload实际字段流水线：grade部分更新', () => {
  it('规范化必须是collection首个beforeValidate hook，先于其它hook复制data', () => {
    expect(Buildings.hooks?.beforeValidate?.[0]).toBe(normalizeBuildingGradeInput)
  })
  it.each(['creative-park', 'serviced-office', null, 'grade-a', 'grade-b', 'ungraded'])('原值%s，未提交grade不写入存储结果', async raw => {
    const result = await runPipeline(raw, { name: '改名' })
    expect(Object.hasOwn(result, 'grade')).toBe(false)
  })
  it.each(['creative-park', 'serviced-office', null, '', 'grade-b', 'ungraded'])('显式提交%s保存规范等级', async grade => {
    const result = await runPipeline('grade-a', { name: '改名', grade })
    expect(result.grade).toBe(grade === 'grade-b' ? 'grade-b' : 'ungraded')
  })
  it('共享同一req的并行更新分别识别省略和显式字段', async () => {
    const req = { context: {}, payload: { config: { localization: false } } } as unknown as PayloadRequest
    const results = await Promise.all([
      runPipeline('creative-park', { name: '保留' }, req),
      runPipeline('serviced-office', { name: '显式', grade: 'grade-b' }, req),
      runPipeline(null, { name: '保留空' }, req),
    ])
    expect(results.map(result => Object.hasOwn(result, 'grade'))).toEqual([false, true, false])
    expect(results[1].grade).toBe('grade-b')
  })
})
