'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React from 'react'

/**
 * 列表页导航反馈（OPT-068）。
 *
 * ## 修的是什么
 *
 * 筛选 / 排序 / 分页全是 `<Link>` 导航，服务端算完新页面之前浏览器**什么都不显示**：
 * 旧页面原样停着，被点的 chip 也没有选中迹象。冷路径上这一段线上实测 5–20 秒，
 * 用户能得到的唯一反馈是浏览器标签页的转圈。
 *
 * ## 怎么修
 *
 * `useTransition` + `router.push`：点击时立刻记下目标 href 并进入 pending，
 * 被点的那个链接自己长出 spinner（`data-pending`），结果区整体压暗且不可点
 * （`PendingRegion` 给容器加 `aria-busy`）。导航完成后 React 自动退出 transition。
 *
 * ## 三条边界（都踩过或差点踩）
 *
 *   - **修饰键 / 中键 / target=_blank 一律放行**：拦截这些点击会让「新标签打开」
 *     失效，那是列表页最常用的操作之一。判据与 Next 自己的 `<Link>` 一致。
 *   - **没有 Provider 时退化成普通 `<Link>`**：本组件被 dev-story、楼盘页等多处
 *     复用，Context 默认值是「不拦截」，不会因为忘了包 Provider 就把导航吞掉。
 *   - **`prefetch` 等 props 原样透传**：高基数筛选链接必须保留 `prefetch={false}`
 *     （OPT-026 的规矩，`tests/listings-query-prefetch-performance.test.ts` 按源码断言）。
 */

type NavContextValue = Readonly<{
  pendingHref: string | null
  navigate: ((href: string) => void) | null
}>

const NavContext = React.createContext<NavContextValue>({ pendingHref: null, navigate: null })

export function ListingNavigationProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [pendingHref, setPendingHref] = React.useState<string | null>(null)

  // 不用 effect 去清空 pendingHref：导航结束时 `isPending` 自己变 false，下面的
  // context value 已经按它取值，残留的 href 读不到；下一次点击直接覆盖。
  // （effect 里同步 setState 会引发级联渲染，eslint 的 react-hooks 规则也会拦。）
  const navigate = React.useCallback(
    (href: string) => {
      setPendingHref(href)
      startTransition(() => {
        router.push(href)
      })
    },
    [router],
  )

  const value = React.useMemo<NavContextValue>(
    () => ({ pendingHref: isPending ? pendingHref : null, navigate }),
    [isPending, pendingHref, navigate],
  )

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

/** 这次点击是否应该交给浏览器默认行为（新标签 / 新窗口 / 下载等）。 */
function shouldLetBrowserHandle(event: React.MouseEvent<HTMLAnchorElement>, target?: string): boolean {
  if (event.defaultPrevented) return true
  if (event.button !== 0) return true
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true
  if (target && target !== '_self') return true
  return false
}

type NavLinkProps = React.ComponentProps<typeof Link>

/**
 * 带 pending 态的 `<Link>`：用法与 `next/link` 完全一致，多出一个
 * `data-pending="true"`（正在导航到本链接时）供 CSS 画 spinner。
 */
export function NavLink({ href, onClick, target, children, ...rest }: NavLinkProps) {
  const { pendingHref, navigate } = React.useContext(NavContext)
  const hrefString = typeof href === 'string' ? href : href.toString()
  const pending = pendingHref !== null && pendingHref === hrefString

  return (
    <Link
      href={href}
      target={target}
      onClick={(event) => {
        onClick?.(event)
        if (!navigate) return
        if (shouldLetBrowserHandle(event, target)) return
        event.preventDefault()
        navigate(hrefString)
      }}
      aria-busy={pending || undefined}
      data-pending={pending ? 'true' : undefined}
      {...rest}
    >
      {children}
    </Link>
  )
}

/**
 * 结果区容器：导航进行中打上 `aria-busy`，由 CSS 压暗并屏蔽点击。
 *
 * 用 `aria-busy` 而不是自造 class：它同时是无障碍语义（屏幕阅读器会宣告
 * 「忙碌」），一个属性把视觉与语义一起给到。
 */
export function PendingRegion({
  className,
  children,
}: Readonly<{ className: string; children: React.ReactNode }>) {
  const { pendingHref } = React.useContext(NavContext)
  return (
    <div className={className} aria-busy={pendingHref !== null || undefined}>
      {children}
    </div>
  )
}
