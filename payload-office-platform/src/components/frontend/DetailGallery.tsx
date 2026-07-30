import type { DetailMediaViewModel } from '@/domain/public-catalog'

type DetailGalleryProps = Readonly<{
  media: readonly DetailMediaViewModel[]
  title: string
}>

function hasRenderableResource(item: DetailMediaViewModel): boolean {
  return typeof item.resource?.src === 'string' && item.resource.src.trim().length > 0
}

/** Public-detail media gallery with native image/video semantics. */
export default function DetailGallery({ media, title }: DetailGalleryProps) {
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
      {renderableMedia.map((item) => {
        const alt = item.resource.alt?.trim() || `${title} ${item.category}`
        return (
          <figure key={item.id} className="detail-gallery__item" data-media-kind={item.kind}>
            {item.kind === 'video' ? (
              <video controls preload="metadata" aria-label={alt}>
                <source src={item.resource.src} />
                抱歉，你的浏览器不支持视频播放。
              </video>
            ) : (
              <img src={item.resource.src} alt={alt} loading="lazy" />
            )}
            <figcaption>{item.category}</figcaption>
          </figure>
        )
      })}
    </section>
  )
}
