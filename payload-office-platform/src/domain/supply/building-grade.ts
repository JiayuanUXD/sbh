import type { CollectionBeforeValidateHook, FieldHook, Option, Where } from 'payload'

/** 质量等级与办公业态分开；声明顺序即展示、筛选与排序顺序。 */
export const BUILDING_GRADES = ['super-grade-a', 'grade-a', 'grade-b', 'ungraded'] as const
export type BuildingGrade = (typeof BUILDING_GRADES)[number]
export const BUILDING_GRADE_LABELS: Readonly<Record<BuildingGrade, string>> = {
  'super-grade-a': '超甲级',
  'grade-a': '甲级',
  'grade-b': '乙级',
  ungraded: '未评级',
}
/** 扩展期保留 PG 枚举，旧版本仍可读写；新界面隐藏。 */
export const LEGACY_BUILDING_GRADES = ['creative-park', 'serviced-office'] as const
export const BUILDING_GRADE_VALUES: ReadonlySet<string> = new Set(BUILDING_GRADES)
/** Next 缓存键不会包含引用函数的实现变化，显式隔离旧等级 DTO。 */
export const BUILDING_GRADE_SCHEMA_VERSION = 'building-grade-four-values-v1'
// Payload 字段 beforeValidate 先合并 originalDoc，再运行 collection hook。
// 以原 data 对象记录提交意图，避免共享 req/context 在批量或嵌套操作中串扰。
const omittedGradeInputs = new WeakSet<object>()
export const trackBuildingGradeInput: FieldHook = ({ data, operation }) => {
  if (operation === 'update' && data && !Object.hasOwn(data, 'grade')) omittedGradeInputs.add(data)
  return undefined
}
export function isBuildingGrade(value: unknown): value is BuildingGrade {
  return typeof value === 'string' && BUILDING_GRADE_VALUES.has(value)
}
export function normalizeBuildingGrade(value: unknown): BuildingGrade | undefined {
  if (value == null || value === '' || (typeof value === 'string' && (LEGACY_BUILDING_GRADES as readonly string[]).includes(value))) return 'ungraded'
  return isBuildingGrade(value) ? value : undefined
}
export function getBuildingGradeLabel(value: unknown): string | undefined {
  const grade = normalizeBuildingGrade(value)
  return grade ? BUILDING_GRADE_LABELS[grade] : undefined
}
export function filterBuildingGradeOptions({ options }: { options: Option[] }): Option[] {
  return options.filter(option => isBuildingGrade(typeof option === 'string' ? option : option.value))
}
/** 仅规范化本次提交的字段；非法输入原样交给 grade 字段校验拒绝。 */
export const normalizeBuildingGradeInput: CollectionBeforeValidateHook = ({ data, operation }) => {
  if (!data) return data
  if (operation === 'update' && omittedGradeInputs.delete(data)) {
    const next = { ...data }
    delete next.grade
    return next
  }
  if (!('grade' in data)) return operation === 'create' ? { ...data, grade: 'ungraded' } : data
  return { ...data, grade: normalizeBuildingGrade(data.grade) ?? data.grade }
}
/** 后台 Where 必须覆盖尚未回填的旧值及 SQL NULL。 */
export function buildingGradeWhere(grade: string): Where {
  return grade === 'ungraded' ? { or: [
    { grade: { in: ['ungraded', ...LEGACY_BUILDING_GRADES] } },
    { grade: { exists: false } },
  ] } : { grade: { equals: grade } }
}
