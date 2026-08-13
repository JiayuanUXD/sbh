import Link from 'next/link'
import React from 'react'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog'
import BuildingListCard from '@/components/frontend/BuildingListCard'

/**
 * 首页「精选楼盘」网格
 *
 * 设计依据：plans/temporal-imagining-sonnet.md §9、§13.2（featuredBuildings）
 * 守护不变量：
 *   - 只消费 BuildingSummaryViewModel DTO；
 *   - 复用 BuildingListCard（grid 视图）+ .card-grid，与找写字楼页视觉一致
 *     （用户约束：不能像两个网站）；
 *   - 空数据降级为 empty-state，不渲染空网格。
 */
type Props = Readonly<{
  buildings: readonly BuildingSummaryViewModel[]
  citySlug?: string
}>

export default function FeaturedBuildings({ buildings, citySlug }: Props) {
  const basePath = citySlug ? `/${citySlug}` : ''
  return (
    <section className="section" aria-labelledby="featured-buildings-title">
      <div className="section__header">
        <h2 className="section__title" id="featured-buildings-title">精选楼盘</h2>
        <Link href={`${basePath}/buildings`} className="text-copper" data-event-name="home_buildings_view_all">全部楼盘 →</Link>
      </div>
      {buildings.length === 0 ? (
        <p className="empty-state empty-state--inline">暂无精选楼盘。</p>
      ) : (
        <div className="card-grid">
          {buildings.map((b) => (
            <BuildingListCard key={b.id} building={b} view="grid" citySlug={citySlug} />
          ))}
        </div>
      )}
    </section>
  )
}
