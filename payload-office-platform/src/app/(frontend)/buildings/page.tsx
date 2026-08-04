import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'
import BuildingFilterBar from '@/components/frontend/BuildingFilterBar'
import BuildingGrid from '@/components/frontend/BuildingGrid'
import { BUILDING_GRADE_LABELS, type BuildingGrade } from '@/components/frontend/building-grade'
import InquiryModal from '@/components/frontend/InquiryModal'
import Pagination from '@/components/frontend/Pagination'
import {
  defaultSearchContext,
  searchBuildings,
} from '@/domain/public-catalog'
import { buildPageMetadata } from '@/lib/frontend/metadata'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 24

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: '找写字楼',
    canonicalPath: '/buildings',
  })
}

export default async function BuildingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const resolved = await searchParams
  const pageParam = typeof resolved.page === 'string' ? resolved.page : '1'
  const page = Math.max(1, parseInt(pageParam, 10) || 1)
  const districtParam = typeof resolved.district === 'string' ? resolved.district : undefined
  const gradeParam =
    typeof resolved.grade === 'string' && resolved.grade in BUILDING_GRADE_LABELS
      ? (resolved.grade as BuildingGrade)
      : undefined

  const ctx = defaultSearchContext()
  const result = await searchBuildings(ctx)
  const { docs: allDocs } = result

  // 筛选候选值取自全量结果，这样切换筛选时 chip 组不会自己消失。
  const districtOptions = Array.from(
    new Map(
      allDocs
        .flatMap((doc) => (doc.district ? [doc.district] : []))
        .map((d) => [d.slug, { slug: d.slug, name: d.name }]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  const gradeOptions = (Object.keys(BUILDING_GRADE_LABELS) as BuildingGrade[]).filter((grade) =>
    allDocs.some((doc) => doc.grade === grade),
  )

  const matchedDocs = allDocs.filter((doc) => {
    if (districtParam && doc.district?.slug !== districtParam) return false
    if (gradeParam && doc.grade !== gradeParam) return false
    return true
  })
  const totalDocs = matchedDocs.length
  const hasActiveFilters = Boolean(districtParam ?? gradeParam)

  // 前端分页（searchBuildings 返回全部有效楼盘）
  const totalPages = Math.max(1, Math.ceil(totalDocs / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  const docs = matchedDocs.slice(start, start + PAGE_SIZE)

  const isEmpty = docs.length === 0
  const rangeStart = docs.length > 0 ? start + 1 : 0
  const rangeEnd = rangeStart > 0 ? rangeStart + docs.length - 1 : 0

  function buildPageHref(targetPage: number): string {
    const params = new URLSearchParams()
    if (districtParam) params.set('district', districtParam)
    if (gradeParam) params.set('grade', gradeParam)
    if (targetPage > 1) params.set('page', String(targetPage))
    const qs = params.toString()
    return qs ? `/buildings?${qs}` : '/buildings'
  }

  return (
    <div className="listings-page">
      <header className="listings-page__header">
        <h1 className="page-title">找写字楼</h1>
        <p className="page-subtitle">
          {hasActiveFilters ? `筛选出 ${totalDocs} 个楼盘` : `共 ${totalDocs} 个楼盘`}
        </p>
      </header>

      <BuildingFilterBar
        districts={districtOptions}
        grades={gradeOptions}
        activeDistrict={districtParam}
        activeGrade={gradeParam}
      />

      {isEmpty && (
        <div className="empty-state" role="status">
          <p className="empty-state__title">
            {hasActiveFilters ? '当前筛选下没有楼盘' : '暂无楼盘'}
          </p>
          <p className="empty-state__desc">
            {hasActiveFilters
              ? '试着放宽区域或等级条件，或直接告诉我们需求。'
              : '目前没有可展示的楼盘信息。'}
          </p>
          <div className="empty-state__action">
            {hasActiveFilters && (
              <Link className="btn btn--ghost" href="/buildings">
                清除筛选
              </Link>
            )}
            <InquiryModal
              pageType="search"
              triggerLabel="提交需求"
              triggerVariant="primary"
            />
          </div>
        </div>
      )}

      {!isEmpty && (
        <>
          <BuildingGrid docs={docs} />

          <p className="listings-page__count" aria-live="polite">
            显示第 {rangeStart}–{rangeEnd} 个，共 {totalDocs} 个楼盘
          </p>

          <Pagination
            page={safePage}
            totalPages={totalPages}
            totalDocs={totalDocs}
            buildPageHref={buildPageHref}
          />
        </>
      )}
    </div>
  )
}
