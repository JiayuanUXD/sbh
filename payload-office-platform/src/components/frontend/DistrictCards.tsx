import Link from 'next/link'
import React from 'react'
import type { DistrictCardViewModel } from '@/domain/public-catalog'

/**
 * 首页「热门商圈」拼贴卡：1 大 + N 小
 *
 * 数据源是商圈（Locations 第三层），不是行政区——两者是包含关系，
 * 一个行政区下有多个商圈。
 *
 * 设计依据：plans/temporal-imagining-sonnet.md §9（商圈入口，soolou IA + 本站 token）
 * 守护不变量：
 *   - 只消费 DistrictCardViewModel DTO（区域 + 代表楼盘封面）；
 *   - 封面缺失时降级为纸色底卡片，不渲染破碎图；
 *   - 卡片整体可点击，链接到 /listings?businessArea=<slug>；
 *   - 商圈名下列出代表楼盘名（最多 4 个），楼盘不足时按实有数量渲染；
 *   - 只用设计 token；移动端折叠为单列。
 *
 * 布局：首张为大卡（跨 2 列 2 行），其余为小卡；<4 个时仍稳定。
 */
type Props = Readonly<{
  districts: readonly DistrictCardViewModel[]
}>

export default function DistrictCards({ districts }: Props) {
  if (districts.length === 0) return null
  const [first, ...rest] = districts

  return (
    <section className="section district-section" aria-labelledby="district-title">
      <div className="section__header">
        <h2 className="section__title" id="district-title">热门商圈</h2>
        <Link href="/listings" prefetch={false} className="text-copper" data-event-name="home_district_view_all">全部商圈 →</Link>
      </div>
      <div className="district-cards">
        <DistrictCard district={first} variant="lg" />
        {rest.map((d) => (
          <DistrictCard key={d.id} district={d} variant="sm" />
        ))}
      </div>
    </section>
  )
}

function DistrictCard({
  district,
  variant,
}: Readonly<{ district: DistrictCardViewModel; variant: 'lg' | 'sm' }>) {
  const cover = district.coverImage
  return (
    <Link
      href={`/listings?businessArea=${district.slug}`}
      prefetch={false}
      className={`district-card district-card--${variant}`}
      data-event-name="home_district_card_click"
      data-business-area={district.slug}
    >
      {cover ? (
        <img
          src={cover.src}
          alt={cover.alt?.trim() || `${district.name} 商圈`}
          loading="lazy"
          decoding="async"
          className="district-card__media"
        />
      ) : (
        <span className="district-card__placeholder" aria-hidden="true" />
      )}
      <span className="district-card__overlay" aria-hidden="true" />
      <span className="district-card__body">
        <span className="district-card__name">{district.name}</span>
        {district.buildings.length > 0 ? (
          <span className="district-card__buildings">
            {district.buildings.join(' ｜ ')}
          </span>
        ) : (
          <span className="district-card__cta">查看房源 →</span>
        )}
      </span>
    </Link>
  )
}
