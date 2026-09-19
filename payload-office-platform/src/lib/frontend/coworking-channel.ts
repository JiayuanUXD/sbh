import { buildCanonicalSearchParams, type ListingSearchInput } from '@/domain/public-catalog'

/**
 * 共享办公独立频道（OPT-103）。
 *
 * 与 `sale-channel.ts` 同形：`/[city]/coworking` 是 `CityListingsView` 的另一个实例，
 * 差别只在**类型被锁死**——路由层把 `listingType` 强制为 `['coworking']`、canonical
 * 不输出 `type`。类型不是这个页面的一个条件，是它的定义；因此它不出现在筛选行、
 * 不出现在 chip、不进「清除全部」的作用域（见 CityListingsView 的 `lockedDimensions`）。
 *
 * 查询缓存无需关心这里：`getCachedSearchListings` 的缓存键是城市 + 频道扫描，
 * 分页 / 筛选在内存里按 `input` 做，锁定的类型自然进 `input`。
 */

export const COWORKING_LISTING_TYPE = 'coworking'

export function coworkingChannelPath(citySlug?: string): string {
  return citySlug ? `/${citySlug}/coworking` : '/coworking'
}

/** 覆盖 URL 里任何 `type=`：`/coworking?type=full-floor` 仍然只看共享办公。 */
export function lockCoworkingInput(input: ListingSearchInput): ListingSearchInput {
  return { ...input, listingType: [COWORKING_LISTING_TYPE] }
}

/** 频道 canonical：与房源列表同一份序列化，只是不输出被锁定的 `type`。 */
export function buildCoworkingCanonicalParams(input: ListingSearchInput): URLSearchParams {
  const sp = buildCanonicalSearchParams(input)
  sp.delete('type')
  return sp
}
