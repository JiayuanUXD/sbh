/**
 * 主导航固定二级菜单（OPT-096）。
 *
 * **代码规则，不是后台配置**：只有「找办公室」（目标 `/listings`）与「找楼盘」
 * （目标 `/buildings`）两项带「租赁 / 出售」子项。做成后台可配要数组套数组，
 * 且新目标要进 PG 枚举（见 nav-targets.ts「新增目标需要迁移」），本次不做。
 *
 * 按**目标 href** 而不是配置行 id 匹配：href 归代码（OPT-054 的护栏），运营改标签、
 * 改顺序、隐藏都不影响子项；把「找办公室」改指别的目标，子项也随之消失。
 *
 * 本文件**零 import**：`site-settings-view.ts`（客户端安全）与 `site-settings.ts`
 * （服务端）都要用它，任何 import 都可能把服务端依赖拖进浏览器包。
 */

export type NavSubItem = Readonly<{ href: string; label: string }>

export const NAV_SUBMENU_BY_HREF: Readonly<Record<string, readonly NavSubItem[]>> = {
  '/listings': [
    { href: '/listings', label: '租赁' },
    { href: '/sale', label: '出售' },
  ],
  '/buildings': [
    { href: '/buildings', label: '租赁' },
    { href: '/buildings?business=sale', label: '出售' },
  ],
}

/** 给主导航项挂子项；没有子项的项原样返回（不带 `children` 键）。 */
export function attachMainNavSubmenu<T extends Readonly<{ href: string }>>(
  items: readonly T[],
): readonly (T & Readonly<{ children?: readonly NavSubItem[] }>)[] {
  return items.map((item) => {
    const children = NAV_SUBMENU_BY_HREF[item.href]
    return children ? { ...item, children } : item
  })
}
