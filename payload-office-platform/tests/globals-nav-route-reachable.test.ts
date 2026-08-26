/**
 * 自定义导航里指向 Global 的入口，其路由必须真的可达
 *
 * ## 被守护的事故
 *
 * `SiteSettings` 与 `AdvisorServiceHours` 都写了 `admin.hidden: true`，本意是
 * 「退出 Payload 原生导航」（本仓库用自定义导航，见 `navigation-config.ts`）。
 * 但 `hidden` 干的不止这件事——`@payloadcms/ui` 的 `getVisibleEntities`
 * 会把它从 `visibleEntities.globals` 里**整个滤掉**，于是
 * `/admin/globals/<slug>` 匹配不到任何视图，`Root` 视图直接 `notFound()`。
 *
 * 表现是：**自定义导航里那一项在、能点、高亮也对，点进去是「没有找到任何东西」**。
 * 菜单与路由分属两套机制，看见菜单在就以为没问题，会踩空。
 *
 * Payload 自己的类型注释把区别写得很清楚（`globals/config/types.d.ts`）：
 *   - `group: false` → 从侧边栏/仪表盘排除，**不禁用路由**
 *   - `hidden: true` → 从后台导航**和路由**一起排除
 *
 * 这个缺陷在 `AdvisorServiceHours` 上一直存在，只是那个入口大概没人点过；
 * OPT-053 照抄它才让问题浮出来。**照抄一个没被验证过的范例，会把它的缺陷一起复制。**
 *
 * ## 为什么必须是自动化守卫
 *
 * typecheck 干净、3800+ 单测全绿、`next build` 也过——只有真的点进那个菜单才会发现。
 */
import { describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import type { AdminNavGroup, AdminNavItem, AdminNavLeaf } from '@/domain/admin-navigation/navigation-types'

function isSubgroup(item: AdminNavItem): item is Exclude<AdminNavItem, AdminNavLeaf> {
  return 'children' in item
}

function flattenLeaves(groups: readonly AdminNavGroup[]): AdminNavLeaf[] {
  const out: AdminNavLeaf[] = []
  for (const group of groups) {
    for (const item of group.children) {
      if (isSubgroup(item)) out.push(...item.children)
      else out.push(item)
    }
  }
  return out
}

/** `/admin/globals/<slug>` → slug */
function globalSlugFromHref(href: string): string | null {
  return /^\/admin\/globals\/([^/]+)$/.exec(href)?.[1] ?? null
}

describe('导航里的 Global 入口不得因 admin.hidden 而 404', () => {
  it('每个指向 Global 的导航项，其 Global 都没被 admin.hidden 排除', async () => {
    const resolved = await config
    const globals = resolved.globals ?? []

    const broken: string[] = []
    for (const leaf of flattenLeaves(ADMIN_NAV_GROUPS)) {
      const slug = globalSlugFromHref(leaf.href)
      if (!slug) continue

      const global = globals.find((g) => g.slug === slug)
      if (!global) {
        broken.push(`${leaf.label}（${leaf.href}）：payload.config 里没有这个 global`)
        continue
      }
      // hidden 可以是布尔或函数；函数形态一律视为「可能隐藏」，不该用在有导航入口的 global 上
      if (global.admin?.hidden) {
        broken.push(
          `${leaf.label}（${leaf.href}）：admin.hidden 为真，路由会 notFound。` +
            `想退出原生导航请用 group: false`,
        )
      }
    }

    expect(
      broken,
      '这些导航项点进去会是「没有找到任何东西」——菜单在不代表路由在：\n' + broken.join('\n'),
    ).toEqual([])
  })
})
