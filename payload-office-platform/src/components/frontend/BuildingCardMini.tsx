import Link from 'next/link'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog'
import { normalizePublicMediaUrl } from '@/domain/public-catalog/media-url'

/**
 * 相关楼盘紧凑卡片
 *
 * 设计依据：评审 P2-B。楼盘详情页「相关楼盘」从纯文字列表升级为卡片网格，
 * 对标房源页「相关推荐」的 ListingCard 网格密度。整卡可点击跳转。
 *
 * 守护不变量：
 *   - 服务端组件，纯展示
 *   - 封面缺失时降级为无图占位卡片
 *   - 整卡作为链接，保留原有的匿名点击埋点
 */
type BuildingCardMiniProps = Readonly<{
  building: BuildingSummaryViewModel
  /** 父楼盘 ID，仅用于匿名点击埋点 */
  parentId?: number
  rank?: number
  citySlug?: string
}>

export default function BuildingCardMini({ building, parentId, rank, citySlug }: BuildingCardMiniProps) {
  const coverSrc = building.coverImage ? normalizePublicMediaUrl(building.coverImage.src) : null

  return (
    <Link
      href={`${citySlug ? `/${citySlug}` : ''}/buildings/${encodeURIComponent(building.slug)}`}
      className="building-card-mini"
      data-detail-analytics-event="related_building_click"
      data-analytics-parent-id={parentId}
      data-analytics-building-id={building.id}
      data-analytics-rank={rank}
      data-analytics-section="related"
      data-analytics-recommendation-type="similar_building"
    >
      <div className="building-card-mini__media">
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={building.coverImage?.alt?.trim() || `${building.name} 封面`}
            loading="lazy"
          />
        ) : (
          <span className="building-card-mini__placeholder" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6" />
            </svg>
          </span>
        )}
      </div>
      <div className="building-card-mini__body">
        <h3 className="building-card-mini__name">{building.name}</h3>
        {building.district && (
          <span className="building-card-mini__district">{building.district.name}</span>
        )}
        {building.address && (
          <p className="building-card-mini__address">{building.address}</p>
        )}
      </div>
    </Link>
  )
}
