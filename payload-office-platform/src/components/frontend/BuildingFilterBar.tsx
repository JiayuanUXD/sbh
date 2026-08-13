import Link from 'next/link'
import React from 'react'
import { BUILDING_GRADE_LABELS, type BuildingGrade } from './building-grade'

/**
 * 楼盘列表页筛选条（F-006）
 *
 * 与 /listings 的 FilterBar 共用 .filter-bar / .filter-chip 视觉，但只提供
 * 区域与等级两组——楼盘没有租金/工位这类房源级字段，硬凑同样的字段数只会
 * 制造空筛选。
 *
 * 守护不变量：
 *   - 点击即导航（Link），URL 是筛选条件的 single source of truth；
 *   - 切换筛选重置 page，避免停留在越界页码上看到空结果；
 *   - 无候选值的分组不渲染（例如所有楼盘都缺 grade 时不出现等级行）。
 */

type District = Readonly<{ slug: string; name: string }>

type BuildingFilterBarProps = Readonly<{
  districts: readonly District[]
  grades: readonly BuildingGrade[]
  activeDistrict?: string
  activeGrade?: string
  basePath?: string
}>

function buildHref(updates: Readonly<Record<string, string | null>>, current: Readonly<Record<string, string | undefined>>, basePath: string): string {
  const next = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...current, ...updates })) {
    if (value) next.set(key, value)
  }
  const qs = next.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

export default function BuildingFilterBar({
  districts,
  grades,
  activeDistrict,
  activeGrade,
  basePath = '/buildings',
}: BuildingFilterBarProps) {
  const current = { district: activeDistrict, grade: activeGrade }
  const hasDistricts = districts.length > 0
  const hasGrades = grades.length > 0
  if (!hasDistricts && !hasGrades) return null

  return (
    <div className="filter-bar" role="search" aria-label="楼盘筛选">
      {hasDistricts && (
        <div className="filter-bar__row">
          <span className="filter-bar__row-label">区域</span>
          <div className="filter-bar__chips">
            <Link
              className={`filter-chip${!activeDistrict ? ' is-active' : ''}`}
              href={buildHref({ district: null }, current, basePath)}
              aria-current={!activeDistrict ? 'true' : undefined}
            >
              全部
            </Link>
            {districts.map((d) => (
              <Link
                key={d.slug}
                className={`filter-chip${activeDistrict === d.slug ? ' is-active' : ''}`}
                href={buildHref({ district: d.slug }, current, basePath)}
                aria-current={activeDistrict === d.slug ? 'true' : undefined}
              >
                {d.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {hasGrades && (
        <div className="filter-bar__row">
          <span className="filter-bar__row-label">等级</span>
          <div className="filter-bar__chips">
            <Link
              className={`filter-chip${!activeGrade ? ' is-active' : ''}`}
              href={buildHref({ grade: null }, current, basePath)}
              aria-current={!activeGrade ? 'true' : undefined}
            >
              全部
            </Link>
            {grades.map((grade) => (
              <Link
                key={grade}
                className={`filter-chip${activeGrade === grade ? ' is-active' : ''}`}
                href={buildHref({ grade }, current, basePath)}
                aria-current={activeGrade === grade ? 'true' : undefined}
              >
                {BUILDING_GRADE_LABELS[grade]}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
