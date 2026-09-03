import React from 'react'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog'
import { CardMediaPlaceholder } from '@/components/frontend/ui/Media'

/**
 * 58 式位置区下方「周边楼盘」横滑条带。
 *
 * 这里刻意用**原生 `<a>` 而不是 `next/link`**，所以它**根本不产生 RSC 自动预取**，
 * `prefetch={false}` 这个 prop 在这里无处可加、也无需加（OPT-037 Task 11d 实测确认：
 * 本组件渲染的 URL 之所以出现在预取集合里，是同页 `BuildingCardMini` 贡献的——
 * 两者读同一份 `visibleRelatedBuildings`，产出**同一批 URL**；按 URL 去重的机制
 * 见 `ui/Breadcrumb.tsx` 判据①的精确表述，此处不再复述）。
 * 若日后有人把它改成 `<Link>`，请连带按 `BuildingCardMini` 的判据补
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
              {/* 与同页 BuildingCardMini 读同一份 visibleRelatedBuildings，改动前却是
                  两种完全不同的外观：那边已收敛到 .sf-card，这边没有卡片表面、
                  hover 只让楼名瞬间变色（连 transition 都没有）。现在同样走共享基元。
                  等级从文本拼接 ` · 甲级` 改为图上 .sf-phototag，与列表页楼盘卡一致。 */}
              <a className="sf-card nearby-strip__card" href={`${citySlug ? `/${citySlug}` : ''}/buildings/${encodeURIComponent(item.slug)}`}>
                <span className="sf-media sf-media--16x10">
                  {item.coverImage ? (
                    <img src={item.coverImage.src} alt={item.coverImage.alt ?? item.name} loading="lazy" />
                  ) : (
                    <CardMediaPlaceholder compact />
                  )}
                  <span className="sf-scrim" aria-hidden="true" />
                  {gradeLabel ? <span className="sf-phototag nearby-strip__grade">{gradeLabel}</span> : null}
                </span>
                <span className="nearby-strip__body">
                  <span className="nearby-strip__name">{item.name}</span>
                  <span className="nearby-strip__meta">{item.district?.name ?? ''}</span>
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
