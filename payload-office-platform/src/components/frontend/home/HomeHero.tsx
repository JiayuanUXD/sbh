import React from 'react'
import HomeHeroMedia from '@/components/frontend/HomeHeroMedia'
import HomeSearchPill from './HomeSearchPill'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { DistrictViewModel } from '@/domain/public-catalog/contracts'

/** OPT-035 Hero：视频/图片背景 + 三段遮罩 + 56px 白字标题 + 搜索 pill + 热门 chips。 */
export default function HomeHero({ city, districts, routeMode }: Readonly<{
  city: CityContext
  districts: readonly DistrictViewModel[]
  routeMode: 'legacy' | 'prefixed'
}>) {
  const citySlug = routeMode === 'prefixed' ? city.slug : undefined
  const prefix = citySlug ? `/${citySlug}` : ''
  const heading = city.profile.hero.heading || '把每一平米算清楚。'
  const body = city.profile.hero.body || '在租房源实时同步 · 面积与租金逐条核过'
  const chips = districts.slice(0, 4)
  return (
    <section className="hm-hero" aria-label="站点介绍与搜索">
      <HomeHeroMedia poster={routeMode === 'prefixed' ? city.profile.hero.media : null} />
      <div className="hm-hero__scrim" aria-hidden="true" />
      <div className="hm-container hm-hero__inner">
        <h1 className="hm-hero__title">{heading}</h1>
        <p className="hm-hero__lead">{body}</p>
        <HomeSearchPill districts={districts.map((d) => ({ slug: d.slug, name: d.name }))} citySlug={citySlug} />
        {chips.length > 0 ? (
          <nav className="hm-hero__chips" aria-label="热门筛选">
            {chips.map((d) => (
              <a key={d.slug} className="hm-hero__chip" href={`${prefix}/listings?district=${encodeURIComponent(d.slug)}`}>{d.name}</a>
            ))}
          </nav>
        ) : null}
      </div>
    </section>
  )
}
