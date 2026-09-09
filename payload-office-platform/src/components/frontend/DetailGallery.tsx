'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DetailMediaViewModel } from '@/domain/public-catalog/contracts'
import { normalizePublicMediaUrl } from '@/domain/public-catalog/media-url'
import { buildSrcSet } from '@/lib/frontend/media-srcset'
import { track } from '@/lib/frontend/analytics'
import { formatPublishedDate } from '@/lib/frontend/format'
import DetailVideo from './DetailVideo'
import { ChevronLeftIcon, ChevronRightIcon, PhotoIcon, XMarkIcon } from './ui/icons'

type DetailGalleryProps = Readonly<{
  media: readonly DetailMediaViewModel[]
  title: string
  /** The containing detail route; used only as an analytics enum. */
  pageType?: 'listing' | 'building'
}>

type RenderableMedia = Readonly<{
  item: DetailMediaViewModel
  src: string
  /** 派生尺寸拼成的 srcset；存量图没有派生时为 undefined，此时一律不发 srcset/sizes。 */
  srcSet?: string
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
    /* variants 的每一档 URL 已在 mapper 层各自过过 normalizePublicMediaUrl
       （mappers.ts 的 mapMediaVariants），单档不合格只丢该档，所以这里可以直接用，
       不需要再校验一遍。 */
    srcSet: buildSrcSet(item.resource),
    alt: item.resource.alt?.trim() || `${title} ${item.category}`,
  }
}

/* 主图 sizes：主栏是弹性轨道，宽度按 .dt-core 推导——
     ≥1440：容器 1440 − 侧栏 372 − 列间 32 = 1036px
     1024–1439：100vw − 64(gut) − 404(侧栏+列间)
     ≤1023：.dt-core 塌成单列，主栏即容器宽（gut 在 <768 是 16、768+ 是 32）
   写歪了不会报错、只会让浏览器选错档，所以逐档跟着断点写。 */
const MAIN_IMAGE_SIZES =
  '(max-width: 767px) 100vw, (max-width: 1023px) calc(100vw - 64px), (max-width: 1439px) calc(100vw - 468px), 1036px'

/* 缩略图轨道一行 5 格（detail.css 的 flex: 0 0 calc((100% - 32px) / 5)），
   ≥1440 时约 201px。这里刻意不写成主图那样的逐档 calc：所有断点下的值都远小于
   最小派生档 320w，浏览器无论如何都会选同一档，多写的精度不产生任何差别。 */
const THUMB_IMAGE_SIZES = '(max-width: 1023px) 20vw, 201px'

/**
 * Public-detail gallery with classified tabs, failure placeholders and an
 * accessible fullscreen viewer. Videos are lazily mounted only after the user
 * switches to the 视频 tab (DetailVideo uses preload="none", no autoplay),
 * keeping third-party media off the first-paint critical path.
 */
/**
 * OPT-053 三层兜底的第三层：默认值就是接线前这里的硬编码字面量。
 * 本组件是 'use client'，不能 import 站点设置读取器（那会把 payload 拖进客户端包），
 * 配置值由服务端父组件传入，缺省时用这个常量。
 */
const DEFAULT_IMAGE_DISCLAIMER = '示意图，以现场实际情况为准'

