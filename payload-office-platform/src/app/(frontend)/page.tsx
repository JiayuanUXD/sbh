import Link from 'next/link'
import React from 'react'
import { getDistricts, getFeaturedListings } from '@/lib/frontend/queries'
import ListingCard from '@/components/frontend/ListingCard'
import './styles.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '上海中高端商务办公租赁平台',
  description: '聚合上海甲级写字楼、服务式办公室、共享办公与整层办公机会，免费帮你匹配。',
}

export default async function HomePage() {
  const [featured, districts] = await Promise.all([
    getFeaturedListings(6),
    getDistricts(),
  ])

  return (
    <div className="home">
      <section className="hero">
        <p className="hero__eyebrow">Shanghai Premium Office Leasing</p>
        <h1 className="hero__heading">为成长型企业匹配更体面的上海办公室</h1>
        <p className="hero__summary">
          聚合甲级写字楼、服务式办公室、共享办公与整层办公机会，免费帮你匹配。
        </p>
        <Link href="/listings" className="btn btn--primary">浏览在租房源</Link>
      </section>

      <section className="section">
        <h2 className="section__title">按区域浏览</h2>
        <div className="district-chips">
          {districts.map((d: any) => (
            <Link key={d.id} href={`/listings?district=${d.slug}`} className="tag tag--lg">
              {d.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">推荐房源</h2>
        {featured.length === 0 ? (
          <p className="empty">暂无推荐房源。</p>
        ) : (
          <div className="card-grid">
            {featured.map((l: any) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
