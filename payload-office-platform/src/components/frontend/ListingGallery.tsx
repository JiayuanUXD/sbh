'use client'
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'

/**
 * 房源图片画廊（F4.2）
 *
 * 设计依据：specs/frontend-mvp/design.md §6.5、§14.2
 *           Page PRD: FP-03 §3.1
 *
 * 守护不变量：
 *   - 响应式 16:10 主图 + 缩略图横滚（自动激活当前图）；
 *   - 全屏预览（lightbox）支持 Esc 关闭、左右键切换、Tab 焦点锁定；
 *   - 图片加载失败时显示占位 SVG（不破坏布局）；
 *   - 仅有 1 张图时不显示缩略图栏；
 *   - 主图点击触发全屏；缩略图 click/Enter/Space 切换；
 *   - 全屏模式禁止 body 滚动（overflow: hidden）。
 *
 * 可访问性：
 *   - 主图 button 带 aria-label；
 *   - 缩略图 button 带 aria-label + aria-pressed；
 *   - 全屏 dialog 用 role="dialog" + aria-modal + aria-label；
 *   - 焦点回到触发的缩略图按钮（focus restoration）；
 *   - 全屏左右切换按钮带 aria-label；
 *   - Esc 关闭全屏。
 */

type Image = {
  src: string
  alt?: string
  width?: number
  height?: number
}

type Props = { images: Image[] }

export default function ListingGallery({ images }: Props) {
  const [active, setActive] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [failed, setFailed] = useState<Set<number>>(() => new Set())
  const lightboxHeadingId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const lightboxCloseRef = useRef<HTMLButtonElement | null>(null)
  const lightboxRef = useRef<HTMLDivElement | null>(null)

  const safeActive = Math.min(active, Math.max(0, images.length - 1))
  const current = images[safeActive] ?? images[0]

  const goPrev = useCallback(() => {
    setActive((i) => (i - 1 + images.length) % images.length)
  }, [images.length])
  const goNext = useCallback(() => {
    setActive((i) => (i + 1) % images.length)
  }, [images.length])

  const openLightbox = useCallback(() => {
    setLightboxOpen(true)
  }, [])

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false)
    // 焦点归还触发按钮
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  // 全屏模式：Esc/←/→ 快捷键 + Tab 焦点锁定 + body 滚动锁
  useEffect(() => {
    if (!lightboxOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeLightbox()
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
        return
      }
      // Tab 焦点锁定：在 lightbox 内首尾循环，避免逃出到背景 DOM（WCAG 2.4.3）
      if (e.key === 'Tab' && lightboxRef.current) {
        const focusables = lightboxRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // 初始焦点到关闭按钮
    window.requestAnimationFrame(() => lightboxCloseRef.current?.focus())
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [lightboxOpen, closeLightbox, goPrev, goNext])

  if (!images.length) {
    return <div className="gallery__main gallery__empty">暂无图片</div>
  }

  const failedSet = failed
  const markFailed = (i: number) =>
    setFailed((prev) => {
      if (prev.has(i)) return prev
      const next = new Set(prev)
      next.add(i)
      return next
    })

  return (
    <div className="gallery">
      <button
        ref={triggerRef}
        type="button"
        className="gallery__main-btn"
        aria-label={`查看大图：${current?.alt ?? '房源图片'}（第 ${safeActive + 1} 张，共 ${images.length} 张）`}
        aria-haspopup="dialog"
        onClick={openLightbox}
      >
        <div className="gallery__main">
          {failedSet.has(safeActive) ? (
            <div className="gallery__placeholder" aria-hidden="true">
              <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M24 6a18 18 0 1 0 0 36 18 18 0 0 0 0-36zm0 4c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm5 18a3 3 0 0 1-3 3h-4a3 3 0 0 1 0-6h1v-5a3 3 0 0 1 6 0v8z"
                />
              </svg>
              <span className="gallery__placeholder-text">图片加载失败</span>
            </div>
          ) : (
            <img
              src={current?.src}
              alt={current?.alt ?? ''}
              onError={() => markFailed(safeActive)}
              loading="eager"
              decoding="async"
            />
          )}
        </div>
        {images.length > 1 && (
          <span className="gallery__counter" aria-hidden="true">
            {safeActive + 1} / {images.length}
          </span>
        )}
      </button>

      {images.length > 1 && (
        <div className="gallery__thumbs" role="tablist" aria-label="选择图片">
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === safeActive}
              aria-label={`第 ${i + 1} 张：${img.alt ?? '房源图片'}`}
              className={`gallery__thumb ${i === safeActive ? 'gallery__thumb--active' : ''}`}
              onClick={() => setActive(i)}
            >
              <img
                src={img.src}
                alt=""
                loading="lazy"
                onError={() => markFailed(i)}
              />
            </button>
          ))}
        </div>
      )}

      {lightboxOpen && (
        <div
          className="gallery__lightbox"
          role="dialog"
          aria-modal="true"
          aria-labelledby={lightboxHeadingId}
        >
          <h2 id={lightboxHeadingId} className="visually-hidden">
            图片全屏预览（第 {safeActive + 1} 张，共 {images.length} 张）
          </h2>
          <button
            ref={lightboxCloseRef}
            type="button"
            className="gallery__lightbox-close"
            aria-label="关闭全屏预览"
            onClick={closeLightbox}
          >
            ×
          </button>
          {images.length > 1 && (
            <>
              <button
                type="button"
                className="gallery__lightbox-nav gallery__lightbox-nav--prev"
                aria-label="上一张"
                onClick={goPrev}
              >
                ‹
              </button>
              <button
                type="button"
                className="gallery__lightbox-nav gallery__lightbox-nav--next"
                aria-label="下一张"
                onClick={goNext}
              >
                ›
              </button>
            </>
          )}
          <div className="gallery__lightbox-content">
            {failedSet.has(safeActive) ? (
              <div className="gallery__placeholder" aria-hidden="true">
                <svg viewBox="0 0 48 48" width="64" height="64" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M24 6a18 18 0 1 0 0 36 18 18 0 0 0 0-36zm0 4c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm5 18a3 3 0 0 1-3 3h-4a3 3 0 0 1 0-6h1v-5a3 3 0 0 1 6 0v8z"
                  />
                </svg>
              </div>
            ) : (
              <img
                src={current?.src}
                alt={current?.alt ?? ''}
                onError={() => markFailed(safeActive)}
              />
            )}
            <span className="gallery__lightbox-counter" aria-live="polite">
              {safeActive + 1} / {images.length}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
