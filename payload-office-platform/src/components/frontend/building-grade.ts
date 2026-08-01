/**
 * 楼盘等级徽章标签映射
 *
 * 用于详情页 header 徽章和 BuildingSummaryCard 等级显示，避免重复定义。
 * 缺失 grade 时不渲染徽章。
 *
 * 注：详情组件受契约约束不导入 payload-types，这里用本地字符串字面量联合类型
 * 与 payload Building.grade 枚举对齐。
 */
export type BuildingGrade = 'grade-a' | 'super-grade-a' | 'creative-park' | 'serviced-office'

export const BUILDING_GRADE_LABELS: Readonly<Record<BuildingGrade, string>> = {
  'grade-a': '甲级',
  'super-grade-a': '超甲级',
  'creative-park': '创意园区',
  'serviced-office': '服务式办公',
}

export function getBuildingGradeLabel(grade: string | null | undefined): string | undefined {
  if (!grade) return undefined
  return BUILDING_GRADE_LABELS[grade as BuildingGrade]
}
