export type AdminNavigationBadgeKey =
  | 'tasks'
  | 'notifications'
  | 'listingReviews'
  | 'listingReports'
  | 'leads'
  | 'formSubmissions'

export type AdminNavIconKey =
  | 'dashboard'
  | 'building'
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

export type AdminNavSubgroup = {
  id: string
  label: string
  children: readonly AdminNavLeaf[]
}

export type AdminNavItem = AdminNavLeaf | AdminNavSubgroup

export type AdminNavGroup = {
  id: string
  label: string
  icon: AdminNavIconKey
  children: readonly AdminNavItem[]
}
