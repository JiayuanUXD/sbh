import React from 'react'
import HomeHero from '@/components/frontend/home/HomeHero'
import HomeTypeCards from '@/components/frontend/home/HomeTypeCards'
import HomeDistrictBento from '@/components/frontend/home/HomeDistrictBento'
import HomeBuildingsRail from '@/components/frontend/home/HomeBuildingsRail'
import HomeStatsBand from '@/components/frontend/home/HomeStatsBand'
import HomeListingsRail from '@/components/frontend/home/HomeListingsRail'
import HomeValueProps from '@/components/frontend/home/HomeValueProps'
import HomeNearbyRail from '@/components/frontend/home/HomeNearbyRail'
import HomeNewsList from '@/components/frontend/home/HomeNewsList'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { HomepageStats } from '@/domain/public-catalog/contracts'
import type { getCachedHomepage } from '@/lib/frontend/cached-queries'

type Homepage = Awaited<ReturnType<typeof getCachedHomepage>>

/**
 * OPT-035 首页编排层（Apple 中性极简）：
 * Hero → 类型 → 商圈 → 楼盘 → 数据带 → 精选房源 → 选择我们 → 核心商圈 → 资讯
 * 各 section 自带空态整段不渲染逻辑，这里只做编排与数据分发。
 */
export default function CityHomeView({ city, homepage, routeMode, stats }: Readonly<{
  city: CityContext
  homepage: Homepage
  routeMode: 'legacy' | 'prefixed'
  stats: HomepageStats
}>) {
  const citySlug = routeMode === 'prefixed' ? city.slug : undefined
  return (
    <div className="hm-home">
      <HomeHero city={city} districts={homepage.districts} routeMode={routeMode} />
      <HomeTypeCards typeSummaries={homepage.typeSummaries} citySlug={citySlug} />
      <HomeDistrictBento cards={homepage.districtCards} totalAreas={stats.businessAreas} citySlug={citySlug} />
      <HomeBuildingsRail buildings={homepage.featuredBuildings} citySlug={citySlug} totalCount={stats.buildings} />
      <HomeStatsBand stats={stats} avgResponseHours={city.profile.avgResponseHours} />
      <HomeListingsRail listings={homepage.featuredListings} citySlug={citySlug} totalCount={stats.listings} />
      <HomeValueProps />
      <HomeNearbyRail listings={homepage.nearbyListings} cityName={city.name} citySlug={citySlug} />
      <HomeNewsList articles={homepage.latestArticles} citySlug={citySlug} />
    </div>
  )
}
