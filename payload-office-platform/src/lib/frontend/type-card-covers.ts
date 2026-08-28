import type { MediaViewModel } from '@/domain/public-catalog/contracts'
import { mapMedia } from '@/domain/public-catalog/mappers'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * 「按类型浏览」的单城封面覆盖（OPT-060）。
 *
 * **刻意不返回 MappingResult。** 本文件其余映射失败会让整份 profile 变 null,
 * 那对必填的结构性字段是对的；但封面覆盖是纯装饰性的运营配置，配错一行不该
 * 让整座城市首页降级。所以这里的策略是**逐行丢弃**：不合格的行不进结果，
 * 其余行照常。
 *
 * 同槽位重复配置时取**首次出现**的那行（与 orderByFeaturedRegions 处理重复
 * slug 的口径一致）。
 */
export function mapTypeCardOverrides(
  value: unknown,
): readonly Readonly<{ slot: string; coverImage: MediaViewModel }>[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rows: Array<{ slot: string; coverImage: MediaViewModel }> = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const slot = raw.slot
    if (typeof slot !== 'string' || slot.length === 0 || seen.has(slot)) continue
    // mapMedia 是 URL 白名单，映射不出安全 URL 就丢这一行
    const cover = mapMedia(raw.coverImage, slot)
    if (!cover) continue
    seen.add(slot)
    rows.push({ slot, coverImage: cover })
  }
  return rows
}

/**
 * OPT-060：把单城封面覆盖盖在全局默认之上。
 *
 * ## 为什么在视图层做，而不是 facade
 *
 * `getHomepage` 的结果整个包在 `unstable_cache` 里，而它的失效标签**全是供给侧的**
 * （`cached-queries.ts`，listings/buildings 变更才失效）。把配置塞进那层缓存，
 * 运营改完配置、供给没变，首页会一直吐旧缓存——运营改完看不到效果，还以为功能坏了。
 * 所以配置的合并留在缓存之外。
 *
 * ## 边界
 *
 * 只改封面：**不碰文案、不改顺序、不增删行**。覆盖里出现卡片列表没有的槽位一律
 * 忽略——运营在城市配置里选了个当前没展示的槽位，不该凭空多出一张卡。
 *
 * 四级优先级里这里只负责前两级（城市覆盖 → 全局默认）；最后一级（→ 该类型首条
 * 房源封面 → 无图）留在 `HomeTypeCards`，因为 `typeSummaries` 与槽位→listingType
 * 的映射都住在那儿。
 */
export type TypeCardWithCover = Readonly<{
  slot: string
  label: string
  sublabel: string | null
  coverImage: MediaViewModel | null
}>

export function resolveTypeCardCovers(
  cards: readonly TypeCardWithCover[],
  overrides: readonly Readonly<{ slot: string; coverImage: MediaViewModel }>[],
): readonly TypeCardWithCover[] {
  if (overrides.length === 0) return cards

  // slot → 覆盖图。重复 slug 取首次出现，与 orderByFeaturedRegions 同口径。
  const bySlot = new Map<string, MediaViewModel>()
  for (const o of overrides) {
    if (!bySlot.has(o.slot)) bySlot.set(o.slot, o.coverImage)
  }

  return cards.map((card) => {
    const override = bySlot.get(card.slot)
    return override ? { ...card, coverImage: override } : card
  })
}
