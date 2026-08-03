import type { Metadata } from 'next'
import React from 'react'
import ArticleCard from '@/components/frontend/ArticleCard'
import Pagination from '@/components/frontend/Pagination'
import {
  defaultSearchContext,
  listPublishedArticles,
} from '@/domain/public-catalog'
import { buildPageMetadata } from '@/lib/frontend/metadata'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 12

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}): Promise<Metadata> {
  const resolved = await searchParams
  const pageParam = typeof resolved.page === 'string' ? resolved.page : '1'
  const page = Math.max(1, parseInt(pageParam, 10) || 1)
  const canonicalPath = page > 1 ? `/news?page=${page}` : '/news'
  return buildPageMetadata({
    title: '资讯中心',
    description: '上海写字楼市场洞察、选址指南、楼盘解读与行业资讯，帮助成长型企业做出更明智的办公决策。',
    canonicalPath,
  })
}

export default async function NewsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const resolved = await searchParams
  const pageParam = typeof resolved.page === 'string' ? resolved.page : '1'
  const page = Math.max(1, parseInt(pageParam, 10) || 1)

  const ctx = defaultSearchContext()
  const result = await listPublishedArticles(ctx, { page, pageSize: PAGE_SIZE })
  const safePage = Math.min(page, result.totalPages)

  function buildPageHref(targetPage: number): string {
    if (targetPage <= 1) return '/news'
    return `/news?page=${targetPage}`
  }

  return (
    <div className="news-page">
      <header className="news-page__header">
        <h1 className="page-title">资讯中心</h1>
        <p className="page-subtitle">
          市场洞察、选址指南与行业资讯，共 {result.totalDocs} 篇
        </p>
      </header>

      {result.docs.length === 0 ? (
        <p className="empty-state empty-state--inline">暂无资讯。</p>
      ) : (
        <div className="article-grid">
          {result.docs.map((a) => (
            <ArticleCard key={a.id} article={a} />
          ))}
        </div>
      )}

      <Pagination
        page={safePage}
        totalPages={result.totalPages}
        totalDocs={result.totalDocs}
        buildPageHref={buildPageHref}
      />
    </div>
  )
}
