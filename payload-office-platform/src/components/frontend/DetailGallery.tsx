'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DetailMediaViewModel } from '@/domain/public-catalog/contracts'
import { normalizePublicMediaUrl } from '@/domain/public-catalog/media-url'
import { track } from '@/lib/frontend/analytics'
import DetailVideo from './DetailVideo'

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

type MediaKind = 'image' | 'floor-plan' | 'video'

const TAB_ORDER: ReadonlyArray<{ kind: MediaKind; label: string }> = [
  { kind: 'image', label: '图片' },
  { kind: 'video', label: '视频' },
  { kind: 'floor-plan', label: '平面图' },
]

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
 * Public-detail gallery with classified tabs, failure placeholders and an
 * accessible fullscreen viewer. Videos are lazily mounted only after the user
 * switches to the 视频 tab (DetailVideo uses preload="none", no autoplay),
 * keeping third-party media off the first-paint critical path.
 */
export default function DetailGallery({ media, title, pageType }: DetailGalleryProps) {
  const renderableMedia = useMemo(
    () => media.flatMap((item) => {
      const renderable = toRenderableMedia(item, title)
      return renderable ? [renderable] : []
    }),
    [media, title],
  )

  const grouped = useMemo(() => {
    const byKind: Record<MediaKind, RenderableMedia[]> = {
      image: [],
      video: [],
      'floor-plan': [],
    }
    for (const renderable of renderableMedia) {
      const kind = renderable.item.kind as MediaKind
      byKind[kind]?.push(renderable)
    }
    return byKind
  }, [renderableMedia])

  const tabs = useMemo(
    () => TAB_ORDER.filter((tab) => grouped[tab.kind].length > 0),
    [grouped],
  )

  const [activeKind, setActiveKind] = useState<MediaKind>(tabs[0]?.kind ?? 'image')
  const [activeIndex, setActiveIndex] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [failedMediaIds, setFailedMediaIds] = useState<ReadonlySet<string>>(() => new Set())
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const dialogTitleId = useId()

  const currentList = grouped[activeKind]
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, currentList.length - 1))
  const activeMedia = currentList[safeActiveIndex]

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
    if (currentList.length === 0) return
    setActiveIndex((nextIndex + currentList.length) % currentList.length)
  }, [currentList.length])

  const open = useCallback((index: number, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger
    setActiveIndex(index)
    setIsOpen(true)
    const current = currentList[index]
    if (pageType && current) {
      track('media_view', {
        page_type: pageType,
        media_category: current.item.category,
        rank: index + 1,
      })
    }
  }, [pageType, currentList])

  const selectTab = useCallback((kind: MediaKind) => {
    setActiveKind(kind)
    setActiveIndex(0)
  }, [])

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
      // 左右键只在图片分类生效（视频/平面图不参与翻页）
      if (activeKind === 'image') {
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
      }
      if (event.key !== 'Tab') return
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, audio[controls], video[controls], [tabindex]:not([tabindex="-1"])',
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
  }, [close, goTo, isOpen, safeActiveIndex, activeKind])

  if (renderableMedia.length === 0) {
    return (
      <div className="detail-gallery detail-gallery--empty" role="img" aria-label={`${title} 暂无可展示媒体`}>
        暂无可展示媒体
      </div>
    )
  }

  return (
    <section className="detail-gallery" aria-label={`${title} 详情媒体`}>
      {tabs.length > 1 && (
        <div className="detail-gallery__tabs" role="tablist" aria-label={`${title} 媒体分类`}>
          {tabs.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              className="detail-gallery__tab"
              aria-selected={activeKind === tab.kind}
              data-active={activeKind === tab.kind || undefined}
              onClick={() => selectTab(tab.kind)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className="detail-gallery__panel" role="tabpanel">
        {currentList.map((renderable, index) => {
          const { item, src, alt } = renderable
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
                    <DetailVideo src={src} alt={alt} />
                  )}
                  <button
                    type="button"
                    className="detail-gallery__open detail-gallery__open--video"
                    aria-label={`查看全屏媒体：${alt}（第 ${index + 1} 个，共 ${currentList.length} 个）`}
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
                  aria-label={`查看全屏媒体：${alt}（第 ${index + 1} 个，共 ${currentList.length} 个）`}
                  aria-describedby={captionId}
                  aria-haspopup="dialog"
                  onClick={(event) => open(index, event.currentTarget)}
                >
                  {hasFailed ? <MediaFallback /> : <img src={src} alt={alt} loading={index === 0 ? 'eager' : 'lazy'} onError={() => markFailed(item.id)} />}
                </button>
              )}
              <figcaption id={captionId}>
                {item.category}
                {item.kind === 'floor-plan' && item.isSchematic && (
                  <span className="detail-gallery__schematic-note">示意图，以现场实际情况为准</span>
                )}
              </figcaption>
            </figure>
          )
        })}
        {activeKind === 'floor-plan' && (
          <p className="detail-gallery__schematic-declaration" role="note">
            示意图，以现场实际情况为准
          </p>
        )}
      </div>

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
          {activeKind === 'image' && currentList.length > 1 && (
            <>
              <button type="button" className="detail-gallery__nav detail-gallery__nav--previous" aria-label="上一张媒体" onClick={() => goTo(safeActiveIndex - 1)}>‹</button>
              <button type="button" className="detail-gallery__nav detail-gallery__nav--next" aria-label="下一张媒体" onClick={() => goTo(safeActiveIndex + 1)}>›</button>
            </>
          )}
          <div className="detail-gallery__dialog-content">
            {failedMediaIds.has(activeMedia.item.id) ? <MediaFallback /> : activeMedia.item.kind === 'video' ? (
              <video controls preload="none" aria-label={activeMedia.alt} onError={() => markFailed(activeMedia.item.id)}>
                <source src={activeMedia.src} />
                抱歉，你的浏览器不支持视频播放。
              </video>
            ) : (
              <img src={activeMedia.src} alt={activeMedia.alt} onError={() => markFailed(activeMedia.item.id)} />
            )}
            <p className="detail-gallery__dialog-caption">{activeMedia.alt}</p>
            <p className="detail-gallery__counter" role="status" aria-live="polite">第 {safeActiveIndex + 1} 个，共 {currentList.length} 个 · {activeMedia.item.category}</p>
          </div>
        </div>
      )}
    </section>
  )
}

function MediaFallback() {
  return <span className="detail-gallery__fallback" role="img" aria-label="媒体加载失败">媒体加载失败</span>
}
