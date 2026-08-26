/**
 * C 端公开站导航数据（主导航 + 页脚）
 *
 * 设计依据：.agent/supply.md「房源投放申请（SupplySubmissions）」——删导航入口不动 serviced-office 数据
 *
 * 守护不变量：
 *   - 导航数据只有这一处定义；SiteNav 与 SiteFooter 都从此读取，
 *     避免"改了导航忘了页脚"（本次调整前「服务式办公」正是两处各写一份）；
 *   - 主导航顺序即产品定义顺序，由 tests/public-nav.test.ts 锁定；
 *   - 只删导航入口，不动 Listings.listingType 的 serviced-office 枚举
 *     （房源类型仍存在，筛选器里仍可选）。
 */

export type PublicNavItem = Readonly<{ href: string; label: string }>

export type PublicNavColumn = Readonly<{
  title: string
  links: readonly PublicNavItem[]
}>

/**
 * 主导航**默认值**（迁移执行前与配置全空时的兜底，见 site-settings-view.ts）。
 *
 * 「首页」项：原本刻意不设，理由是 logo 本身就回首页。OPT-054 之后这条不再由
 * 代码决定——目标池里有 `home`，放不放进主导航是后台配置。这里保留一份含首页的
 * 默认值，与 `SiteSettings.mainNav` 的 defaultValue 逐条对应。
 */
export const MAIN_NAV_ITEMS: readonly PublicNavItem[] = [
  { href: '/', label: '首页' },
  { href: '/listings', label: '找办公室' },
  { href: '/buildings', label: '找楼盘' },
  { href: '/listings?type=coworking', label: '共享办公' },
  { href: '/entrust', label: '委托找房' },
  { href: '/publish', label: '投放房源' },
  { href: '/news', label: '资讯' },
] as const

/** 页脚导航分组。 */
export const FOOTER_COLUMNS: readonly PublicNavColumn[] = [
  {
    title: '浏览',
    links: [
      { href: '/listings', label: '在租房源' },
      { href: '/buildings', label: '找写字楼' },
      { href: '/news', label: '资讯中心' },
    ],
  },
  {
    title: '按类型',
    links: [
      { href: '/listings?type=traditional-office', label: '传统办公' },
      { href: '/listings?type=coworking', label: '联合办公' },
      { href: '/listings?type=full-floor', label: '整层办公' },
    ],
  },
  {
    title: '服务',
    links: [
      { href: '/entrust', label: '委托找房' },
      { href: '/publish', label: '投放房源' },
    ],
  },
] as const
