import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'
import BuildingGrid from '@/components/frontend/BuildingGrid'
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

  const ctx = defaultSearchContext()
  const result = await searchBuildings(ctx)
  const { docs: allDocs, totalDocs } = result

  // 前端分页（searchBuildings 返回全部有效楼盘）
  const totalPages = Math.max(1, Math.ceil(totalDocs / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  const docs = allDocs.slice(start, start + PAGE_SIZE)

  const isEmpty = docs.length === 0
  const rangeStart = docs.length > 0 ? start + 1 : 0
  const rangeEnd = rangeStart > 0 ? rangeStart + docs.length - 1 : 0

  function buildPageHref(targetPage: number): string {
    if (targetPage <= 1) return '/buildings'
    return `/buildings?page=${targetPage}`
  }

  return (
    <div className="listings-page">
      <header className="listings-page__header">
        <h1 className="page-title">找写字楼</h1>
        <p className="page-subtitle">
          共 {totalDocs} 个楼盘
        </p>
      </header>

      {isEmpty && (
        <div className="empty-state" role="status">
          <p className="empty-state__title">暂无楼盘</p>
          <p className="empty-state__desc">目前没有可展示的楼盘信息。</p>
          <div className="empty-state__action">
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
