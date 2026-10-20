'use client'

/**
 * 站内搜索输入联想（OPT-122 Phase 3）。
 *
 * 约定：
 *   - 150ms 防抖 + AbortController：快速输入只保留最后一次请求；
 *   - 只发 `/[city]/search/suggestions`，词表在服务端按城市缓存，本端不持有词表；
 *   - 键盘由本 hook 统一处理（↑/↓/Esc/Enter），两个入口（顶栏、搜索页表单）
 *     不各写一份；Enter 命中激活项时返回该建议交由调用方导航，返回 null 表示
 *     「这个键我没消费」，调用方走自己的提交逻辑；
 *   - `enabled` 是**单向闩锁**：调用方在输入框首次聚焦时置 true 且不再复位。
 *     这样带着 q 落到搜索结果页时（回填 keyword 但用户没碰过输入框），联想不会
 *     自动展开；失焦后的收起由调用方调 `close()` 完成，不经过 enabled。
 */

import { useCallback, useEffect, useId, useState } from 'react'

export type SearchSuggestionItem = Readonly<{
  kind: string
  name: string
  parentName?: string
  href: string
}>

const DEBOUNCE_MS = 150

export function useSearchSuggestions({
  citySlug,
  query,
  enabled,
}: Readonly<{
  citySlug: string | undefined
  query: string
  enabled: boolean
}>) {
  const listboxId = useId()
  const optionId = (index: number) => `${listboxId}-option-${index}`

  const [items, setItems] = useState<readonly SearchSuggestionItem[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [trackedQuery, setTrackedQuery] = useState(query)

  /* 查询被清空（用户删光输入）：渲染期同步调整状态——React 认可的
     "adjusting state when props change" 模式，避免在 effect 里同步 setState
     触发级联渲染（react-hooks/set-state-in-effect）。 */
  if (trackedQuery !== query) {
    setTrackedQuery(query)
    if (query.trim().length === 0) {
      setItems([])
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  useEffect(() => {
    if (!enabled || !citySlug || query.trim().length === 0) return undefined

    const controller = new AbortController()
    const timer = setTimeout(() => {
      const url = `/${encodeURIComponent(citySlug)}/search/suggestions?q=${encodeURIComponent(query)}`
      fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
        .then(async (response) => {
          if (!response.ok) throw new Error(`suggestions ${response.status}`)
          const data = (await response.json()) as { suggestions?: SearchSuggestionItem[] }
          if (controller.signal.aborted) return
          const next = data.suggestions ?? []
          setItems(next)
          setOpen(next.length > 0)
          setActiveIndex(-1)
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setItems([])
          setOpen(false)
          setActiveIndex(-1)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [citySlug, query, enabled])

  const close = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
  }, [])

  /** 处理键盘事件；返回需要导航的建议（Enter 命中激活项）或 null（未消费）。 */
  const consumeKeyDown = useCallback(
    (event: React.KeyboardEvent): SearchSuggestionItem | null => {
      if (items.length === 0) return null
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setOpen(true)
        setActiveIndex((index) => (index + 1) % items.length)
        return null
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setOpen(true)
        setActiveIndex((index) => (index <= 0 ? items.length - 1 : index - 1))
        return null
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return null
      }
      if (event.key === 'Enter' && activeIndex >= 0 && open) {
        event.preventDefault()
        const picked = items[activeIndex] ?? null
        close()
        return picked
      }
      return null
    },
    [items, activeIndex, open, close],
  )

  return {
    listboxId,
    optionId,
    items,
    open,
    activeIndex,
    close,
    consumeKeyDown,
    select: setActiveIndex,
  } as const
}
