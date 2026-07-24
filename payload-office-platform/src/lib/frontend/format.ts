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