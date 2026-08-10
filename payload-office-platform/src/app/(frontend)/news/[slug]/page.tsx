import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import PageContent from '@/components/frontend/PageContent'
import { serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { buildNotFoundMetadata, buildPageMetadata } from '@/lib/frontend/metadata'
import { formatPublishedDate } from '@/lib/frontend/format'
import { siteConfig } from '@/lib/frontend/site-config'
import type { Page } from '@/payload-types'
import { getCachedArticleBySlug } from '@/lib/frontend/cached-queries'

export const dynamic = 'force-dynamic'

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  market: '市场洞察',
  guide: '选址指南',
  building: '楼盘解读',
  industry: '行业资讯',
}

// ---------------------------------------------------------------------------
// Metadata（F6.2 + F6.3）：canonical / OG / robots
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = await getCachedArticleBySlug(slug)
  if (!article) {
    return buildNotFoundMetadata('资讯未找到')
  }

  const title = article.seo?.title || article.title
  const description = article.seo?.description ?? article.excerpt ?? undefined
  const canonicalPath = `/news/${encodeURIComponent(slug)}`
  const ogImage = article.coverImage?.src

  return buildPageMetadata({
    title,
    description,
    canonicalPath,
    ogType: 'article',
    ogImage,
  })
}

// ---------------------------------------------------------------------------
// 页面渲染
// ---------------------------------------------------------------------------

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const article = await getCachedArticleBySlug(slug)
  if (!article) notFound()

  const canonicalUrl = `${siteConfig.siteOrigin}/news/${encodeURIComponent(slug)}`

  // F6.3：JSON-LD Article 结构化数据（仅声明后台可保证的字段）
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    url: canonicalUrl,
  }
  if (article.excerpt) jsonLd.description = article.excerpt
  if (article.publishedAt) jsonLd.datePublished = article.publishedAt
  if (article.coverImage) jsonLd.image = article.coverImage.src

  // BreadcrumbList：与 listings/buildings 详情对齐（首页 -> 资讯中心 -> 文章）
  const origin = siteConfig.siteOrigin
  jsonLd.breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { name: '首页', path: '/' },
      { name: '资讯中心', path: '/news' },
      { name: article.title, path: `/news/${encodeURIComponent(slug)}` },
    ].map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${origin}${item.path}`,
    })),
  }

  const cat = article.category ? CATEGORY_LABEL[article.category] : null
  const date = formatPublishedDate(article.publishedAt)
  const cover = article.coverImage

  return (
    <div className="page-detail news-detail">
      <script
        type="application/ld+json"
        // 转义 </script> 防止存储型 XSS：JSON.stringify 不会转义 <。
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <nav className="breadcrumb" aria-label="面包屑">
        <Link href="/" className="breadcrumb__link">首页</Link>
        <span className="breadcrumb__sep" aria-hidden="true">/</span>
        <Link href="/news" className="breadcrumb__link">资讯中心</Link>
        <span className="breadcrumb__sep" aria-hidden="true">/</span>
        <span className="breadcrumb__current">{article.title}</span>
      </nav>

      <header className="news-detail__header">
        {cat && <span className="news-detail__cat">{cat}</span>}
        <h1 className="page-detail__title">{article.title}</h1>
        {date && (
          <p className="news-detail__date">
            <time dateTime={article.publishedAt ?? undefined}>{date}</time>
          </p>
        )}
      </header>

      {cover && (
        <div className="news-detail__cover">
          <img
            src={cover.src}
            alt={cover.alt?.trim() || article.title}
            loading="eager"
            decoding="async"
            className="news-detail__cover-img"
          />
        </div>
      )}

      {article.excerpt && !cover && (
        <p className="news-detail__excerpt">{article.excerpt}</p>
      )}

      {article.content && (
        <article className="page-detail__body">
          {/* Article['content'] 与 Page['content'] 同为 Lexical JSON，结构等价 */}
          <PageContent data={article.content as Page['content']} />
        </article>
      )}

      {(article.relatedBuildings.length > 0 || article.relatedDistricts.length > 0) && (
        <section className="news-detail__related" aria-label="相关推荐">
          <h2 className="section__title">相关推荐</h2>
          {article.relatedBuildings.length > 0 && (
            <div className="news-detail__related-group">
              <h3 className="news-detail__related-label">相关楼盘</h3>
              <ul className="news-detail__related-links" role="list">
                {article.relatedBuildings.map((b) => (
                  <li key={b.id}>
                    <Link href={`/buildings/${b.slug}`} className="news-detail__related-link">
                      {b.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {article.relatedDistricts.length > 0 && (
            <div className="news-detail__related-group">
              <h3 className="news-detail__related-label">相关商圈</h3>
              <ul className="news-detail__related-links" role="list">
                {article.relatedDistricts.map((d) => (
                  <li key={d.id}>
                    <Link href={`/listings?district=${d.slug}`} className="news-detail__related-link">
                      {d.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="page-detail__cta" aria-label="咨询入口">
        <div className="page-detail__cta-inner">
          <h2 className="page-detail__cta-title">需要专业选址建议？</h2>
          <p className="page-detail__cta-desc">
            留下联系方式，我们的顾问将在 1 个工作日内与你联系。
          </p>
          <InquiryModal
            pageType="content"
            targetSummary={article.title}
            triggerLabel="提交需求"
          />
        </div>
      </section>
    </div>
  )
}
