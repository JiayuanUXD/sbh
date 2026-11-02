/**
 * 站内搜索零结果页漏斗埋点的 data-* 契约（OPT-126 P2 / OPT-122 §9.1）
 *
 * 与 `list-analytics.ts` 同构：零结果页的链接只吐 data 属性，由页面级的一个委托监听器
 * 统一读取。这样 `SearchZeroState` 继续是服务端组件，也不必给卡片组件逐个挂 onClick。
 *
 * 只放固定枚举与 1 基位置，不放楼盘名、slug、q——建议词本身是公开实体名，但仍不进埋点：
 * 要看「点了哪个」用位置 + 当时的零结果形态，足以回答「建议有没有用」。
 */

export const SEARCH_FUNNEL_EVENTS = ['search_suggestion_click', 'search_fallback_click'] as const
export type SearchFunnelEvent = (typeof SEARCH_FUNNEL_EVENTS)[number]

/** 兜底块：entity=命中楼盘但无在租房源的实体卡，其余是热门浏览块。 */
export const SEARCH_FALLBACK_BLOCKS = ['entity', 'district', 'building', 'listing'] as const
export type SearchFallbackBlock = (typeof SEARCH_FALLBACK_BLOCKS)[number]

export const SEARCH_FUNNEL_ATTR = {
  event: 'data-search-funnel-event',
  block: 'data-search-funnel-block',
  position: 'data-search-funnel-position',
} as const

export type SearchFunnelTag =
  | { event: 'search_suggestion_click'; position: number }
  | { event: 'search_fallback_click'; block: SearchFallbackBlock; position: number }

/** 展开成可直接 spread 到元素上的 data-* 属性。 */
export function searchFunnelAttrs(tag: SearchFunnelTag): Record<string, string | number> {
  const attrs: Record<string, string | number> = {
    [SEARCH_FUNNEL_ATTR.event]: tag.event,
    [SEARCH_FUNNEL_ATTR.position]: tag.position,
  }
  if (tag.event === 'search_fallback_click') attrs[SEARCH_FUNNEL_ATTR.block] = tag.block
  return attrs
}

export type SearchFunnelPayload = {
  event: SearchFunnelEvent
  props: Record<string, string | number>
}

function positiveInteger(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * 把 DOM 上读到的属性还原成事件。fail-closed：任何一项不合规整条不报，
 * 宁可少一条也不报脏数据（dataset 是字符串，不可信）。
 */
export function parseSearchFunnelClick(
  city: string | undefined,
  read: (name: string) => string | null,
): SearchFunnelPayload | null {
  if (!city) return null
  const event = read(SEARCH_FUNNEL_ATTR.event)
  const position = positiveInteger(read(SEARCH_FUNNEL_ATTR.position))
  if (position === null) return null

  if (event === 'search_suggestion_click') {
    return { event, props: { city, position } }
  }
  if (event === 'search_fallback_click') {
    const block = read(SEARCH_FUNNEL_ATTR.block)
    if (!SEARCH_FALLBACK_BLOCKS.includes(block as SearchFallbackBlock)) return null
    return { event, props: { city, block: block as SearchFallbackBlock, position } }
  }
  return null
}
