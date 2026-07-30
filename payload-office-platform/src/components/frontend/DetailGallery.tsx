'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { DetailMediaViewModel } from '@/domain/public-catalog/contracts'
import { normalizePublicMediaUrl } from '@/domain/public-catalog/media-url'
import { track } from '@/lib/frontend/analytics'

type DetailGalleryProps = Readonly<{
  media: readonly DetailMediaViewModel[]
  title: string
  /** The containing detail route; used only as an analytics enum. */
  pageType?: 'listing' | 'building'
}>

type RenderableMedia = Readonly<{
  item: DetailMediaViewModel
  src: string
  alt: string
}>

function toRenderableMedia(item: DetailMediaViewModel, title: string): RenderableMedia | null {
  const src = normalizePublicMediaUrl(item.resource?.src)
  if (!src) return null
  return {
    item,
    src,
    alt: item.resource.alt?.trim() || `${title} ${item.category}`,
  }
}

/**
 * Public-detail gallery with failure placeholders and an accessible fullscreen
 * viewer. It consumes the already-sanitised public DTO, but defensively rejects
 * an invalid media URL before placing it in a browser media element.
 */
export default function DetailGallery({ media, title, pageType }: DetailGalleryProps) {
  const renderableMedia = media.flatMap((item) => {
    const renderable = toRenderableMedia(item, title)
    return renderable ? [renderable] : []
  })
  const [activeIndex, setActiveIndex] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [failedMediaIds, setFailedMediaIds] = useState<ReadonlySet<string>>(() => new Set())
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const dialogTitleId = useId()

  const safeActiveIndex = Math.min(activeIndex, Math.max(0, renderableMedia.length - 1))
  const activeMedia = renderableMedia[safeActiveIndex]

  const markFailed = useCallback((id: string) => {
    setFailedMediaIds((previous) => {
      if (previous.has(id)) return previous
      const next = new Set(previous)
      next.add(id)
      return next
    })
  }, [])

  const close = useCallback(() => {
    setIsOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const goTo = useCallback((nextIndex: number) => {
    if (renderableMedia.length === 0) return
    setActiveIndex((nextIndex + renderableMedia.length) % renderableMedia.length)
  }, [renderableMedia.length])

  const open = useCallback((index: number, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger
    setActiveIndex(index)
    setIsOpen(true)
    const current = renderableMedia[index]
    if (pageType && current) {
      track('media_view', {
        page_type: pageType,
        media_category: current.item.category,
        rank: index + 1,
      })
    }
  }, [pageType, renderableMedia])

  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    if (!dialog) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goTo(safeActiveIndex - 1)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goTo(safeActiveIndex + 1)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    window.requestAnimationFrame(() => closeRef.current?.focus())
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [close, goTo, isOpen, safeActiveIndex])

  if (renderableMedia.length === 0) {
    return (
      <div className="detail-gallery detail-gallery--empty" role="img" aria-label={`${title} 暂无可展示媒体`}>
        暂无可展示媒体
      </div>
    )
  }

  return (
    <section className="detail-gallery" aria-label={`${title} 图片与视频`}>
      {renderableMedia.map(({ item, src, alt }, index) => {
        const hasFailed = failedMediaIds.has(item.id)
        const captionId = `detail-gallery-caption-${item.id}`
        return (
          <figure
            key={item.id}
            className="detail-gallery__item"
            data-media-kind={item.kind}
            data-detail-analytics-event={pageType ? 'media_view' : undefined}
            data-analytics-page-type={pageType}
            data-analytics-media-category={pageType ? item.category : undefined}
            data-analytics-rank={pageType ? index + 1 : undefined}
          >
            {item.kind === 'video' ? (
              <>
                {hasFailed ? (
                  <MediaFallback />
                ) : (
                  <video controls muted preload="metadata" aria-label={alt} onError={() => markFailed(item.id)}>
                    <source src={src} />
                    抱歉，你的浏览器不支持视频播放。
                  </video>
                )}
                <button
                  type="button"
                  className="detail-gallery__open detail-gallery__open--video"
                  aria-label={`查看全屏媒体：${alt}（第 ${index + 1} 个，共 ${renderableMedia.length} 个）`}
                  aria-describedby={captionId}
                  aria-haspopup="dialog"
                  onClick={(event) => open(index, event.currentTarget)}
                >
                  全屏查看视频
                </button>
              </>
            ) : (
              <button
                type="button"
                className="detail-gallery__open"
                aria-label={`查看全屏媒体：${alt}（第 ${index + 1} 个，共 ${renderableMedia.length} 个）`}
                aria-describedby={captionId}
                aria-haspopup="dialog"
                onClick={(event) => open(index, event.currentTarget)}
              >
                {hasFailed ? <MediaFallback /> : <img src={src} alt={alt} loading={index === 0 ? 'eager' : 'lazy'} onError={() => markFailed(item.id)} />}
              </button>
            )}
            <figcaption id={captionId}>{item.category}</figcaption>
          </figure>
        )
      })}

      {isOpen && activeMedia && (
        <div
          ref={dialogRef}
          className="detail-gallery__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
        >
          <h2 id={dialogTitleId} className="visually-hidden">全屏媒体预览</h2>
          <button ref={closeRef} type="button" className="detail-gallery__close" aria-label="关闭全屏媒体预览" onClick={close}>×</button>
          {renderableMedia.length > 1 && (
            <>
              <button type="button" className="detail-gallery__nav detail-gallery__nav--previous" aria-label="上一张媒体" onClick={() => goTo(safeActiveIndex - 1)}>‹</button>
              <button type="button" className="detail-gallery__nav detail-gallery__nav--next" aria-label="下一张媒体" onClick={() => goTo(safeActiveIndex + 1)}>›</button>
            </>
          )}
          <div className="detail-gallery__dialog-content">
            {failedMediaIds.has(activeMedia.item.id) ? <MediaFallback /> : activeMedia.item.kind === 'video' ? (
              <video controls muted preload="metadata" aria-label={activeMedia.alt} onError={() => markFailed(activeMedia.item.id)}>
                <source src={activeMedia.src} />
                抱歉，你的浏览器不支持视频播放。
              </video>
            ) : (
              <img src={activeMedia.src} alt={activeMedia.alt} onError={() => markFailed(activeMedia.item.id)} />
            )}
            <p className="detail-gallery__dialog-caption">{activeMedia.alt}</p>
            <p className="detail-gallery__counter" role="status" aria-live="polite">第 {safeActiveIndex + 1} 个，共 {renderableMedia.length} 个 · {activeMedia.item.category}</p>
          </div>
        </div>
      )}
    </section>
  )
}

function MediaFallback() {
  return <span className="detail-gallery__fallback" role="img" aria-label="媒体加载失败">媒体加载失败</span>
}
