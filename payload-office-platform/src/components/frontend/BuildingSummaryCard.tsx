import type { ReactNode } from 'react'
import Link from 'next/link'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog'
import { normalizePublicMediaUrl } from '@/domain/public-catalog/media-url'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import { CardMediaPlaceholder } from '@/components/frontend/ui/Media'
import { cardCoverProps } from '@/lib/frontend/media-srcset'

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
  /** Prefixed city routes keep this cross-link inside their city boundary. */
  citySlug?: string
}>

export default function BuildingSummaryCard({ building, listingId, citySlug }: BuildingSummaryCardProps) {
  const cover = building.coverImage
    ? { ...building.coverImage, src: normalizePublicMediaUrl(building.coverImage.src) ?? '' }
    : null
  const coverSrc = cover && cover.src ? cover.src : null
  const gradeLabel = getBuildingGradeLabel(building.grade)

  return (
    <article className="building-summary-card">
      {/* 图片区恒渲染：无封面时给共享缺省占位，而不是整块消失。
          缺图时抽掉图片区会让同一个组件在两栋楼上呈现两种版式（左图右文 vs 纯文本），
          与本次「缺省图片用占位符表达」是同一条口径。 */}
      <div className="building-summary-card__media">
        {coverSrc ? (
          <img
            {...cardCoverProps(cover!, '(max-width: 767px) 100vw, 480px')}
            alt={building.coverImage?.alt?.trim() || `${building.name} 封面`}
            loading="lazy"
          />
        ) : (
          <CardMediaPlaceholder compact />
        )}
      </div>
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
        {/* CTA **保持默认预取（不加 `prefetch={false}`）**，判据同 `ui/Breadcrumb.tsx`：
            关停要求①高基数 ②内容驱动 ③常驻渲染**三条并列成立**，缺一不加。
            这里②③成立，**①不成立**——`BuildingSummaryCard` 全站唯一消费方是
            `city/CityListingDetailView.tsx`，一个房源详情页只渲染一张，
            **每页恰好产出 1 条楼盘 URL**，与面包屑末段同型——实测那 1 条还**就是**
            面包屑末段那个 URL（按 URL 去重的机制与本组件为何是它的头号误判案例，
            见 `ui/Breadcrumb.tsx` 判据①的精确表述，此处不再复述）。
            而「从房源退回所属楼盘」正是本站最高频的导航路径之一，给它加延迟换不来
            任何预取预算节省。
            （OPT-037 Task 11 一刀切加过，Task 11d 按此判据撤回。**不要「为了和列表页
            结果卡统一」再加回来**——统一的是判据，不是取值。） */}
        <Link
          href={`${citySlug ? `/${citySlug}` : ''}/buildings/${encodeURIComponent(building.slug)}`}
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
