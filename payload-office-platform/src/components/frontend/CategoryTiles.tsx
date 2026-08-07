import Link from 'next/link'
import React from 'react'

/**
 * 首页「按类型浏览」分类瓷砖
 *
 * 设计依据：plans/temporal-imagining-sonnet.md §9（IA：类型入口）
 * 守护不变量：
 *   - 纯静态、服务端组件，不触发数据查询（计数本期不展示，避免全量聚合）；
 *   - 链接对齐既有路由：房源类型走 /listings?type=<listingType>，
 *     创意园区走 /buildings（buildings 页暂不支持 grade 深链，故仅入浏览页）；
 *   - 只用设计 token，不引入新色值；触控目标 ≥44px。
 */
type CategoryTile = Readonly<{
  /** 数字编号（numeric 字体，编辑式序号） */
  no: string
  label: string
  sublabel: string
  href: string
  /** 埋点事件名 */
  event: string
}>

const TILES: readonly CategoryTile[] = [
  { no: '01', label: '传统办公', sublabel: '独立空间 · 灵活面积', href: '/listings?type=traditional-office', event: 'home_cat_traditional' },
  { no: '02', label: '服务式办公', sublabel: '全配齐 · 即租即用', href: '/listings?type=serviced-office', event: 'home_cat_serviced' },
  { no: '03', label: '联合办公', sublabel: '工位起 · 共享配套', href: '/listings?type=coworking', event: 'home_cat_coworking' },
  { no: '04', label: '整层办公', sublabel: '整层起租 · 定制形象', href: '/listings?type=full-floor', event: 'home_cat_full_floor' },
  { no: '05', label: '创意园区', sublabel: '园区生态 · 低密度', href: '/buildings', event: 'home_cat_creative_park' },
]

export default function CategoryTiles() {
  return (
    <section className="section cat-tiles-section" aria-labelledby="cat-tiles-title">
      <div className="section__header">
        <h2 className="section__title" id="cat-tiles-title">按类型浏览</h2>
        <Link href="/listings" prefetch={false} className="text-copper" data-event-name="home_cat_view_all">查看全部房源 →</Link>
      </div>
      <ul className="cat-tiles" role="list">
        {TILES.map((t) => (
          <li key={t.no} className="cat-tiles__item">
            <Link
              href={t.href}
              prefetch={t.href.startsWith('/listings') ? false : undefined}
              className="cat-tile"
              data-event-name={t.event}
            >
              <span className="cat-tile__no">{t.no}</span>
              <span className="cat-tile__label">{t.label}</span>
              <span className="cat-tile__sublabel">{t.sublabel}</span>
              <span className="cat-tile__arrow" aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
