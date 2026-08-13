import Link from 'next/link'
import React from 'react'
import CategoryTiles from '@/components/frontend/CategoryTiles'
import DistrictCards from '@/components/frontend/DistrictCards'
import FeaturedBuildings from '@/components/frontend/FeaturedBuildings'
import HomeHeroMedia from '@/components/frontend/HomeHeroMedia'
import HeroSearch from '@/components/frontend/HeroSearch'
import ListingCard from '@/components/frontend/ListingCard'
import NewsSection from '@/components/frontend/NewsSection'
import ValueProps from '@/components/frontend/ValueProps'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { getCachedHomepage } from '@/lib/frontend/cached-queries'

type Homepage = Awaited<ReturnType<typeof getCachedHomepage>>

export default function CityHomeView({ city, homepage, routeMode }: Readonly<{
  city: CityContext
  homepage: Homepage
  routeMode: 'legacy' | 'prefixed'
}>) {
  const { featuredListings, districts, featuredBuildings, districtCards, latestArticles } = homepage
  const basePath = routeMode === 'prefixed' ? `/${city.slug}` : ''

  return (
    <div className="home">
      <section className="hero">
        <HomeHeroMedia poster={routeMode === 'prefixed' ? city.profile.hero.media : null} />
        <div className="hero__scrim" aria-hidden="true" />
        <div className="hero__inner">
          <p className="hero__eyebrow">{routeMode === 'legacy' ? 'Shanghai Premium Office Leasing' : city.profile.hero.eyebrow || `${city.name} Premium Office Leasing`}</p>
          <h1 className="hero__heading">{routeMode === 'legacy' ? '汇聚高端商务空间，赋能企业卓越成长' : city.profile.hero.heading || `${city.name}办公选址服务`}</h1>
          <p className="hero__summary">{routeMode === 'legacy' ? '覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策' : city.profile.hero.body || `为企业提供${city.name}办公空间选择。`}</p>
          <HeroSearch
            citySlug={routeMode === 'prefixed' ? city.slug : undefined}
            districts={districts}
            featuredBuildings={featuredBuildings.slice(0, 6).map((building) => ({ slug: building.slug, name: building.name }))}
          />
        </div>
      </section>
      <CategoryTiles citySlug={routeMode === 'prefixed' ? city.slug : undefined} />
      <DistrictCards districts={districtCards} citySlug={routeMode === 'prefixed' ? city.slug : undefined} />
      <FeaturedBuildings buildings={featuredBuildings} citySlug={routeMode === 'prefixed' ? city.slug : undefined} />
      <section className="section" aria-labelledby="featured-listings-title">
        <div className="section__header">
          <h2 className="section__title" id="featured-listings-title">推荐房源</h2>
          <Link href={`${basePath}/listings`} prefetch={false} className="text-copper" data-event-name="home_browse_all_listings">浏览全部房源 →</Link>
        </div>
        {featuredListings.length === 0 ? <p className="empty-state empty-state--inline">暂无推荐房源。</p> : (
          <div className="card-grid">
            {featuredListings.map((listing) => <ListingCard key={listing.id} listing={listing} showFeaturedTag={false} citySlug={routeMode === 'prefixed' ? city.slug : undefined} />)}
          </div>
        )}
      </section>
      <ValueProps />
      <NewsSection articles={latestArticles} />
    </div>
  )
}
