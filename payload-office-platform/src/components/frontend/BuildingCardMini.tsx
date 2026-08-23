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
      // `prefetch={false}`：关停判据①高基数 ②内容驱动 ③常驻渲染**三条并列成立**
      // （表述见 `ui/Breadcrumb.tsx`）。①按域层默认值裁定，不靠本地 fixture——
      // `getRelatedBuildings` 的 `normalizeRelatedBuildingLimit` 默认 6
      // （`domain/public-catalog/facade.ts`），即生产上 `#related` 网格一页最多
      // 6 条互不相同的楼盘 URL 同时进视口（本地 fixture 只有 1 条，量不出来，
      // 别拿它反推「基数不高」）；②href 由楼盘 slug 决定；③`hasRelated` 为真时
      // 是楼盘详情页正文的常驻区块。
      // 注意上限是 **6 不是 12**：本组件与 `building-detail/NearbyBuildingsStrip`
      // 读同一份数组、产出同一批 URL——按 URL 去重的机制见 `ui/Breadcrumb.tsx`
      // 判据①的精确表述（本组件正是那里记的第二个误判案例），此处不再复述。
      prefetch={false}
      // `sf-card` / `sf-media--16x10` 是全站表面基元（`styles/surface.css`），
      // 与列表页 `ListingResultCard` / `BuildingResultCard` 的用法一致。
      // 此前详情页在 `detail.css` 里把 `.sf-card` 的每一条声明（白底 / 零边框 /
      // radius 18 / shadow / 320ms hover 位移，连 reduced-motion 块）逐条复制了
      // 一份到 `.dt-page .building-card-mini`——`.sf-card` 的 hover 位移已经从
      // 6px 调到 2px 过一次，那份副本迟早会静默分叉。改成直接挂类名。
      className="sf-card building-card-mini"
      data-detail-analytics-event="related_building_click"
      data-analytics-parent-id={parentId}
      data-analytics-building-id={building.id}
      data-analytics-rank={rank}
      data-analytics-section="related"
      data-analytics-recommendation-type="similar_building"
    >
      <div className="sf-media sf-media--16x10 building-card-mini__media">
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
