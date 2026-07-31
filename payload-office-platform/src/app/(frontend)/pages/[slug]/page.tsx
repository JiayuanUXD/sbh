import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import PageContent from '@/components/frontend/PageContent'
import { serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { buildNotFoundMetadata, buildPageMetadata } from '@/lib/frontend/metadata'
import { siteConfig } from '@/lib/frontend/site-config'
import {
  defaultSearchContext,
  getPageBySlug,
} from '@/domain/public-catalog'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Metadata（F6.2 + F6.3）：canonical / OG / robots
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const ctx = defaultSearchContext()
  const page = await getPageBySlug(slug, ctx)
  if (!page) {
    // 草稿、删除或不存在 → noindex（F6.3 noindex 策略）
    return buildNotFoundMetadata('页面未找到')
  }

  const title = page.seo.title || page.title
  const description = page.seo.description ?? undefined
  const canonicalPath = `/pages/${encodeURIComponent(slug)}`
  const ogImage = page.hero.image?.src

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

export default async function PageDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const ctx = defaultSearchContext()
  const page = await getPageBySlug(slug, ctx)
  if (!page) notFound()

  const canonicalUrl = `${siteConfig.siteOrigin}/pages/${encodeURIComponent(slug)}`

  // F6.3：JSON-LD Article 结构化数据
  // 仅声明后台可保证的字段：headline / description / url
  // 不伪造 author / datePublished / dateModified（后台数据不能保证）
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.title,
    url: canonicalUrl,
  }
  if (page.seo.description) {
    jsonLd.description = page.seo.description
  }
  // 主图（如有）
  if (page.hero.image) {
    jsonLd.image = page.hero.image.src
  }

  const hero = page.hero
  const hasHeroImage = hero.image != null
  const hasHeroContent =
    hero.eyebrow != null ||
    hero.heading != null ||
    hero.summary != null

  // 隐私政策等法律页面（slug 以 'privacy' 或 'policy' 开头）不附加营销 CTA
  const isLegalPage = /^(privacy|policy)/i.test(page.slug)

  return (
    <div className="page-detail">
      <script
        type="application/ld+json"
        // 转义 </script> 防止存储型 XSS：JSON.stringify 不会转义 <。
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(jsonLd),
        }}
      />

      <nav className="breadcrumb" aria-label="面包屑">
        <Link href="/" className="breadcrumb__link">首页</Link>
        <span className="breadcrumb__sep" aria-hidden="true">/</span>
        <span className="breadcrumb__current">{page.title}</span>
      </nav>

      {(hasHeroContent || hasHeroImage) && (
        <header className="page-detail__hero">
          {hasHeroImage && (
            <div className="page-detail__hero-image">
              <img
                src={hero.image!.src}
                alt={hero.image!.alt}
                width={hero.image!.width}
                height={hero.image!.height}
                loading="eager"
                // 主图优先加载，避免 LCP 延迟
              />
            </div>
          )}
          {hasHeroContent && (
            <div className="page-detail__hero-text">
              {hero.eyebrow && (
                <p className="page-detail__eyebrow">{hero.eyebrow}</p>
              )}
              <h1 className="page-detail__title">
                {hero.heading || page.title}
              </h1>
              {hero.summary && (
                <p className="page-detail__summary">{hero.summary}</p>
              )}
            </div>
          )}
        </header>
      )}

      {!hasHeroContent && !hasHeroImage && (
        // 无 hero 时仍渲染 H1 保证标题层级
        <h1 className="page-detail__title page-detail__title--bare">{page.title}</h1>
      )}

      {page.content && (
        <article className="page-detail__body">
          <PageContent data={page.content} />
        </article>
      )}

      {!isLegalPage && (
        <section className="page-detail__cta" aria-label="咨询入口">
          <div className="page-detail__cta-inner">
            <h2 className="page-detail__cta-title">需要专业选址建议？</h2>
            <p className="page-detail__cta-desc">
              留下联系方式，我们的顾问将在 1 个工作日内与你联系。
            </p>
            <InquiryModal
              pageType="content"
              targetSummary={page.title}
              triggerLabel="提交需求"
            />
          </div>
        </section>
      )}
    </div>
  )
}
