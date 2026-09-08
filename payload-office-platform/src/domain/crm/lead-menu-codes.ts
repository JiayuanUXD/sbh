/**
 * 咨询线索的菜单准入码
 *
 * 语义：**任一命中即视为「能进线索模块」**，与 `navigation-config.ts` 里
 * crm 组 `leads` 叶子的 menuCodes 一致（全量视角 → `leads`，个人视角 → `my-leads`）。
 *
 * 该叶子指向 Payload 原生集合视图 `/admin/collections/leads`，而原生路由
 * **不认自定义导航的 menuCodes**（那只决定侧边栏画不画），所以真正的准入只能
 * 落在 collection 的 `access` 上。
 *
 * 与 navigation-config 的同步由 tests/leads-write-access.test.ts 守卫。
 */
export const LEAD_MENU_CODES = ['leads', 'my-leads'] as const
