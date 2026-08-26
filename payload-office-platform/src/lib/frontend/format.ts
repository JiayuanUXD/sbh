import type { PriceDisplayUnit } from '@/domain/public-catalog/contracts'
import { parseUtcIso, shanghaiDate } from '@/domain/shared/time'

export function rentUnitLabel(unit?: string): string {
  switch (unit) {
    case 'rmb-sqm-day':
      return '元/㎡/天'
    case 'rmb-month':
      return '元/月'
    case 'rmb-seat-month':
      return '元/工位/月'
    default:
      return ''
  }
}

/**
 * 计价单位中文名，覆盖 `PriceDisplayUnit` 全部 12 个取值。
 *
 * 与 `rentUnitLabel` 的关系：后者只认三个**租赁**单位（旧 `listings.rentUnit`
 * 列的取值域），出售频道的 `rmb-total`／`rmb-sqm-total` 一律返回空串。列表页的
 * 单位分段与被排除单位提示条对租、售两个频道复用同一套组件，只有 3 个单位的
 * 表在出售频道会把标签渲成空——那是「接口没给这个信息就把文案降级」，本批次
 * 已经三次否掉过同类处置，因此在这里补齐全集而不是让调用方在出售频道退化。
 *
 * 构造规则与域层 `mappers.ts` 的 `formatPriceText` 完全一致（basis 段 +
 * period 段，一次性计价省略 period 段），但写成显式全表而非再实现一遍拼接：
 * 12 个取值一个不漏由 `Record<PriceDisplayUnit, string>` 在编译期保证。
 */
const PRICE_UNIT_LABEL: Readonly<Record<PriceDisplayUnit, string>> = {
  'rmb-sqm-day': '元/㎡/天',
  'rmb-sqm-month': '元/㎡/月',
  'rmb-sqm-year': '元/㎡/年',
  'rmb-sqm-total': '元/㎡',
  'rmb-seat-day': '元/工位/天',
  'rmb-seat-month': '元/工位/月',
  'rmb-seat-year': '元/工位/年',
  'rmb-seat-total': '元/工位',
  'rmb-day': '元/天',
  'rmb-month': '元/月',
  'rmb-year': '元/年',
  'rmb-total': '元',
}

/** 计价单位中文名；未知取值返回空串（与 rentUnitLabel 同一处置）。 */
export function priceUnitLabel(unit?: string): string {
  return unit != null && unit in PRICE_UNIT_LABEL
    ? PRICE_UNIT_LABEL[unit as PriceDisplayUnit]
    : ''
}

/**
 * ISO 日期串 → 四位竣工年份；缺失 / 空串 / 非法日期一律 null（**绝不当 0**）。
 *
 * 「解析 + 合法性判定」是全站共有的那一半，故收敛到这里；**展示文案留在各自
 * 调用点**——三个消费方要的后缀本就不同，硬凑成一个函数反而要加参数分支：
 *   - `components/frontend/detail/fact-lookup.ts` → "2013 年" / "2013 年（估算）"；
 *   - `components/frontend/listing/BuildingCompactRow.tsx` → "2013年竣工"；
 *   - `domain/public-catalog/building-search.ts` → number（筛选与排序用，不展示）。
 * 收敛前三处各写一份，且校验分支写法还不一样（`new Date(v).getFullYear()` 的
 * NaN 兜底 vs `Date.parse` 后判 `Number.isFinite`）——同一判断逻辑三个事实源，
 * 任一处改口径都不会带上另外两处。
 */
export function completionYear(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || iso.length === 0) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t).getFullYear()
}

export function formatRent(rent?: number | null, unit?: string): string {
  if (rent == null) return '待面议'
  const label = rentUnitLabel(unit)
  return label ? `${rent} ${label}` : `${rent}`
}

export function formatArea(area?: number | null): string {
  return area == null ? '面议' : `${area} ㎡`
}

/**
 * Uses an explicit decision fallback only where the public DTO marks the
 * missing value as critical. Ordinary absent facts are omitted from detail UI.
 */
export function formatFact(
  value: string | number | null | undefined,
  options: Readonly<{ critical: boolean }>,
): string | null {
  if (value == null || value === '') return options.critical ? '咨询确认' : null
  return String(value)
}

/**
 * 格式化房源可入驻日期为面向用户的中文日期（Asia/Shanghai 时区）。
 *
 * 守护不变量：
 *   - null / 空字符串 / 非法 ISO -> 「面议」；
 *   - 其余按 Asia/Shanghai 时区渲染为「YYYY年M月D日」，避免直接输出 ISO 串；
 *   - 延续项目「原生 Intl，不引 date-fns/dayjs」约定，复用 domain/shared/time。
 *
 * OPT-013：详情页 availableFrom 此前直接渲染 `2026-08-01T00:00:00.000Z`，不适合面向用户。
 */
export function formatAvailableDate(iso: string | null | undefined): string {
  if (!iso) return '面议'
  const d = parseUtcIso(iso)
  if (!d) return '面议'
  const parts = shanghaiDate(d).split('-').map(Number)
  const [y, m, day] = parts
  if (!y || !m || !day) return '面议'
  return `${y}年${m}月${day}日`
}

/**
 * 格式化文章发布日期为紧凑数字日期（Asia/Shanghai 时区）。
 *
 * 守护不变量：
 *   - null / 空字符串 / 非法 ISO -> 空字符串（调用方自行决定是否渲染）；
 *   - 其余按 Asia/Shanghai 时区渲染为「YYYY.MM.DD」，纯数字适配 --font-numeric；
 *   - 与 formatAvailableDate（散文式「YYYY年M月D日」，用于房源可入驻日期）区分：
 *     文章发布日期是可扫描元数据，紧凑数字更合适且跨列表/详情一致。
 *   - 延续项目「原生 Intl，不引 date-fns/dayjs」约定，复用 domain/shared/time。
 */
export function formatPublishedDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = parseUtcIso(iso)
  if (!d) return ''
  const parts = shanghaiDate(d).split('-').map(Number)
  const [y, m, day] = parts
  if (!y || !m || !day) return ''
  return `${y}.${String(m).padStart(2, '0')}.${String(day).padStart(2, '0')}`
}

