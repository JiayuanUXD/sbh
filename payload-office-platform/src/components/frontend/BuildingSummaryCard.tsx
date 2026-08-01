import type { ReactNode } from 'react'
import Link from 'next/link'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog'
import { normalizePublicMediaUrl } from '@/domain/public-catalog/media-url'

/**
 * 房源详情页「所在楼盘」卡片
 *
 * 设计依据：评审 P1-A。把纯文本「楼盘名 · 地址 + 查看楼盘按钮」升级为含封面、
 * 等级徽章、区域、最近地铁的结构化卡片，对齐 58 商办详情页所在楼盘模块。
 *
 * 守护不变量：
 *   - 服务端组件，纯展示
 *   - 封面缺失时降级为无图卡片，不占位
 *   - 等级缺失时不渲染徽章
 *   - CTA 保留原有的匿名点击埋点
 */
type BuildingSummaryCardProps = Readonly<{
  building: BuildingSummaryViewModel
  /** 父房源 ID，仅用于匿名点击埋点 */
  listingId?: number
}>

const GRADE_LABEL: Readonly<Partial<Record<NonNullable<BuildingSummaryViewModel['grade']>, string>>> = {
  'grade-a': '甲级',
  'super-grade-a': '超甲级',
  'creative-park': '创意园区',
  'serviced-office': '服务式办公',
}

export default function BuildingSummaryCard({ building, listingId }: BuildingSummaryCardProps) {
  const coverSrc = building.coverImage ? normalizePublicMediaUrl(building.coverImage.src) : null
  const gradeLabel = building.grade ? GRADE_LABEL[building.grade] : undefined

  return (
    <article className="building-summary-card">
      {coverSrc && (
        <div className="building-summary-card__media">
          <img
            src={coverSrc}
            alt={building.coverImage?.alt?.trim() || `${building.name} 封面`}
            loading="lazy"
          />
        </div>
      )}
      <div className="building-summary-card__body">
        <div className="building-summary-card__header">
          <h3 className="building-summary-card__name">{building.name}</h3>
          {gradeLabel && (
            <span className="building-summary-card__grade" data-grade={building.grade}>
              {gradeLabel}
            </span>
          )}
        </div>
        {building.district && (
          <span className="building-summary-card__district">{building.district.name}</span>
        )}
        {building.address && (
          <p className="building-summary-card__address">{building.address}</p>
        )}
        {building.summary && (
          <p className="building-summary-card__summary">{building.summary}</p>
        )}
        {building.nearestMetro?.name && (
          <p className="building-summary-card__metro">
            <span className="building-summary-card__metro-label">最近地铁</span>
            <span className="building-summary-card__metro-value">{building.nearestMetro.name}</span>
          </p>
        )}
        <Link
          href={`/buildings/${building.slug}`}
          className="btn btn--ghost building-summary-card__cta"
          data-detail-analytics-event="listing_building_click"
          data-analytics-listing-id={listingId}
          data-analytics-building-id={building.id}
          data-analytics-section="building"
        >
          查看楼盘
        </Link>
      </div>
    </article>
  )
}
