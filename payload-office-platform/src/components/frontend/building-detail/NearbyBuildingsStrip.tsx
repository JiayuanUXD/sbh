import React from 'react'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog'

/**
 * 58 式位置区下方「周边楼盘」横滑条带。
 */
type NearbyBuildingsStripProps = Readonly<{
  buildings: readonly BuildingSummaryViewModel[]
}>

export default function NearbyBuildingsStrip({ buildings }: NearbyBuildingsStripProps) {
  if (buildings.length === 0) return null

  return (
    <div className="nearby-strip-wrap">
      <h3 className="nearby-strip-wrap__title">周边楼盘</h3>
      <ul className="nearby-strip" aria-label="周边楼盘">
        {buildings.map((item) => {
          const gradeLabel = getBuildingGradeLabel(item.grade)
          return (
            <li key={item.id} className="nearby-strip__item">
              <a className="nearby-strip__card" href={`/buildings/${item.slug}`}>
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
