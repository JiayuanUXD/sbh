import React from 'react'
import ListingCard from '@/components/frontend/ListingCard'
import RecommendationReason from '@/components/frontend/RecommendationReason'
import { Skeleton } from '@/components/frontend/ui/States'
import type { getCachedDetailRecommendations } from '@/lib/frontend/cached-queries'

type Recommendations = Awaited<ReturnType<typeof getCachedDetailRecommendations>>

/**
 * 详情页「相关推荐」区（OPT-068）。
 *
 * 独立成异步 Server Component 是为了让它能被 `<Suspense>` 包住：路由层拿到推荐
 * 的 **Promise** 就直接渲染，不 await——首屏（画廊 / 价格 / 概况）先出，推荐算完
 * 再流式补上。线上实测详情页冷开 2.8–4.1 秒，其中推荐候选查询是主要一段。
 *
 * 零条推荐时返回 `null`：整段 section 连同标题都不渲染，与改造前
 * `recommendations.length > 0 && (...)` 的行为一致（骨架此时已被替换掉，不会残留）。
 */
export default async function RelatedListings({
  recommendations,
  listingId,
  citySlug,
}: Readonly<{
  recommendations: Promise<Recommendations> | Recommendations
  listingId: number
  citySlug?: string
}>) {
  const items = await recommendations
  if (items.length === 0) return null
  return (
    <section id="related" className="dt-container dt-section">
      <h2 className="dt-h2">相关推荐</h2>
      <div className="card-grid">
        {items.map((rec, index) => (
          <div key={rec.card.id} className="recommendation-card-wrapper">
            <ListingCard listing={rec.card} citySlug={citySlug} detailAnalytics={{ event: 'recommendation_click',
              parentId: listingId, rank: index + 1, section: 'related', recommendationType: 'contextual' }} />
            <RecommendationReason reasonCodes={rec.reasonCodes} />
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * 推荐区骨架：占位高度与真实卡片一致，避免推荐补上时把下方内容顶走（CLS）。
 *
 * `aria-hidden` + 无文案：屏幕阅读器不该念一屏占位块；真实内容到达后
 * `<section id="related">` 才带着标题出现。
 */
export function RelatedListingsSkeleton() {
  return (
    <section className="dt-container dt-section" aria-hidden="true">
      <Skeleton width="120px" height="28px" />
      <div className="card-grid" style={{ marginTop: 16 }}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height="260px" radius="var(--r-card)" />
        ))}
      </div>
    </section>
  )
}
