import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'
import HeroSearch from '@/components/frontend/HeroSearch'
import ListingCard from '@/components/frontend/ListingCard'
import { getHomepage } from '@/domain/public-catalog'
import { defaultSearchContext } from '@/domain/public-catalog'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import './styles.css'

export const dynamic = 'force-dynamic'

// F6.3：统一使用 buildPageMetadata 构造 metadata（canonical / OG / robots）
export const metadata: Metadata = buildPageMetadata({
  title: '上海中高端商务办公租赁平台',
  description: '聚合上海甲级写字楼、服务式办公室、共享办公与整层办公机会，免费帮你匹配。',
  canonicalPath: '/',
})

export default async function HomePage() {
  const ctx = defaultSearchContext()
  const { featuredListings, districts } = await getHomepage(ctx)

  return (
    <div className="home">
      <section className="hero">
        <p className="hero__eyebrow">Shanghai Premium Office Leasing</p>
        <h1 className="hero__heading">为成长型企业匹配更体面的上海办公室</h1>
        <p className="hero__summary">
          聚合甲级写字楼、服务式办公室、共享办公与整层办公机会，免费帮你匹配。
        </p>
        <HeroSearch districts={districts} />
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">按区域浏览</h2>
          <Link href="/listings" className="text-copper" data-event-name="home_view_all_listings">查看全部 →</Link>
        </div>
        <div className="district-chips">
          {districts.map((d) => (
            <Link key={d.id} href={`/listings?district=${d.slug}`} className="tag tag--lg" data-event-name="home_district_click" data-district={d.slug}>
              {d.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">推荐房源</h2>
          <Link href="/listings" className="text-copper" data-event-name="home_browse_all_listings">浏览全部房源 →</Link>
        </div>
        {featuredListings.length === 0 ? (
          <p className="empty">暂无推荐房源。</p>
        ) : (
          <div className="card-grid">
            {featuredListings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
