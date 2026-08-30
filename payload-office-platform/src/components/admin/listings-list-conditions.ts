import type { Where } from 'payload'

/**
 * 房源后台列表的 where 条件构造（从 ListingsListView 抽出）。
 *
 * 单独成模块只为一件事：**能上单测**。它原本内联在 Server Component 里，而那个文件
 * 会连带 import 客户端的 Arco 表格组件，vitest 里跑不起来——于是「搜索到底搜了哪几个
 * 字段」这条最容易悄悄退化的行为一直没有守卫（OPT-063 加房间号搜索时补上）。
 */

export type ListingListFilters = Readonly<{
  q: string | null
  publicationStatus: string | null
  reviewStatus: string | null
  listingType: string | null
  businessType: string | null
  building: number | null
  missingCover: boolean
  pendingRecheck: boolean
}>

/**
 * 把已归一的筛选值拼成 Payload `where` 条件数组。
 *
 * 抽成纯函数只为一件事：**能上单测**。它原本内联在 Server Component 里，
 * 而 Server Component 在 vitest 里跑不起来——于是「搜索到底搜了哪几个字段」
 * 这条最容易悄悄退化的行为一直没有守卫。
 */
export function buildListingListConditions(filters: ListingListFilters): Where[] {
  const conditions: Where[] = []
  // OPT-063：房间号进搜索。业务员手上常常只有「XX大厦 1201」这种信息，
  // 只搜标题的话同层同面积的几套房源永远分不开。
  if (filters.q) {
    conditions.push({ or: [{ title: { like: filters.q } }, { roomNumber: { like: filters.q } }] })
  }
  if (filters.publicationStatus) {
    conditions.push({ publicationStatus: { equals: filters.publicationStatus } })
  }
  if (filters.reviewStatus) conditions.push({ reviewStatus: { equals: filters.reviewStatus } })
  if (filters.listingType) conditions.push({ listingType: { equals: filters.listingType } })
  if (filters.businessType) conditions.push({ businessType: { equals: filters.businessType } })
  if (filters.building !== null) conditions.push({ building: { equals: filters.building } })
  if (filters.missingCover) conditions.push({ coverImage: { exists: false } })
  if (filters.pendingRecheck) {
    conditions.push({ supplyVisibilityHold: { equals: 'pending_recheck' } })
  }
  return conditions
}
