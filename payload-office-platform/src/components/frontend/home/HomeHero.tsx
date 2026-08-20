import React from 'react'
import HomeHeroMedia from '@/components/frontend/HomeHeroMedia'
import HomeSearchPill from './HomeSearchPill'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { DistrictViewModel } from '@/domain/public-catalog/contracts'

/**
 * 首屏文案按设计稿（`docs/SBH设计任务讨论/首页.dc.html`）固定，不再读
 * `CitySiteProfiles.hero.heading/body`。
 *
 * 原因：profile 里存的是旧版营销文案（「汇聚高端商务空间，赋能企业卓越成长」），
 * 而 `profile.hero.x || 设计稿文案` 的写法让回退分支永远走不到，改版后的首屏
 * 仍然是旧口吻。三个选项里：
 *   - 改生产 profile 数据 → 属数据变更，不在本前端改版分支的范围内，且新旧
 *     两套文案会在灰度期并存；
 *   - 反转优先级（设计稿优先、profile 仅在「显式覆盖」时生效）→ 现有 schema
 *     没有「是否显式覆盖」的表达，只能靠猜字符串，脆弱；
 *   - 实现层固定 → 立即、确定地让所有已上线城市首页与设计稿一致。
 * 选第三个。首屏是全站品牌陈述（「7 座城市」是平台口径，不是单城口径），
 * 本就不该逐城改写；`profile.hero` 仍然服务未开城的 ComingSoonCityView，
 * `profile.hero.media` 也仍然是本组件的背景媒体来源，运营配置能力没有整体丢失。
 * 若日后要恢复逐城可配，正确做法是按新设计语言重写 profile 文案后再放开优先级。
 */
const HERO_HEADING = '把每一平米算清楚。'
const HERO_BODY = '7 座城市 · 在租房源实时同步 · 面积与租金逐条核过'

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
