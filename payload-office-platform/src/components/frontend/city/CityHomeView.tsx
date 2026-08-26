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
import type { SiteSettingsView } from '@/lib/frontend/site-settings'

type Homepage = Awaited<ReturnType<typeof getCachedHomepage>>

/**
 * OPT-035 首页编排层（Apple 中性极简）：
 * Hero → 类型 → 商圈 → 楼盘 → 数据带 → 精选房源 → 选择我们 → 核心商圈 → 资讯
 * 各 section 自带空态整段不渲染逻辑，这里只做编排与数据分发。
 *
 * **两套 stats 口径，故意分开（不要合并回一个 prop）：**
 *   - 三处 section 链接文案（「全部 N 个商圈」「全部 N 个楼盘」「查看 N 套在租」）
 *     一律用 `homepage.stats`，即**单城口径**。因为这三个链接的落点
 *     （`/listings` `/buildings` 或 `/{city}/...`）都是城市域路由：legacy 模式下
 *     列表页按 `siteConfig.defaultCity` 收敛，prefixed 模式下按路径城市收敛。
 *     数字与落点必须同口径，否则「查看 N 套」点进去只有其中一部分。
 *   - 数据带 `bandStats` 可以是**跨城汇总**：它是平台规模陈述，不带链接、不承诺
 *     任何落地页，根页 `/` 传平台汇总、城市页传本城 stats。这是唯一允许发散的地方。
 * 回归用例见 `tests/city-home-view.test.ts`。
 */
export default function CityHomeView({ city, homepage, routeMode, bandStats, siteSettings }: Readonly<{
  city: CityContext
  homepage: Homepage
  routeMode: 'legacy' | 'prefixed'
  /** 数据带口径：根页为跨城汇总，城市页为本城 stats。**不驱动任何 section 链接数字。** */
  bandStats: HomepageStats
  /**
   * 站点设置（OPT-053）。**由路由层调 `getCachedSiteSettings()` 取好传入。**
   *
   * 本组件刻意保持同步的纯编排层：取数放这里会把数据获取塞进展示层，
   * 也会让「九个 section 的编排顺序」这类断言被迫改成异步渲染。
   * 需要它的下游（Hero 文案、价值主张、类型卡）从这里分发。
   */
  siteSettings: SiteSettingsView
}>) {
  const citySlug = routeMode === 'prefixed' ? city.slug : undefined
  // section 链接数字统一取单城口径，与链接落点保持一致
  const linkStats = homepage.stats
  return (
    <div className="hm-home">
      <HomeHero
        city={city}
        districts={homepage.districts}
        routeMode={routeMode}
        heading={siteSettings.heroHeading}
        slogan={siteSettings.slogan}
      />
      <HomeTypeCards typeSummaries={homepage.typeSummaries} citySlug={citySlug} cards={siteSettings.typeCards} />
      <HomeDistrictBento cards={homepage.districtCards} totalAreas={linkStats.businessAreas} citySlug={citySlug} />
      <HomeBuildingsRail buildings={homepage.featuredBuildings} citySlug={citySlug} totalCount={linkStats.buildings} />
      <HomeStatsBand stats={bandStats} avgResponseHours={city.profile.avgResponseHours} />
      <HomeListingsRail listings={homepage.featuredListings} citySlug={citySlug} totalCount={linkStats.listings} />
      <HomeValueProps items={siteSettings.valueProps} />
      <HomeNearbyRail listings={homepage.nearbyListings} cityName={city.name} citySlug={citySlug} />
      <HomeNewsList articles={homepage.latestArticles} citySlug={citySlug} />
    </div>
  )
}
