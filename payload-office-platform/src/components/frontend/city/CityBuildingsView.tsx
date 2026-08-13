import Link from 'next/link'
import React from 'react'
import BuildingFilterBar from '@/components/frontend/BuildingFilterBar'
import BuildingGrid from '@/components/frontend/BuildingGrid'
import InquiryModal from '@/components/frontend/InquiryModal'
import Pagination from '@/components/frontend/Pagination'
import { BUILDING_GRADE_LABELS, type BuildingGrade } from '@/components/frontend/building-grade'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { getCachedSearchBuildings } from '@/lib/frontend/cached-queries'

type BuildingsResult = Awaited<ReturnType<typeof getCachedSearchBuildings>>

export default function CityBuildingsView({ city, result, searchParams, basePath, routeMode }: Readonly<{
  city: CityContext
  result: BuildingsResult
  searchParams: Record<string, string | string[] | undefined>
  basePath: string
  routeMode: 'legacy' | 'prefixed'
}>) {
  const heading = routeMode === 'legacy' ? '找写字楼' : `${city.name}写字楼`
  const pageParam = typeof searchParams.page === 'string' ? searchParams.page : '1'
  const page = Math.max(1, parseInt(pageParam, 10) || 1)
  const districtParam = typeof searchParams.district === 'string' ? searchParams.district : undefined
  const gradeParam = typeof searchParams.grade === 'string' && searchParams.grade in BUILDING_GRADE_LABELS ? searchParams.grade as BuildingGrade : undefined
  const allDocs = result.docs
  const districtOptions = Array.from(new Map(allDocs.flatMap((doc) => doc.district ? [doc.district] : []).map((district) => [district.slug, { slug: district.slug, name: district.name }])).values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
  const gradeOptions = (Object.keys(BUILDING_GRADE_LABELS) as BuildingGrade[]).filter((grade) => allDocs.some((doc) => doc.grade === grade))
  const matchedDocs = allDocs.filter((doc) => (!districtParam || doc.district?.slug === districtParam) && (!gradeParam || doc.grade === gradeParam))
  const totalDocs = matchedDocs.length
  const hasActiveFilters = Boolean(districtParam ?? gradeParam)
  const pageSize = 24
  const totalPages = Math.max(1, Math.ceil(totalDocs / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  const docs = matchedDocs.slice(start, start + pageSize)
  const isEmpty = docs.length === 0
  const rangeStart = docs.length > 0 ? start + 1 : 0
  const rangeEnd = rangeStart > 0 ? rangeStart + docs.length - 1 : 0
  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams()
    if (districtParam) params.set('district', districtParam)
    if (gradeParam) params.set('grade', gradeParam)
    if (targetPage > 1) params.set('page', String(targetPage))
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }
  return <div className="listings-page">
    <header className="listings-page__header"><h1 className="page-title">{heading}</h1><p className="page-subtitle">{hasActiveFilters ? `筛选出 ${totalDocs} 个楼盘` : `共 ${totalDocs} 个楼盘`}</p></header>
    <BuildingFilterBar districts={districtOptions} grades={gradeOptions} activeDistrict={districtParam} activeGrade={gradeParam} basePath={basePath} />
    {isEmpty ? <div className="empty-state" role="status"><p className="empty-state__title">{hasActiveFilters ? '当前筛选下没有楼盘' : '暂无楼盘'}</p><p className="empty-state__desc">{hasActiveFilters ? '试着放宽区域或等级条件，或直接告诉我们需求。' : '目前没有可展示的楼盘信息。'}</p><div className="empty-state__action">{hasActiveFilters ? <Link className="btn btn--ghost" href={basePath}>清除筛选</Link> : null}<InquiryModal pageType="search" triggerLabel="提交需求" triggerVariant="primary" /></div></div> : <><BuildingGrid docs={docs} citySlug={routeMode === 'prefixed' ? city.slug : undefined} /><p className="listings-page__count" aria-live="polite">显示第 {rangeStart}–{rangeEnd} 个，共 {totalDocs} 个楼盘</p><Pagination page={safePage} totalPages={totalPages} totalDocs={totalDocs} buildPageHref={buildPageHref} /></>}
  </div>
}
