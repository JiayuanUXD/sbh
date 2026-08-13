import Link from 'next/link'
import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import type { CityContext } from '@/domain/city-site-profile/resolver'

export default function ComingSoonCityView({ city }: Readonly<{ city: CityContext }>) {
  const basePath = `/${city.slug}`
  const profile = city.profile

  return (
    <div className="city-coming-soon">
      <section className="city-coming-soon__hero">
        {profile.hero.media ? <img className="city-coming-soon__media" src={profile.hero.media.src} alt={profile.hero.media.alt} /> : null}
        <p className="hero__eyebrow">{profile.hero.eyebrow || city.name}</p>
        <h1>{profile.hero.heading || `${city.name}服务即将开启`}</h1>
        <p>{profile.hero.body || `我们正在准备${city.name}的办公选址服务。`}</p>
        <p className="city-coming-soon__status">即将开通</p>
      </section>
      {profile.intro.heading || profile.intro.body ? (
        <section className="section city-coming-soon__intro">
          {profile.intro.heading ? <h2>{profile.intro.heading}</h2> : null}
          {profile.intro.body ? <p>{profile.intro.body}</p> : null}
        </section>
      ) : null}
      {profile.featuredRegions.length > 0 ? (
        <section className="section city-coming-soon__regions" aria-labelledby="city-featured-regions">
          <h2 id="city-featured-regions">重点服务区域</h2>
          <ul>
            {profile.featuredRegions.map((region) => <li key={region.id}>{region.name}</li>)}
          </ul>
        </section>
      ) : null}
      <section className="section city-coming-soon__actions" aria-label="城市服务入口">
        <Link className="btn btn--ghost" href={`/entrust?city=${encodeURIComponent(city.slug)}`}>委托找房</Link>
        <Link className="btn btn--ghost" href={`/publish?city=${encodeURIComponent(city.slug)}`}>投放房源</Link>
        <Link className="btn btn--ghost" href={`/city-partner?city=${encodeURIComponent(city.slug)}`}>城市合伙人</Link>
        <InquiryModal pageType="home" triggerLabel="获取选址方案" triggerVariant="primary" />
        <Link className="visually-hidden" href={basePath}>返回城市首页</Link>
      </section>
    </div>
  )
}
