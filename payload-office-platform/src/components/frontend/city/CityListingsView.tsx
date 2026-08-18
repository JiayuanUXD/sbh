import Link from 'next/link'
import React from 'react'
import FilterBar from '@/components/frontend/FilterBar'
import InquiryModal from '@/components/frontend/InquiryModal'
import ListingGrid from '@/components/frontend/ListingGrid'
import MobileFilterDrawer from '@/components/frontend/MobileFilterDrawer'
import Pagination from '@/components/frontend/Pagination'
import { buildCanonicalSearchParams, type ListingSearchInput } from '@/domain/public-catalog'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { getCachedListingDistrictOptions, getCachedSearchListings } from '@/lib/frontend/cached-queries'

type ListingResult = Awaited<ReturnType<typeof getCachedSearchListings>>
type Districts = Awaited<ReturnType<typeof getCachedListingDistrictOptions>>

/**
 * 租售频道共用的文案。
 *
 * 组件复用不等于文案复用：同一套栅格里,「在租房源」「统一租金单位」「扩大价格范围」
 * 放到出售页就是错的语境。集中成表而不是散在 JSX 里,新增交易类型时只补一行。
 */
const CHANNEL_COPY = {
  lease: {
    noun: '在租房源',
    unitNote: '已按统一租金单位显示',
    emptyDesc: '试试调整筛选条件或扩大价格范围。',
  },
  sale: {
    noun: '出售房源',
    unitNote: '已按统一计价单位显示',
    emptyDesc: '试试调整筛选条件或扩大总价范围。',
  },
} as const satisfies Record<'lease' | 'sale', Readonly<Record<string, string>>>

/** Full legacy listing presentation, parameterized only by trusted city DTO/context. */
export default function CityListingsView({ city, result, districts, input, basePath, routeMode, businessType = 'lease' }: Readonly<{
  city: CityContext
  result: ListingResult
  districts: Districts
  input: ListingSearchInput
  basePath: string
  routeMode: 'legacy' | 'prefixed'
  /** 当前频道；决定文案语境。缺省为租赁,保持既有调用零改动。 */
  businessType?: 'lease' | 'sale'
}>) {
  const copy = CHANNEL_COPY[businessType]
  const heading = routeMode === 'legacy' ? copy.noun : `${city.name}${copy.noun}`
  const { docs, pagination, filteredByRentUnit } = result
  const { page, totalPages, totalDocs, hasNextPage, hasPrevPage } = pagination
  const isOutOfBounds = page > totalPages && totalDocs > 0
  const isEmpty = docs.length === 0
  const rangeStart = docs.length > 0 ? (page < totalPages ? (page - 1) * docs.length + 1 : totalDocs - docs.length + 1) : 0
  const rangeEnd = rangeStart > 0 ? rangeStart + docs.length - 1 : 0
  const buildPageHref = (targetPage: number) => {
    const params = buildCanonicalSearchParams(input)
    if (targetPage <= 1) params.delete('page')
    else params.set('page', String(targetPage))
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  return (
    <div className="listings-page">
      <header className="listings-page__header"><h1 className="page-title">{heading}</h1><p className="page-subtitle">共 {totalDocs} 套{copy.noun} {filteredByRentUnit ? <span className="text-muted">· {copy.unitNote}</span> : null}</p></header>
      <div className="filter-bar__desktop"><FilterBar districts={districts} basePath={basePath} /></div>
      <div className="filter-bar__mobile"><MobileFilterDrawer districts={districts} totalDocs={totalDocs} basePath={basePath} citySlug={routeMode === 'prefixed' ? city.slug : undefined} /></div>
      {isOutOfBounds ? <div className="empty-state" role="status"><p className="empty-state__title">第 {page} 页超出范围</p><p className="empty-state__desc">当前共 {totalPages} 页，已显示最后一页结果。</p><div className="empty-state__action"><Link href={buildPageHref(totalPages)} className="btn btn--ghost" data-event-name="listings_goto_last_page">查看第 {totalPages} 页</Link></div></div> : null}
      {!isOutOfBounds && isEmpty ? <div className="empty-state" role="status"><p className="empty-state__title">没有符合条件的房源</p><p className="empty-state__desc">{copy.emptyDesc}</p><div className="empty-state__action"><Link href={basePath} className="btn btn--ghost" data-event-name="listings_clear_filters">清除筛选</Link><InquiryModal pageType="search" triggerLabel="提交需求" triggerVariant="primary" /></div></div> : null}
      {!isOutOfBounds && !isEmpty ? <><ListingGrid docs={docs} citySlug={routeMode === 'prefixed' ? city.slug : undefined} /><p className="listings-page__count" aria-live="polite">显示第 {rangeStart}–{rangeEnd} 套，共 {totalDocs} 套</p><Pagination page={page} totalPages={totalPages} totalDocs={totalDocs} buildPageHref={buildPageHref} /></> : null}
      <span className="visually-hidden" aria-hidden="true">{hasNextPage ? 'next' : ''}{hasPrevPage ? 'prev' : ''}</span>
    </div>
  )
}
