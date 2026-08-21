import React from 'react'
import AdvisorCard from '@/components/frontend/AdvisorCard'
import InquiryModal from '@/components/frontend/InquiryModal'
import { rentUnitLabel } from '@/lib/frontend/format'
import { DISPLAY_UNIT_LABELS, findLowestPrice } from './supply-summary'
import type {
  BuildingDetailViewModel,
  BuildingSupplySnapshot,
} from '@/domain/public-catalog'
import type { ServiceSchedule } from '@/domain/advisor-availability'

/**
 * 在租房源区下方的「咨询 / 需求登记」卡片带：迷你摘要 + 免费咨询 + 需求登记。
 *
 * OPT-037 Task 11 摘除了原本的第四张卡「热门楼盘」：它与本页 `#related`
 * 「同商圈楼盘」、`NearbyBuildingsStrip`「周边楼盘」读的是同一份
 * `relatedBuildings`，Task 10 在 `test0814` 实测到**同一个楼盘在一页里出现
 * 三次**。三处里这一处信息量最小（64×44 缩略图 + 楼盘名 + 行政区），删它
 * 消除三重重复而不丢任何一个产品面。随之不再需要 `relatedBuildings` /
 * `citySlug` 两个入参——本组件已不产出任何跨楼盘链接。
 */
type DetailSideRailProps = Readonly<{
  building: BuildingDetailViewModel
  supply: BuildingSupplySnapshot
  serviceSchedule?: ServiceSchedule
}>

export default function DetailSideRail({
  building,
  supply,
  serviceSchedule,
}: DetailSideRailProps) {
  const lowest = findLowestPrice(supply.availableGroups)

  return (
    <aside className="detail-side-rail" aria-label="咨询与需求登记">
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
    </aside>
  )
}
