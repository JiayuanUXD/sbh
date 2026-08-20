/**
 * 房源展示辅助：类型中文名、位置行、价格文本切分。
 *
 * 从 `components/frontend/home/HomeListingsRail.tsx` 迁出（OPT-036 Task 4 code
 * review）——查询/筛选/格式化逻辑集中在 `src/lib/frontend/` 是本仓库既定约定
 * （见 `payload-office-platform/CLAUDE.md`），`listing/` 目录下的内容组件反向
 * import `home/` 页面编排目录属于方向错误的依赖边，且 Task 6（筛选条）与
 * Task 11/12（接线）都要用到同一套映射，边不收敛只会被继续加固。
 *
 * 仅收敛这三个曾经跨目录被 import 的导出；`ListingCard.tsx` / `detail-metadata.ts` /
 * `FilterBar.tsx` / `MobileFilterDrawer.tsx` 等处的同口径重复定义保持不动——
 * 那是另一个更大的合并任务，其中几处在 Task 13 会被直接删除文件，此时合并是白做。
 */

import type { ListingCardViewModel, PriceViewModel } from '@/domain/public-catalog/contracts'

/** 房源类型中文名（与 ListingCard 的 TYPE_LABEL 同口径）。 */
export const LISTING_TYPE_LABEL: Record<ListingCardViewModel['listingType'], string> = {
  'traditional-office': '传统办公',
  coworking: '共享办公',
  'full-floor': '整层办公',
  'serviced-office': '独栋办公',
}

/**
 * 把 PriceViewModel.text（如「8.5 元/㎡/天」「18000 元/月」）拆成数值段和单位段，
 * 供 HomeSupplyCard 的大字号数值 + 小字号单位两段式展示。
 *
 * 不重新计算价格——PriceViewModel.text 由 domain 侧按
 * `${amount} ${unitLabel}` 拼出（见 mappers.ts formatPriceText / detail-values.ts），
 * 这里只做纯文本切分，单位始终跟随价格本身（元/月 vs 元/㎡/天 vs 元/工位/月 等）。
 */
export function splitPriceText(price: PriceViewModel | null): Readonly<{ value: string; unit: string }> | null {
  if (!price) return null
  const spaceIndex = price.text.indexOf(' ')
  if (spaceIndex === -1) return { value: price.text, unit: '' }
  return { value: price.text.slice(0, spaceIndex), unit: price.text.slice(spaceIndex + 1) }
}

/** 房源卡片 whereLine（行政区 · 近地铁站），与 ListingCard 的 locationLine 同口径。 */
export function listingWhereLine(building: ListingCardViewModel['building']): string | null {
  const parts: string[] = []
  if (building?.district?.name) parts.push(building.district.name)
  else if (building?.address) parts.push(building.address)
  if (building?.nearestMetro?.name) parts.push(`近${building.nearestMetro.name}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
