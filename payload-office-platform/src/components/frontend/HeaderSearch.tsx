'use client'

import { useRouter } from 'next/navigation'
import React, { useEffect, useId, useRef, useState } from 'react'
import { buildListingSearchHref, listingsPathFor } from '@/lib/frontend/search-submit'

/**
 * 顶栏常驻搜索（OPT-075）。
 *
 * **为什么不复用 `HomeSearchPill`**：那套的内部控件是 44px 高（`home.css:169/172/183`），
 * 且带「筛选」三下拉展开面板，整体塞不进 64px 的头。两者共享的是 **URL 语义**
 * （`lib/frontend/search-submit.ts`），不是 DOM。
 *
 * **展开策略刻意做成「CSS 决定形态、JS 只管 open」**：
 *   - ≥1024（= 桌面导航断点）：输入框常驻，`.header-search__toggle` 被 CSS 隐藏 ——
 *     `open` 在这一档不起作用；
 *   - <1024：只显示 toggle，输入框是绝对定位覆盖层，靠 `.header-search--open` 显隐。
 *
 * 这样 JS 里**不需要 matchMedia**，也就没有「JS 断点与 CSS 断点各写一份、改一处漏一处」
 * 的坑。`SiteNav` 正是那种重复（`SiteNav.tsx:21` 与 `styles.css` 的媒体查询同为 1280，
 * 本次改断点要两处一起动），新组件不再引入同型重复。
 *
 * 首页透明态不渲染本组件（由 `SiteHeader` 决定），避免首页同屏出现两个搜索框；
 * 滚过阈值切实底后随之出现。
 */
export default function HeaderSearch({
  citySlug,
  initialKeyword,
}: Readonly<{
  citySlug?: string
  /** 当前 URL 上的 `q`，用于回填。列表页带着关键词进来时，顶栏要显示它正在生效。 */
  initialKeyword?: string
}>) {
  const router = useRouter()
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState(initialKeyword ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  /* 回填同步。
   *
   * `initialKeyword` 来自 SiteHeader 的 `useClientSearchParams`，那是**挂载后**才读到的
   * （见该 hook 的注释），所以首帧一定是 undefined、随后才变成真值——用 defaultValue 的
   * 非受控写法会永远停在空串。这里用「记住上次同步值」的方式：URL 上的 q 变了就覆盖输入框
   * （含挂载后那次填充、以及搜索完落到新 URL），两次变化之间用户正在打的字不受打扰。 */
  const syncedRef = useRef(initialKeyword ?? '')
  useEffect(() => {
    const next = initialKeyword ?? ''
    if (next !== syncedRef.current) {
      syncedRef.current = next
      setKeyword(next)
    }
  }, [initialKeyword])

  /* 展开态：Esc 收起并把焦点还给触发器（与 SiteNav 抽屉同一套口径）。
   *
   * 焦点归还**必须等收起后的这一轮 effect**，不能在 Esc 处理里紧跟着 setOpen 调 focus()：
   * 那一刻 toggle 还是 `display:none`（要等 React 重渲染才恢复），对隐藏元素调 focus()
   * 静默失败。第一版就是这么写的，实测 Esc 后焦点掉到 body 上。 */
  const restoreFocusRef = useRef(false)
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return
        restoreFocusRef.current = true
        setOpen(false)
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false
      toggleRef.current?.focus()
    }
    return undefined
  }, [open])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setOpen(false)
    router.push(buildListingSearchHref(citySlug, { q: keyword }))
  }

  return (
    <div className={open ? 'header-search header-search--open' : 'header-search'}>
      <button
        ref={toggleRef}
        type="button"
        className="header-search__toggle"
        aria-expanded={open}
        aria-label="搜索房源"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
      </button>
      <form
        className="header-search__form"
        role="search"
        /* 原生 GET 表单兜底：JS 未就绪（水合前、脚本失败）时回车也能搜到，
           浏览器会自己拼出 `?q=…`。有 JS 时下面的 onSubmit preventDefault 接管，
           走客户端导航而不是整页刷新。input 的 name="q" 是这条兜底的一半，别删。 */
        action={listingsPathFor(citySlug)}
        method="get"
        onSubmit={submit}
        /* 收起态在 <1280 是 display:none，天然不可聚焦；≥1280 常驻可见。
           不用 inert/hidden 属性，避免与 CSS 断点各说一套。 */
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
        }}
      >
        <SearchIcon className="header-search__icon" />
        <label htmlFor={inputId} className="visually-hidden">
          搜索商圈、楼盘或地址
        </label>
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          type="search"
          className="header-search__input"
          placeholder="搜索商圈、楼盘或地址"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <button type="submit" className="header-search__submit">
          搜索
        </button>
      </form>
    </div>
  )
}

function SearchIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={className}
      width="17"
      height="17"
      viewBox="0 0 17 17"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <path d="M11.2 11.2L15.5 15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
