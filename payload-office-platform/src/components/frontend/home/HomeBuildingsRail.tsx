import React from 'react'
import HorizontalRail from './HorizontalRail'
import HomeSupplyCard from './HomeSupplyCard'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'

/**
 * OPT-035 首页「热门楼盘」通栏横滑。
 *
 * 楼盘卡刻意无价格行——BuildingSummaryViewModel 没有起价数据，省略优于编造，
 * 这是与设计稿（`docs/SBH设计任务讨论/首页.dc.html`）的有意偏差。
 */
export default function HomeBuildingsRail({ buildings, citySlug, totalCount }: Readonly<{
  buildings: readonly BuildingSummaryViewModel[]
  citySlug?: string
  totalCount: number
}>) {
  if (buildings.length === 0) return null
  const prefix = citySlug ? `/${citySlug}` : ''
  return (
    <section className="hm-section" aria-labelledby="hm-buildings-title">
      <div className="hm-container hm-section-head">
        <h2 className="hm-h2" id="hm-buildings-title">热门楼盘</h2>
        <a className="hm-section-link" href={`${prefix}/buildings`} data-event-name="home_browse_all_buildings">
          全部 <span className="sf-num">{totalCount.toLocaleString('en-US')}</span> 个楼盘
        </a>
      </div>
      <HorizontalRail ariaLabel="热门楼盘">
        {buildings.map((b) => (
          <div className="hm-rail__item" role="listitem" key={b.slug}>
            <HomeSupplyCard
              // 楼盘卡 16:10（全站规则，见 HomeSupplyCard 的 ratio 注释）——
              // 这条 rail 是本组件三个消费方里唯一放楼盘的。
              ratio="16/10"
              href={`${prefix}/buildings/${b.slug}`}
              image={b.coverImage ?? null}
              photoTags={[
                ...(b.grade ? [{ text: getBuildingGradeLabel(b.grade) ?? '' }].filter((t) => t.text) : []),
                ...(b.leasableArea ? [{ text: `在租 ${Math.round(b.leasableArea).toLocaleString('en-US')} ㎡`, numeric: true }] : []),
              ]}
              title={b.name}
              whereLine={[b.district?.name, b.nearestMetro ? `近${b.nearestMetro.name}` : null].filter(Boolean).join(' · ') || null}
              metaLine={null}
              price={null}
            />
          </div>
        ))}
      </HorizontalRail>
    </section>
  )
}
