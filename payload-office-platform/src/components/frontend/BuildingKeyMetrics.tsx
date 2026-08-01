import type {
  BuildingSupplyGroupAvailability,
  BuildingSupplyPriceRange,
  CoordinatesViewModel,
  DistrictViewModel,
} from '@/domain/public-catalog'

/**
 * 楼盘详情首屏关键数据四宫格
 *
 * 设计依据：评审 P0-1。把决策性数据（起价 / 可租面积 / 在租房源数 / 最近地铁）
 * 从概况详情里抽出，首屏一眼看完，对齐 58 商办楼盘详情的信息密度。
 *
 * 守护不变量：
 *   - 服务端组件，纯展示，不发明缺失数据
 *   - 起价取所有供给组 priceRanges 中的最小 min（跨币种/单位仅取数值最小，
 *     displayUnit 一并展示以避免误读）
 *   - 无任何供给时返回 null，由父级降级为「登记找房需求」文案
 */
type BuildingKeyMetricsProps = Readonly<{
  availableGroups: readonly BuildingSupplyGroupAvailability[]
  totalEffectiveListings: number
  nearestMetro?: Pick<DistrictViewModel, 'name'>
  coordinates?: CoordinatesViewModel
}>

type MetricItem = Readonly<{
  label: string
  value: string
  unit?: string
  emphasis?: 'price' | 'default'
}>

type LowestPrice = Readonly<{ min: number; displayUnit: PriceDisplayUnit; count: number } | null>

type PriceDisplayUnit = BuildingSupplyPriceRange['displayUnit']

/** displayUnit 枚举 → 可读单位标签，与 BuildingSupplyBrowser 的 <option> 文案对齐 */
const DISPLAY_UNIT_LABELS: Readonly<Record<PriceDisplayUnit, string>> = {
  'rmb-sqm-day': '元/㎡/天',
  'rmb-month': '元/月',
  'rmb-seat-month': '元/工位/月',
  'rmb-total': '元',
}

/** 跨供给组取最小起价；同 displayUnit 才有可比性，故按 displayUnit 分组取最小后挑全局最小。 */
function findLowestPrice(groups: readonly BuildingSupplyGroupAvailability[]): LowestPrice {
  const byUnit = new Map<string, LowestPrice & { count: number }>()
  for (const group of groups) {
    for (const range of group.priceRanges) {
      const prev = byUnit.get(range.displayUnit)
      const next: LowestPrice & { count: number } = {
        min: range.min,
        displayUnit: range.displayUnit,
        count: (prev?.count ?? 0) + range.count,
      }
      if (!prev || range.min < prev.min) {
        byUnit.set(range.displayUnit, next)
      }
    }
  }
  let result: LowestPrice & { count: number } | null = null
  for (const candidate of byUnit.values()) {
    if (!result || candidate.min < result.min) result = candidate
  }
  return result
}

/** 从 availableGroups 聚合可租面积范围（跨组取全局 min/max） */
function aggregateAreaRange(groups: readonly BuildingSupplyGroupAvailability[]): {
  min: number
  max: number
} | null {
  let min = Infinity
  let max = -Infinity
  for (const group of groups) {
    if (!group.areaRange) continue
    min = Math.min(min, group.areaRange.min)
    max = Math.max(max, group.areaRange.max)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

function formatAreaRange(range: { min: number; max: number }): string {
  if (range.min === range.max) return `${range.min} ㎡`
  return `${range.min}–${range.max} ㎡`
}

export default function BuildingKeyMetrics({
  availableGroups,
  totalEffectiveListings,
  nearestMetro,
}: BuildingKeyMetricsProps) {
  const lowest = findLowestPrice(availableGroups)
  const areaRange = aggregateAreaRange(availableGroups)

  const metrics: MetricItem[] = []

  if (lowest) {
    metrics.push({
      label: '起价',
      value: String(lowest.min),
      unit: DISPLAY_UNIT_LABELS[lowest.displayUnit],
      emphasis: 'price',
    })
  }

  if (areaRange) {
    metrics.push({
      label: '可租面积',
      value: formatAreaRange(areaRange),
    })
  }

  if (totalEffectiveListings > 0) {
    metrics.push({
      label: '在租房源',
      value: `${totalEffectiveListings} 套`,
    })
  }

  if (nearestMetro?.name) {
    metrics.push({
      label: '最近地铁',
      value: nearestMetro.name,
    })
  }

  if (metrics.length === 0) return null

  return (
    <section className="building-stats building-key-metrics" aria-label="楼盘关键数据">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="building-stats__item"
          data-emphasis={metric.emphasis ?? undefined}
        >
          <span className="building-stats__label">{metric.label}</span>
          <span
            className="building-stats__value"
            data-emphasis={metric.emphasis === 'price' ? 'price' : undefined}
          >
            {metric.value}
            {metric.unit && (
              <span className="building-key-metrics__unit"> {metric.unit}</span>
            )}
          </span>
        </div>
      ))}
    </section>
  )
}
