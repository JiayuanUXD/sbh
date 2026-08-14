'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

/**
 * 外壳（页头/页脚/城市切换器）专用的 query 读取。
 *
 * 为什么不用 next/navigation 的 useSearchParams()：
 *   外壳由 layout 渲染，而 App Router 的 layout 拿不到 searchParams，
 *   于是 useSearchParams() 会在 SSR 期挂起、把子树交给客户端渲染。
 *   在 Next 16.2 + React 19.2 下该边界的客户端 reveal 不会发生：
 *   内容滞留在 React 的隐藏暂存区（边界停在 $~ queued 态）而永不水合，
 *   表现为整个页头页脚不可交互（移动端菜单打不开、城市切换器点不动），
 *   且因 fallback 与子树同构、body 上有 suppressHydrationWarning，
 *   页面看起来完全正常、控制台无任何报错。
 *
 * 本 hook 改为挂载后读 window.location.search：
 *   - 首次渲染返回空参数，与 SSR 输出一致 → 无水合不匹配、无挂起、无边界；
 *   - 挂载后（及 pathname 变化时）用 effect 补齐真实 query；
 *   - 返回的 refresh() 供交互时刻主动取最新 query —— 筛选栏做客户端导航时
 *     只改 query 不改 pathname，effect 不会触发，必须在打开切换器等时刻显式刷新。
 *
 * 守护不变量：外壳不得再引入任何流式 Suspense 边界。
 * 见 tests/frontend-shell-hydration.test.ts。
 */

/** 稳定的空参数实例：作为 SSR 与首次客户端渲染的共同起点。 */
const EMPTY_SEARCH_PARAMS = new URLSearchParams()

export function useClientSearchParams(): readonly [URLSearchParams, () => void] {
  const pathname = usePathname()
  const [params, setParams] = useState<URLSearchParams>(EMPTY_SEARCH_PARAMS)

  const refresh = useCallback(() => {
    if (typeof window === 'undefined') return
    const next = window.location.search.replace(/^\?/, '')
    // 同值不换实例，避免无谓的重渲染与 effect 抖动
    setParams((prev) => (prev.toString() === next ? prev : new URLSearchParams(next)))
  }, [])

  useEffect(() => {
    refresh()
  }, [pathname, refresh])

  return [params, refresh]
}
