import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'
import HeroSearch from '@/components/frontend/HeroSearch'
import HomeHeroMedia from '@/components/frontend/HomeHeroMedia'
import ListingCard from '@/components/frontend/ListingCard'
import CategoryTiles from '@/components/frontend/CategoryTiles'
import DistrictCards from '@/components/frontend/DistrictCards'
import FeaturedBuildings from '@/components/frontend/FeaturedBuildings'
import ValueProps from '@/components/frontend/ValueProps'
import NewsSection from '@/components/frontend/NewsSection'
import { getCachedHomepage } from '@/lib/frontend/cached-queries'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import './styles.css'

export const dynamic = 'force-dynamic'

// F6.3：统一使用 buildPageMetadata 构造 metadata（canonical / OG / robots）
export const metadata: Metadata = buildPageMetadata({
  title: '上海中高端商务办公租赁平台',
  description: '覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策。',
  canonicalPath: '/',
})

export default async function HomePage() {
  const {
    featuredListings,
    districts,
    featuredBuildings,
    districtCards,
    latestArticles,
  } = await getCachedHomepage()

  return (
    <div className="home">
      <section className="hero">
        <HomeHeroMedia />
        <div className="hero__scrim" aria-hidden="true" />
        <div className="hero__inner">
          <p className="hero__eyebrow">Shanghai Premium Office Leasing</p>
          <h1 className="hero__heading">汇聚高端商务空间，赋能企业卓越成长</h1>
          <p className="hero__summary">
            覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策
          </p>
          <HeroSearch
            districts={districts}
            featuredBuildings={featuredBuildings.slice(0, 6).map((b) => ({
              slug: b.slug,
              name: b.name,
            }))}
          />
        </div>
      </section>

      <CategoryTiles />

      <DistrictCards districts={districtCards} />

      <FeaturedBuildings buildings={featuredBuildings} />

      <section className="section" aria-labelledby="featured-listings-title">
        <div className="section__header">
          <h2 className="section__title" id="featured-listings-title">推荐房源</h2>
          <Link href="/listings" prefetch={false} className="text-copper" data-event-name="home_browse_all_listings">浏览全部房源 →</Link>
        </div>
        {featuredListings.length === 0 ? (
          <p className="empty-state empty-state--inline">暂无推荐房源。</p>
        ) : (
          <div className="card-grid">
            {featuredListings.map((l) => (
              <ListingCard key={l.id} listing={l} showFeaturedTag={false} />
            ))}
          </div>
        )}
      </section>

      <ValueProps />

      <NewsSection articles={latestArticles} />
    </div>
  )
}
