import React from 'react'
import AdvisorCard from '@/components/frontend/AdvisorCard'
import InquiryModal from '@/components/frontend/InquiryModal'
import { rentUnitLabel } from '@/lib/frontend/format'
import { DISPLAY_UNIT_LABELS, findLowestPrice } from './supply-summary'
import type {
  BuildingDetailViewModel,
  BuildingSummaryViewModel,
  BuildingSupplySnapshot,
} from '@/domain/public-catalog'
import type { ServiceSchedule } from '@/domain/advisor-availability'

/**
 * 58 式房源区右粘性栏：迷你摘要 + 免费咨询 + 需求登记 + 热门楼盘。
 */
type DetailSideRailProps = Readonly<{
  building: BuildingDetailViewModel
  supply: BuildingSupplySnapshot
  relatedBuildings: readonly BuildingSummaryViewModel[]
  serviceSchedule?: ServiceSchedule
  citySlug?: string
}>

export default function DetailSideRail({
  building,
  supply,
  relatedBuildings,
  serviceSchedule,
  citySlug,
}: DetailSideRailProps) {
  const lowest = findLowestPrice(supply.availableGroups)
  const popular = relatedBuildings.filter((item) => item.id !== building.id).slice(0, 3)

  return (
    <aside className="detail-side-rail" aria-label="咨询与推荐">
      <section className="detail-side-rail__card">
        <h3>{building.name}</h3>
        {lowest && (
          <p className="detail-side-rail__price">
            {lowest.min}
            <span>
              {' '}
              {rentUnitLabel(lowest.displayUnit) || DISPLAY_UNIT_LABELS[lowest.displayUnit]} 起
            </span>
          </p>
        )}
        <p className="detail-side-rail__muted">
          {supply.totalEffectiveListings > 0
            ? `${supply.totalEffectiveListings} 套当前有效供给`
            : '暂无公开供给，可登记需求'}
        </p>
      </section>

      <section className="detail-side-rail__card">
        <h3>免费咨询</h3>
        <AdvisorCard
          cta={
            <InquiryModal
              pageType="building"
              targetBuildingSlug={building.slug}
              targetSummary={building.name}
              triggerLabel="询价 / 预约看房"
              sourceSection="sticky-card"
              serviceSchedule={serviceSchedule}
            />
          }
        />
      </section>

      <section className="detail-side-rail__card">
        <h3>找房需求登记</h3>
        <p className="detail-side-rail__muted">留下需求，顾问按服务时段回电推荐匹配空间</p>
        <InquiryModal
          pageType="building"
          targetBuildingSlug={building.slug}
          targetSummary={building.name}
          triggerLabel="登记需求，顾问回电"
          sourceSection="sticky-card"
          serviceSchedule={serviceSchedule}
        />
      </section>

      {popular.length > 0 && (
        <section className="detail-side-rail__card">
          <h3>热门楼盘</h3>
          <ul className="detail-side-rail__popular">
            {popular.map((item) => (
              <li key={item.id}>
                <a href={`${citySlug ? `/${citySlug}` : ''}/buildings/${encodeURIComponent(item.slug)}`}>
                  {item.coverImage ? (
                    <img src={item.coverImage.src} alt={item.coverImage.alt ?? item.name} loading="lazy" />
                  ) : (
                    <span className="detail-side-rail__popular-placeholder" aria-hidden="true" />
                  )}
                  <span className="detail-side-rail__popular-body">
                    <span className="detail-side-rail__popular-name">{item.name}</span>
                    <span className="detail-side-rail__popular-meta">
                      {item.district?.name ?? ''}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
