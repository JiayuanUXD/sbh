import React from 'react'
import AdvisorCard from '@/components/frontend/AdvisorCard'
import InquiryModal from '@/components/frontend/InquiryModal'
import { rentUnitLabel } from '@/lib/frontend/format'
import {
  aggregateAreaRange,
  DISPLAY_UNIT_LABELS,
  findLowestPrice,
  formatAreaRange,
} from './supply-summary'
import type {
  BuildingDetailViewModel,
  BuildingSupplySnapshot,
} from '@/domain/public-catalog'
import type { ServiceSchedule } from '@/domain/advisor-availability'

/**
 * 58 式 Hero 右侧决策面板：起价大字 + 免责声明 + 面积/套数双统计 +
 * 关键参数行 + 顾问 CTA。参数行从 factGroups 按标签优先抽取，
 * 真实数据缺字段时静默省略。
 */

const HERO_FACT_LABELS = ['建筑面积', '竣工时间', '物业公司', '物业费', '层高', '总楼层'] as const
const MAX_HERO_FACTS = 5

type HeroSummaryPanelProps = Readonly<{
  building: BuildingDetailViewModel
  supply: BuildingSupplySnapshot
  serviceSchedule?: ServiceSchedule
}>

function pickHeroFacts(building: BuildingDetailViewModel): { label: string; value: string }[] {
  const allFacts = building.factGroups.flatMap((group) => group.facts)
  const picked: { label: string; value: string }[] = []
  for (const wanted of HERO_FACT_LABELS) {
    if (picked.length >= MAX_HERO_FACTS) break
    const fact = allFacts.find((item) => item.label.includes(wanted))
    if (fact && fact.value && !picked.some((item) => item.label === fact.label)) {
      picked.push({ label: fact.label, value: fact.value })
    }
  }
  return picked
}

export default function HeroSummaryPanel({
  building,
  supply,
  serviceSchedule,
}: HeroSummaryPanelProps) {
  const lowest = findLowestPrice(supply.availableGroups)
  const areaRange = aggregateAreaRange(supply.availableGroups)
  const hasSupply = supply.totalEffectiveListings > 0
  const heroFacts = pickHeroFacts(building)

  return (
    <aside className="hero-summary" aria-label="楼盘决策信息">
      <p className="hero-summary__price-row">
        {lowest ? (
          <>
            <span className="hero-summary__price">{lowest.min}</span>
            <span className="hero-summary__price-unit">
              {rentUnitLabel(lowest.displayUnit) || DISPLAY_UNIT_LABELS[lowest.displayUnit]} 起
            </span>
          </>
        ) : (
          <span className="hero-summary__price hero-summary__price--na">价格面议</span>
        )}
      </p>
      <p className="hero-summary__disclaimer">页面价格为公开挂牌价，实际价格以顾问报价为准</p>

      <div className="hero-summary__stats">
        <div className="hero-summary__stat">
          <strong>{areaRange ? formatAreaRange(areaRange) : '—'}</strong>
          <span>可租面积</span>
        </div>
        <div className="hero-summary__stat">
          <strong>{supply.totalEffectiveListings} 套</strong>
          <span>当前有效供给</span>
        </div>
      </div>

      <dl className="hero-summary__facts">
        {building.address && (
          <div>
            <dt>地址</dt>
            <dd>{building.address}</dd>
          </div>
        )}
        {building.nearestMetro && (
          <div>
            <dt>地铁</dt>
            <dd>{building.nearestMetro.name}</dd>
          </div>
        )}
        {heroFacts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>

      <AdvisorCard
        cta={
          <InquiryModal
            pageType="building"
            targetBuildingSlug={building.slug}
            targetSummary={building.name}
            triggerLabel={hasSupply ? '询价 / 预约看房' : '登记找房需求'}
            sourceSection="hero"
            serviceSchedule={serviceSchedule}
          />
        }
      />
    </aside>
  )
}