export default function DetailGallery({
  media,
  title,
  pageType,
  imageDisclaimer = DEFAULT_IMAGE_DISCLAIMER,
}: DetailGalleryProps & Readonly<{ imageDisclaimer?: string }>) {
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

  /**
   * 补挂载时的「已经失败了吗」判定——onError 单独不够用。
   *
   * SSR 出来的 <img> 一进 HTML 解析器就开始加载，而 React 的 onError 要等这个
   * 客户端组件 hydration 完成才挂到 DOM 上。图片在这中间的窗口里 404 / 断流时：
   * error 事件不冒泡（只走捕获阶段直达 target），React 也不会为 hydration 之前
   * 错过的 load/error 补发事件——于是 onError 永远不触发，用户看到的是浏览器的
   * 破图框，而不是 MediaFallback。这个窗口在生产构建下是几十到几百毫秒，在
   * next dev 下可达数秒，绝非理论值。
   *
   * 判据用 complete && naturalWidth === 0：加载成功的位图必有 naturalWidth；
   * 还没开始 / 正在加载（含 loading="lazy" 的缩略图）complete 为 false，会被跳过，
   * 它们后续真失败时由已经挂好的 onError 接住。
   *
   * ref 回调本身保持稳定（id 从 data-media-id 读，而不是按 id 现造闭包），
   * 否则每次 render 都会 detach/attach 一遍 ref。
   *
   * ⚠️ 验证这段逻辑**必须用有真实视口宽度的浏览器**。Claude Browser pane 的
   * `innerWidth` 是 0，而 `sizes` 正是按视口宽度解析的：0 宽视口下带 srcset 的图
   * `load` 事件照常触发、`naturalWidth` 却恒为 0，正好撞上本函数的失败指纹，
   * 于是主图被误判成加载失败、渲染成「图片暂未加载」。2026-09-09 在那个面板里
   * 复现过一次并差点据此改这里的判据——换真实 Chrome（视口 976）即一切正常，
   * 选中 1200w 档。**那是环境假象，不是缺陷。**
   */
  const detectPreHydrationFailure = useCallback((node: HTMLImageElement | null) => {
    if (!node) return
    const id = node.dataset.mediaId
    if (!id) return
    if (node.complete && node.naturalWidth === 0) markFailed(id)
  }, [markFailed])

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

  // 无媒体是常态而非异常：前台可见性已不再要求图片数（见 domain/review/
  // effective-supply.ts 头部），所以详情页必须能在 0 张图下正常渲染。
  //
  // ── 2026-09-04：撤销「无图替代构图」（OPT-037 Task 2 / Task 10b）──────────
  // 原方案是：调用方能给出关键规格就换一种构图（NoImageHeroGrid 六格宫格）
  // 接管首屏，而不是摆一块占位。撤销的理由是产品判断，不是那套论证有错：
  //   1. 两页在"无图"下长得不一样。房源页多数有媒体记录（哪怕文件取不到，
  //      走的是失败占位、**图片区还在**），楼盘页 media 为 0 走替代构图、
  //      **图片区整个消失**——同一个站点两种首屏骨架，用户能直接看出来。
  //   2. 「这里本来该有照片」本身是要传达的信息。换成参数宫格等于把它藏掉，
  //      用户不知道是"没拍"还是"这页就长这样"。
  // 现在两页统一：无媒体 → 渲染与画廊同比例（16:10）的占位区，文案「图片拍摄中」。
  // 宫格里那六个字段并没有丢——它们本来就在楼盘参数区/概况面板里有完整出处。
  if (renderableMedia.length === 0) {
    return (
      <div
        className="detail-gallery detail-gallery--empty media-placeholder"
        role="img"
        aria-label={`${title} 图片拍摄中`}
        data-media-state="missing"
      >
        <PhotoIcon size={48} />
        <span className="media-placeholder__text">
          <strong>图片拍摄中</strong>
          <span>可先查看房源信息，实景可预约顾问确认</span>
        </span>
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

      {activeMedia && (
        <figure
          className="detail-gallery__main detail-gallery__item"
          data-media-kind={activeMedia.item.kind}
          data-detail-analytics-event={pageType ? 'media_view' : undefined}
          data-analytics-page-type={pageType}
          data-analytics-media-category={pageType ? activeMedia.item.category : undefined}
          data-analytics-rank={pageType ? safeActiveIndex + 1 : undefined}
        >
          {activeMedia.item.kind === 'video' ? (
            <div className="detail-gallery__main-video-wrapper">
              {failedMediaIds.has(activeMedia.item.id) ? (
                <MediaFallback />
              ) : (
                <DetailVideo src={activeMedia.src} alt={activeMedia.alt} />
              )}
              <button
                type="button"
                className="detail-gallery__open detail-gallery__open--video"
                aria-label={`查看全屏媒体：${activeMedia.alt}（第 ${safeActiveIndex + 1} 个，共 ${currentList.length} 个）`}
                aria-haspopup="dialog"
                onClick={(event) => open(safeActiveIndex, event.currentTarget)}
              >
                全屏查看视频
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="detail-gallery__main-media detail-gallery__open"
              aria-label={`查看全屏媒体：${activeMedia.alt}（第 ${safeActiveIndex + 1} 个，共 ${currentList.length} 个）`}
              aria-haspopup="dialog"
              onClick={(event) => open(safeActiveIndex, event.currentTarget)}
            >
              {failedMediaIds.has(activeMedia.item.id) ? (
                <MediaFallback />
              ) : (
                <img
                  ref={detectPreHydrationFailure}
                  data-media-id={activeMedia.item.id}
                  src={activeMedia.src}
                  {...(activeMedia.srcSet
                    ? { srcSet: activeMedia.srcSet, sizes: MAIN_IMAGE_SIZES }
                    : {})}
                  alt={activeMedia.alt}
                  loading="eager"
                  /* 详情页的 LCP 元素几乎总是这张主图。它虽然在 SSR 的 HTML 里、
                     预扫描器找得到，但排在图集 DOM 深处，默认优先级与页面上其它
                     图片同级；显式提到 high 让它先于缩略图与推荐位取。 */
                  fetchPriority="high"
                  onError={() => markFailed(activeMedia.item.id)}
                />
              )}
            </button>
          )}

          {/* 图上压暗 + 说明文字 + 计数 pill：只在图片/平面图分类、且当前媒体
              未加载失败时渲染——视频有自己的全屏按钮覆盖层，压暗贴文字这套
              视觉语言不适用；失败态下盖一层压暗只会挡住 MediaFallback 的
              居中提示文字。压暗复用全站 .sf-scrim（见本文件顶部 detail.css
              同名判断记录，不新增修饰类）。 */}
          {activeMedia.item.kind !== 'video' && !failedMediaIds.has(activeMedia.item.id) && (
            <span className="sf-scrim" aria-hidden="true" />
          )}

          {activeMedia.item.kind !== 'video' && currentList.length > 1 && !failedMediaIds.has(activeMedia.item.id) && (
            <span className="sf-num detail-gallery__main-counter" aria-hidden="true">
              {safeActiveIndex + 1} / {currentList.length}
            </span>
          )}

          {activeMedia.item.kind !== 'video' && currentList.length > 1 && (
            <div className="detail-gallery__main-nav" aria-label="主图切换">
              <button
                type="button"
                className="detail-gallery__main-nav-button detail-gallery__main-nav-button--prev"
                aria-label="上一张图片"
                onClick={() => goTo(safeActiveIndex - 1)}
              >
                <ChevronLeftIcon size={22} />
              </button>
              <button
                type="button"
                className="detail-gallery__main-nav-button detail-gallery__main-nav-button--next"
                aria-label="下一张图片"
                onClick={() => goTo(safeActiveIndex + 1)}
              >
                <ChevronRightIcon size={22} />
              </button>
            </div>
          )}

          <span className="detail-gallery__main-badge">
            {activeMedia.item.category}
            {activeMedia.item.kind === 'floor-plan' && activeMedia.item.isSchematic && ' (示意图)'}
            {activeMedia.item.capturedAt && ` · 商户上传 ${formatPublishedDate(activeMedia.item.capturedAt)}`}
          </span>
          {activeMedia.item.kind === 'floor-plan' && activeMedia.item.isSchematic && (
            <figcaption className="detail-gallery__caption">
              <span className="detail-gallery__schematic-note">{imageDisclaimer}</span>
            </figcaption>
          )}
        </figure>
      )}

      {activeKind === 'floor-plan' && (
        <p className="detail-gallery__schematic-declaration" role="note">
          {imageDisclaimer}
        </p>
      )}

      {currentList.length > 1 && (
        <div className="detail-gallery__track" role="region" aria-label="媒体缩略图列表">
          <button
            type="button"
            className="detail-gallery__arrow detail-gallery__arrow--prev"
            aria-label="上一个媒体"
            onClick={() => goTo(safeActiveIndex - 1)}
          >
            <ChevronLeftIcon size={18} />
          </button>
          <div className="detail-gallery__thumbnails" role="tablist" aria-label="缩略图按键">
            {currentList.map((renderable, index) => {
              const { item, src, srcSet, alt } = renderable
              const isActive = index === safeActiveIndex
              const hasFailed = failedMediaIds.has(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  className={`detail-gallery__thumb ${isActive ? 'detail-gallery__thumb--active' : ''}`}
                  aria-selected={isActive}
                  aria-label={`${alt}（第 ${index + 1} 张）`}
                  data-active={isActive || undefined}
                  data-media-kind={item.kind}
                  data-detail-analytics-event={pageType ? 'media_view' : undefined}
                  data-analytics-page-type={pageType}
                  data-analytics-media-category={pageType ? item.category : undefined}
                  data-analytics-rank={pageType ? index + 1 : undefined}
                  onClick={() => setActiveIndex(index)}
                >
                  {hasFailed ? (
                    <MediaFallback />
                  ) : (
                    <img
                      ref={detectPreHydrationFailure}
                      data-media-id={item.id}
                      src={src}
                      {...(srcSet ? { srcSet, sizes: THUMB_IMAGE_SIZES } : {})}
                      alt={alt}
                      loading="lazy"
                      onError={() => markFailed(item.id)}
                    />
                  )}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="detail-gallery__arrow detail-gallery__arrow--next"
            aria-label="下一个媒体"
            onClick={() => goTo(safeActiveIndex + 1)}
          >
            <ChevronRightIcon size={18} />
          </button>
        </div>
      )}

      {isOpen && activeMedia && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={dialogRef}
          className="detail-gallery__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
        >
          <h2 id={dialogTitleId} className="visually-hidden">全屏媒体预览</h2>
          <button ref={closeRef} type="button" className="detail-gallery__close" aria-label="关闭全屏媒体预览" onClick={close}><XMarkIcon size={20} /></button>
          {activeKind === 'image' && currentList.length > 1 && (
            <>
              <button type="button" className="detail-gallery__nav detail-gallery__nav--previous" aria-label="上一张媒体" onClick={() => goTo(safeActiveIndex - 1)}><ChevronLeftIcon size={22} /></button>
              <button type="button" className="detail-gallery__nav detail-gallery__nav--next" aria-label="下一张媒体" onClick={() => goTo(safeActiveIndex + 1)}><ChevronRightIcon size={22} /></button>
            </>
          )}
          <div className="detail-gallery__dialog-content">
            {failedMediaIds.has(activeMedia.item.id) ? <MediaFallback /> : activeMedia.item.kind === 'video' ? (
              <video controls preload="none" aria-label={activeMedia.alt} onError={() => markFailed(activeMedia.item.id)}>
                <source src={activeMedia.src} />
                抱歉，你的浏览器不支持视频播放。
              </video>
            ) : (
              /* 全屏查看器：图铺满视口，sizes 给 100vw 让浏览器取最大的一档。 */
              <img
                src={activeMedia.src}
                {...(activeMedia.srcSet ? { srcSet: activeMedia.srcSet, sizes: '100vw' } : {})}
                alt={activeMedia.alt}
                onError={() => markFailed(activeMedia.item.id)}
              />
            )}
            <p className="detail-gallery__dialog-caption">{activeMedia.alt}</p>
            <p className="detail-gallery__counter" role="status" aria-live="polite">第 {safeActiveIndex + 1} 个，共 {currentList.length} 个 · {activeMedia.item.category}</p>
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  )
}

function MediaFallback() {
  return (
    <span className="detail-gallery__fallback" role="img" aria-label="图片暂未加载">
      {/* 图标与 ui/Media.tsx 的占位共用 PhotoIcon：改动前这里只有文字，
          和卡片上的占位块长得不是一回事。失败态文案保持「图片暂未加载」，
          与缺省态的「图片拍摄中」区分（两者含义不同，见 Media.tsx 文件头）。 */}
      <PhotoIcon size={36} />
      <strong>图片暂未加载</strong>
      <span>可先查看房源信息，实景可预约顾问确认</span>
    </span>
  )
}
