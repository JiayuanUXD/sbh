import React from 'react'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog'

/**
 * 58 式位置区下方「周边楼盘」横滑条带。
 *
 * 这里刻意用**原生 `<a>` 而不是 `next/link`**，所以它**根本不产生 RSC 自动预取**，
 * `prefetch={false}` 这个 prop 在这里无处可加、也无需加（OPT-037 Task 11d 实测确认：
 * 本组件渲染的 URL 之所以出现在预取集合里，是同页 `BuildingCardMini` 贡献的——
 * 两者读同一份 `visibleRelatedBuildings`，产出**同一批 URL**，被 Next 路由缓存按 URL
 * 去重）。若日后有人把它改成 `<Link>`，请连带按 `BuildingCardMini` 的判据补
 * `prefetch={false}`，否则同一批楼盘 URL 的预取会从那边悄悄漏回来。
 */
type NearbyBuildingsStripProps = Readonly<{
  buildings: readonly BuildingSummaryViewModel[]
  citySlug?: string
}>

export default function NearbyBuildingsStrip({ buildings, citySlug }: NearbyBuildingsStripProps) {
  if (buildings.length === 0) return null

  return (
    <div className="nearby-strip-wrap">
      <h3 className="nearby-strip-wrap__title">周边楼盘</h3>
      <ul className="nearby-strip" aria-label="周边楼盘">
        {buildings.map((item) => {
          const gradeLabel = getBuildingGradeLabel(item.grade)
          return (
            <li key={item.id} className="nearby-strip__item">
              <a className="nearby-strip__card" href={`${citySlug ? `/${citySlug}` : ''}/buildings/${encodeURIComponent(item.slug)}`}>
                {item.coverImage ? (
                  <img src={item.coverImage.src} alt={item.coverImage.alt ?? item.name} loading="lazy" />
                ) : (
                  <span className="nearby-strip__placeholder" aria-hidden="true" />
                )}
                <span className="nearby-strip__name">{item.name}</span>
                <span className="nearby-strip__meta">
                  {item.district?.name ?? ''}
                  {gradeLabel ? ` · ${gradeLabel}` : ''}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
