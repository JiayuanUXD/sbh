export type AdminNavigationBadgeKey =
  | 'tasks'
  | 'notifications'
  | 'listingReviews'
  | 'listingReports'
  | 'leads'
  | 'formSubmissions'
  | 'cityPartnerApplications'
  | 'supplySubmissions'
  | 'informationCorrections'

export type AdminNavIconKey =
  | 'dashboard'
  | 'inbox'
  | 'building'
  | 'location'
  | 'shield'
  | 'user'
  | 'shop'
  | 'team'
  | 'file'
  | 'form'
  | 'settings'

export type AdminNavLeaf = {
  id: string
  label: string
  href: string
  menuCodes: readonly string[]
  collectionSlug?: string
  requiredOperationCode?: string
  badgeKey?: AdminNavigationBadgeKey
  children?: never
}

/**
 * 组的直接子项只能是叶子（OPT-084 Phase 1，深度上限两级）。
 *
 * 这个别名保留是为了让「组的 children 装的是什么」在类型上仍有名字可指；
 * 子分组那一层已删除——它曾把「配套字典」埋在「系统管理 → 基础配置」下面，
 * 一个只有单片叶子的子分组要点两次才到得了。
 */
export type AdminNavItem = AdminNavLeaf

export type AdminNavGroup = {
  id: string
  label: string
  icon: AdminNavIconKey
  children: readonly AdminNavItem[]
}
