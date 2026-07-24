import Link from 'next/link'
import React from 'react'
import FilterBar from '@/components/frontend/FilterBar'
import ListingCard from '@/components/frontend/ListingCard'
import { parseListingFilters } from '@/lib/frontend/filters'
import { getDistricts, getListings } from '@/lib/frontend/queries'

export const dynamic = 'force-dynamic'

export const metadata = { title: '在租房源' }

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = new URLSearchParams()
  const resolved = await searchParams
  for (const [k, v] of Object.entries(resolved)) {
    if (typeof v === 'string') sp.set(k, v)
  }
  const filters = parseListingFilters(sp)

  const [result, districts] = await Promise.all([
    getListings(filters),
    getDistricts(),
  ])

  const totalPages = result.totalPages ?? 0
  const page = filters.page

  return (
    <div>
      <h1 className="page-title">在租房源</h1>
      <p className="page-subtitle">共 {result.totalDocs} 套在租房源</p>
      <FilterBar districts={districts} />
      {result.docs.length === 0 ? (
        <p className="empty">没有符合条件的房源，试试调整筛选。</p>
      ) : (
        <div className="card-grid">
          {result.docs.map((l: any) => <ListingCard key={l.id} listing={l} />)}
        </div>
      )}
      {totalPages > 1 && (
        <nav className="pager">
          <Link
            href={`/listings?${withPage(sp, Math.max(1, page - 1))}`}
            className={`pager__link ${page <= 1 ? 'pager__link--disabled' : ''}`}
          >
            上一页
          </Link>
          <span className="pager__link">第 {page} / {totalPages} 页</span>
          <Link
            href={`/listings?${withPage(sp, Math.min(totalPages, page + 1))}`}
            className={`pager__link ${page >= totalPages ? 'pager__link--disabled' : ''}`}
          >
            下一页
          </Link>
        </nav>
      )}
    </div>
  )
}

function withPage(sp: URLSearchParams, page: number) {
  const next = new URLSearchParams(sp)
  next.set('page', String(page))
  return next.toString()
}
