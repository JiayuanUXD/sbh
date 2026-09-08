/**
 * 客户档案的菜单准入码
 *
 * 语义：**任一命中即视为「能进客户档案模块」**，与 `navigation-config.ts` 里
 * crm 组 `customers` 叶子的 menuCodes 一致（全量视角 → `customers`，
 * 个人视角 → `my-customers`）。
 *
 * 该叶子指向 Payload 原生集合视图 `/admin/collections/customers`，而原生路由
 * **不认自定义导航的 menuCodes**（那只决定侧边栏画不画），所以真正的准入只能
 * 落在 collection 的 `access` 上——本常量就是那份判据。
 *
 * 与 navigation-config 的同步由 tests/customers-access.test.ts 守卫：
 * 直接从 ADMIN_NAV_GROUPS 取该叶子比对，改了一边忘了另一边会红。
 */
export const CUSTOMER_MENU_CODES = ['customers', 'my-customers'] as const
