import React from 'react'
import HomeHeroMedia from '@/components/frontend/HomeHeroMedia'
import HomeSearchPill from './HomeSearchPill'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { DistrictViewModel } from '@/domain/public-catalog/contracts'

/**
 * 首屏文案在实现层固定，不读 `CitySiteProfiles.hero.heading/body`。
 *
 * 两处**有意偏差**，都是产品裁定（2026-08-21），不是遗漏：
 *
 * 1. **与设计稿文案不同**。`docs/SBH设计任务讨论/首页.dc.html` 写的是
 *    「把每一平米算清楚。」/「7 座城市 · 在租房源实时同步 · 面积与租金逐条核过」，
 *    产品指定改回下面这两句（即改版前站上在用、目前仍存在上海 profile 的
 *    heroHeading / heroBody 里的文案）。设计稿定的是版式与视觉语言，文案归产品。
 * 2. **全站共用一句，不按城市定制**。所有城市路由（`/` 与 `/{city}`）渲染同一个
 *    H1/副标；城市差异由 title / description / OG 承担（见 `metadata.ts`）。
 *
 * 因此**不要**把它接回 `city.profile.hero.*`——逐城 profile 值会直接破坏第 2 条。
 * `profile.hero.media` 仍然是本组件的背景媒体来源，`ComingSoonCityView` 也仍然用
 * `profile.hero` 的文案，运营配置能力没有整体丢失。
 *
 * SEO 代价已知并接受：各城首页 H1 完全相同、不含城市名与品类词，与逐城的
 * title/description 口径不一致。多城市路由真正开启前应重新评估（见工作项
 * `specs/work-items/OPT-035-homepage-apple-redesign.md` 遗留段）。
 */
const HERO_HEADING = '汇聚高端商务空间，赋能企业卓越成长'
const HERO_BODY = '覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策'

/** OPT-035 Hero：视频/图片背景 + 三段遮罩 + 56px 白字标题 + 搜索 pill + 热门 chips。 */
export default function HomeHero({ city, districts, routeMode }: Readonly<{
  city: CityContext
  districts: readonly DistrictViewModel[]
  routeMode: 'legacy' | 'prefixed'
}>) {
  const citySlug = routeMode === 'prefixed' ? city.slug : undefined
  const prefix = citySlug ? `/${citySlug}` : ''
  const chips = districts.slice(0, 4)
  return (
    <section className="hm-hero" aria-label="站点介绍与搜索">
      <HomeHeroMedia poster={routeMode === 'prefixed' ? city.profile.hero.media : null} />
      <div className="hm-hero__scrim" aria-hidden="true" />
      <div className="hm-container hm-hero__inner">
        <h1 className="hm-hero__title">{HERO_HEADING}</h1>
        <p className="hm-hero__lead">{HERO_BODY}</p>
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
