import React from 'react'
import HomeHeroMedia from '@/components/frontend/HomeHeroMedia'
import HomeSearchPill from './HomeSearchPill'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { DistrictViewModel } from '@/domain/public-catalog/contracts'

/**
 * 首屏文案读**全局** `SiteSettings`，不读 `CitySiteProfiles.hero.*`。
 *
 * 2026-08-21 产品裁定：**全站共用一句，不按城市定制**——所有城市路由（`/` 与
 * `/{city}`）渲染同一个 H1/副标，城市差异由 title / description / OG 承担
 * （见 `metadata.ts`）。那条裁定反对的是「逐城定制」，不是「可配置」，
 * 所以接到全局单例上完全满足它，且顺带拿到了运营可配置性。
 *
 * **不要接回 `city.profile.hero.*`**——逐城 profile 值会直接破坏上面那条不变量。
 * `CitySiteProfiles` 里那三个 hero 文案字段现已改名为「未开城页 Hero …」，
 * 只服务 `ComingSoonCityView`；`profile.hero.media` 仍是本组件的背景图来源。
 *
 * SEO 代价已知并接受：各城首页 H1 完全相同、不含城市名与品类词，与逐城的
 * title/description 口径不一致。多城市路由真正开启前应重新评估（见工作项
 * `specs/work-items/OPT-035-homepage-apple-redesign.md` 遗留段）。
 */

/** OPT-035 Hero：视频/图片背景 + 三段遮罩 + 56px 白字标题 + 搜索 pill + 热门 chips。 */
export default function HomeHero({ city, districts, routeMode, heading, slogan }: Readonly<{
  city: CityContext
  districts: readonly DistrictViewModel[]
  routeMode: 'legacy' | 'prefixed'
  /** 首屏 H1。来自「站点设置 → 品牌」，由 CityHomeView 读好传入。 */
  heading: string
  /** 首屏副标题。同上。 */
  slogan: string
}>) {
  const citySlug = routeMode === 'prefixed' ? city.slug : undefined
  const prefix = citySlug ? `/${citySlug}` : ''
  const chips = districts.slice(0, 4)
  return (
    <section className="hm-hero" aria-label="站点介绍与搜索">
      <HomeHeroMedia
        poster={routeMode === 'prefixed' ? city.profile.hero.media : null}
        video={routeMode === 'prefixed' ? city.profile.hero.video : null}
        videoEnabled={routeMode !== 'prefixed' || city.profile.hero.videoEnabled}
      />
      <div className="hm-hero__scrim" aria-hidden="true" />
      <div className="hm-container hm-hero__inner">
        <h1 className="hm-hero__title">{heading}</h1>
        <p className="hm-hero__lead">{slogan}</p>
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
