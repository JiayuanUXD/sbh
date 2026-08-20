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

