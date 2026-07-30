'use client'

import type { DetailMediaViewModel } from '@/domain/public-catalog'
import { normalizePublicMediaUrl } from '@/domain/public-catalog'
import { track } from '@/lib/frontend/analytics'

type DetailGalleryProps = Readonly<{
  media: readonly DetailMediaViewModel[]
  title: string
  /** The containing detail route; used only as an analytics enum. */
  pageType?: 'listing' | 'building'
}>

function hasRenderableResource(item: DetailMediaViewModel): boolean {
  return normalizePublicMediaUrl(item.resource?.src) !== null
}

/** Public-detail media gallery with native image/video semantics. */
export default function DetailGallery({ media, title, pageType }: DetailGalleryProps) {
  const renderableMedia = media.filter(hasRenderableResource)

  if (renderableMedia.length === 0) {
    return (
      <div className="detail-gallery detail-gallery--empty" role="img" aria-label={`${title} 暂无可展示媒体`}>
        暂无可展示媒体
      </div>
    )
  }

  return (
    <section className="detail-gallery" aria-label={`${title} 图片与视频`}>
      {renderableMedia.map((item, index) => {
        const src = normalizePublicMediaUrl(item.resource.src)
        if (!src) return null
        const alt = item.resource.alt?.trim() || `${title} ${item.category}`
        return (
          <figure
            key={item.id}
            className="detail-gallery__item"
            data-media-kind={item.kind}
            data-detail-analytics-event={pageType ? 'media_view' : undefined}
            data-analytics-page-type={pageType}
            data-analytics-media-category={pageType ? item.category : undefined}
            data-analytics-rank={pageType ? index + 1 : undefined}
            onClick={pageType ? () => track('media_view', {
              page_type: pageType,
              media_category: item.category,
              rank: index + 1,
            }) : undefined}
          >
            {item.kind === 'video' ? (
              <video controls preload="metadata" aria-label={alt}>
                <source src={src} />
                抱歉，你的浏览器不支持视频播放。
              </video>
            ) : (
              <img src={src} alt={alt} loading="lazy" />
            )}
            <figcaption>{item.category}</figcaption>
          </figure>
        )
      })}
    </section>
  )
}
