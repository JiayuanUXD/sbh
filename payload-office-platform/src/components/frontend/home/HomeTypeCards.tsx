import Link from 'next/link'
import React from 'react'
import type { HomepageTypeSummary } from '@/domain/public-catalog/contracts'

/**
 * OPT-035 首页「按类型浏览」图卡（五等分 1fr×300 · 图高 168）。
 *
 * 沿用旧 CategoryTiles 的 TILES 数据（含 data-event-name），改渲染为带封面的图卡；
 * 封面与计数来自 typeSummaries（key 为 listingType）。创意园区无 listingType，
 * 封面与计数行都省略——不编造数据。
 */
const TILES = [
  { no: '01', label: '传统办公', sublabel: '独立空间 · 灵活面积', href: '/listings?type=traditional-office', type: 'traditional-office', event: 'home_cat_traditional' },
  { no: '02', label: '联合办公', sublabel: '工位起 · 共享配套', href: '/listings?type=coworking', type: 'coworking', event: 'home_cat_coworking' },
  { no: '03', label: '整层办公', sublabel: '整层起租 · 定制形象', href: '/listings?type=full-floor', type: 'full-floor', event: 'home_cat_full_floor' },
  { no: '04', label: '独栋办公', sublabel: '企业独栋 · 专属形象', href: '/listings?type=serviced-office', type: 'serviced-office', event: 'home_cat_standalone' },
  { no: '05', label: '创意园区', sublabel: '园区生态 · 低密度', href: '/buildings', type: null, event: 'home_cat_creative_park' },
] as const

export default function HomeTypeCards({ typeSummaries, citySlug }: Readonly<{
  typeSummaries: Readonly<Record<string, HomepageTypeSummary>>
  citySlug?: string
}>) {
  const prefix = citySlug ? `/${citySlug}` : ''
  return (
    <section className="hm-section" aria-labelledby="hm-types-title">
      <div className="hm-container">
        <div className="hm-section-head">
          <h2 className="hm-h2" id="hm-types-title">按类型浏览</h2>
          <Link href={`${prefix}/listings`} prefetch={false} className="hm-section-link" data-event-name="home_cat_view_all">查看全部房源 →</Link>
        </div>
        <ul className="hm-types" role="list">
          {TILES.map((t) => {
            const summary = t.type ? typeSummaries[t.type] : undefined
            return (
              <li key={t.no}>
                <Link href={`${prefix}${t.href}`} prefetch={false} className="sf-card hm-type-card" data-event-name={t.event}>
                  <span className="sf-media hm-type-card__media">
                    {summary?.cover ? <img src={summary.cover.src} alt="" loading="lazy" decoding="async" /> : null}
                    <span className="sf-scrim" aria-hidden="true" />
                    <span className="hm-type-card__no sf-num">{t.no}</span>
                  </span>
                  <span className="hm-type-card__body">
                    <span className="hm-type-card__name">{t.label}</span>
                    <span className="hm-type-card__sub">{t.sublabel}</span>
                    {summary && summary.count > 0
                      ? <span className="hm-type-card__count sf-num">{summary.count.toLocaleString('en-US')} 套在租</span>
                      : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
