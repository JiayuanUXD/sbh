/**
 * 房源后台列表的每页条数（OPT-114）。
 *
 * 服务端（解析 `?limit=`）与客户端（分页下拉）共用这一份白名单，不各写一份。
 * 200 / 500 两档是给「一个楼盘几百套、只留少数上架」用的：一页里全选、取消要保留的，
 * 再批量下架。勾选只在当前页有效，所以一页能装下整个楼盘才省事。
 * 批量请求仍按端点单次上限分批发送，见 `runChunkedBatch`。
 *
 * 单独成模块：Server Component 会连带 import 客户端的 Arco 表格，vitest 里跑不起来。
 */

export const LISTING_PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200, 500] as const

export const LISTING_PAGE_SIZE_DEFAULT = 25

/** `?limit=` 原始值 → 白名单内的每页条数；其余一律回落默认。 */
export function resolveListingPageSize(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return (LISTING_PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed)
    ? parsed
    : LISTING_PAGE_SIZE_DEFAULT
}
