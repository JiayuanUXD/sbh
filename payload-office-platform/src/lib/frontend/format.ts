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