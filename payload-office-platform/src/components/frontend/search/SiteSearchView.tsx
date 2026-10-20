import Link from 'next/link'
import React from 'react'

import ArticleCard from '@/components/frontend/ArticleCard'
import BuildingResultCard from '@/components/frontend/listing/BuildingResultCard'
import ListingResultCard from '@/components/frontend/listing/ListingResultCard'
import ListPager from '@/components/frontend/listing/ListPager'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type {
  ArticleListResult,
  BuildingSummaryViewModel,
  ListingCardViewModel,
} from '@/domain/public-catalog/contracts'
import type { SearchTab } from '@/domain/search/tabs'
import type {
  SearchFallback,
  SiteSearchBuildings,
  SiteSearchListings,
} from '@/lib/frontend/cached-queries'

import SearchTabs from './SearchTabs'
import SearchZeroState from './SearchZeroState'
import SearchAnalytics from './SearchAnalytics'
import SiteSearchForm from './SiteSearchForm'

const EMPTY_FALLBACK: SearchFallback = { districts: [], buildings: [], listings: [] }

/** 站内搜索的编排层：只做投影与布局，取数在路由层，卡片复用列表页组件。 */
export default function SiteSearchView({
  city,
  basePath,
  q,
  tab,
  page,
  fallback,
  listings,
  buildings,
  articles,
}: Readonly<{
  city: CityContext
  basePath: string
  q: string
  tab: SearchTab
  page: number
  fallback: SearchFallback | null
  listings: SiteSearchListings | null
  buildings: SiteSearchBuildings | null
  articles: ArticleListResult | null
}>) {
  const fallbackData = fallback ?? EMPTY_FALLBACK
  const hasQuery = q.length > 0
  const counts = {
    listings: listings?.result.pagination.totalDocs ?? 0,
    buildings: buildings?.result.totalDocs ?? 0,
    news: articles?.totalDocs ?? 0,
  } as const
  const total = counts.listings + counts.buildings + counts.news

  const hrefOf = (target: SearchTab, targetPage = 1) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (target !== 'all') params.set('tab', target)
    if (targetPage > 1) params.set('page', String(targetPage))
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  const renderListings = (docs: readonly ListingCardViewModel[]) => (
    <div className="ls-grid">
      {docs.map((listing) => (
        <ListingResultCard key={listing.slug} listing={listing} citySlug={city.slug} />
      ))}
    </div>
  )

  const renderBuildings = (docs: readonly BuildingSummaryViewModel[]) => (
    <div className="ls-grid">
      {docs.map((building) => (
        <BuildingResultCard key={building.slug} building={building} citySlug={city.slug} />
      ))}
    </div>
  )

  const renderArticles = (docs: ArticleListResult['docs']) => (
    <div className="ls-grid">
      {docs.map((article) => (
        <ArticleCard key={article.slug} article={article} />
      ))}
    </div>
  )

  const section = (
    title: string,
    count: number | null,
    href: string | null,
    children: React.ReactNode,
  ) => (
    <section className="sw-section">
      <div className="sw-section__head">
        <h2>
          {title}
          {count != null ? <span className="sw-section__count">{count}</span> : null}
        </h2>
        {href != null ? <Link href={href}>查看全部 {count} 条 →</Link> : null}
      </div>
      {children}
    </section>
  )

  const resolved = [...(listings?.resolved ?? []), ...(buildings?.resolved ?? [])]
  const suggestions = Array.from(new Set(resolved.map((entry) => entry.name))).slice(0, 3)
  const entityEntry = resolved.find((entry) => entry.kind === 'building')
  const entity = entityEntry ? { name: entityEntry.name, slug: entityEntry.slug } : null

  return (
    <div className="ls-page sw-page">
      {hasQuery ? (
        <SearchAnalytics
          city={city.slug}
          q={q}
          tab={tab}
          page={page}
          counts={counts}
          relaxed={listings?.relaxed ?? false}
        />
      ) : null}
      <header className="ls-container sw-head">
        <h1 className="ls-head__title">搜索</h1>
        <p className="ls-head__sub" aria-live="polite">
          {hasQuery ? (
            <>共 <span className="sf-num">{total}</span> 条结果</>
          ) : (
            '输入楼盘、商圈、地铁或关键词开始搜索'
          )}
        </p>
      </header>

      <div className="ls-container">
        <SiteSearchForm citySlug={city.slug} q={q} action={basePath} />
      </div>

      {!hasQuery ? (
        <div className="ls-container">
          {section('热门区域', null, null, (
            <ul className="sw-districts">
              {fallbackData.districts.map((district) => (
                <li key={district.slug}>
                  <Link href={`/${city.slug}/area/${district.slug}`}>
                    {district.name}
                    <span>{district.count} 套</span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
          {fallbackData.buildings.length > 0
            ? section('热门楼盘', null, null, renderBuildings(fallbackData.buildings))
            : null}
          {fallbackData.listings.length > 0
            ? section('推荐房源', null, null, renderListings(fallbackData.listings))
            : null}
        </div>
      ) : total === 0 ? (
        <div className="ls-container">
          <SearchZeroState
            basePath={basePath}
            citySlug={city.slug}
            q={q}
            fallback={fallbackData}
            suggestions={suggestions}
            entity={entity}
          />
        </div>
      ) : (
        <>
          <div className="ls-container">
            <SearchTabs
              basePath={basePath}
              q={q}
              tab={tab}
              counts={{ all: total, ...counts }}
            />
          </div>

          <div className="ls-container ls-results">
            {listings?.relaxed ? (
              <p className="sw-relaxed">
                没有完全匹配的结果
                {listings.relaxedTerms.length > 0
                  ? `，已忽略「${listings.relaxedTerms.join('」「')}」`
                  : ''}
                ，以下为放宽后的结果。
              </p>
            ) : null}
            {tab === 'all' ? (
              <>
                {counts.listings > 0
                  ? section('房源', counts.listings, hrefOf('listings'), renderListings(listings?.result.docs.slice(0, 8) ?? []))
                  : null}
                {counts.buildings > 0
                  ? section('楼盘', counts.buildings, hrefOf('buildings'), renderBuildings(buildings?.result.docs.slice(0, 4) ?? []))
                  : null}
                {counts.news > 0
                  ? section('资讯', counts.news, hrefOf('news'), renderArticles(articles?.docs.slice(0, 3) ?? []))
                  : null}
              </>
            ) : null}

            {tab === 'listings' ? (
              counts.listings > 0 ? (
                <>
                  {renderListings(listings?.result.docs ?? [])}
                  <ListPager
                    page={page}
                    totalPages={listings?.result.pagination.totalPages ?? 1}
                    buildPageHref={(target) => hrefOf('listings', target)}
                  />
                </>
              ) : counts.buildings > 0 ? (
                /* 分类型零结果：关键词命中了楼盘但楼盘暂无在租房源。
                   给楼盘出口而不是「没有找到相关房源」的死路。 */
                <div className="sw-crossout">
                  <p className="sw-crossout__note">
                    该关键词暂无在租房源，但命中了 {counts.buildings} 个相关楼盘。
                  </p>
                  {renderBuildings(buildings?.result.docs.slice(0, 4) ?? [])}
                  <Link className="sw-crossout__link" href={hrefOf('buildings')}>
                    查看全部 {counts.buildings} 个楼盘 →
                  </Link>
                </div>
              ) : (
                <p className="sw-tabempty">没有找到相关房源。</p>
              )
            ) : null}

            {tab === 'buildings' ? (
              counts.buildings > 0 ? (
                <>
                  {renderBuildings(buildings?.result.docs ?? [])}
                  <ListPager
                    page={page}
                    totalPages={buildings?.result.totalPages ?? 1}
                    buildPageHref={(target) => hrefOf('buildings', target)}
                  />
                </>
              ) : (
                <p className="sw-tabempty">没有找到相关楼盘。</p>
              )
            ) : null}

            {tab === 'news' ? (
              counts.news > 0 ? (
                <>
                  {renderArticles(articles?.docs ?? [])}
                  <ListPager
                    page={page}
                    totalPages={articles?.totalPages ?? 1}
                    buildPageHref={(target) => hrefOf('news', target)}
                  />
                </>
              ) : (
                <p className="sw-tabempty">没有找到相关资讯。</p>
              )
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
