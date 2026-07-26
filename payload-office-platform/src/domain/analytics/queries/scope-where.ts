/**
 * 经营概览/看板查询 where 构造助手（tasks.md M7.3-M7.5 / R7）
 *
 * 职责：
 *   - 把 sanitize 后的 MetricFilters 转为 Payload where 片段
 *   - 列表/楼盘类指标统一口径：城市通过 building.city，商户通过 merchant
 *   - 时间窗口按 Asia/Shanghai 自然日计算
 *
 * 业务不变量：
 *   - URL 参数不能扩大数据范围（filters 已由 sanitizeFilters 服务端兜底）
 *   - 越界 cityId / teamId / merchantId 已在 sanitize 阶段丢弃
 */

import type { MetricFilters } from '../metric-types'

/**
 * 把城市过滤转为 `building.city: { in: ids }` 片段。
 *
 * 列表 / 楼盘均通过 building.city 关联，城市不在 Listing/Building 顶层。
 * 返回 null 表示无城市过滤，调用方按需合并。
 */
export function buildCityWhere(
  filters: MetricFilters,
): Record<string, unknown> | null {
  if (filters.cityIds.length === 0) return null
  return { 'building.city': { in: [...filters.cityIds] } }
}

/**
 * 商户过滤：`merchant: { in: ids }`。
 *
 * Listing 有 merchant 关系；Building 通过 building-merchant-relations 关联，
 * 看 Building 看板时不应使用此片段（在 building 类指标中不调用）。
 */
export function buildMerchantWhere(
  filters: MetricFilters,
): Record<string, unknown> | null {
  if (filters.merchantIds.length === 0) return null
  return { merchant: { in: [...filters.merchantIds] } }
}

/**
 * 团队过滤：当前 Listing/Building/Lead 无直接 team 字段，团队过滤暂未启用。
 *
 * M5 CRM 完成后，Lead 可通过 owner.team 关联；当前返回 null（占位）。
 * 这个函数保留以备 M7.5 线索分析时启用。
 */
export function buildTeamWhere(
  _filters: MetricFilters,
): Record<string, unknown> | null {
  return null
}

/**
 * 负责人过滤：`contactBroker: { equals: id }` 或 `owner: { equals: id }`。
 *
 * 仅 Lead/Broker 类指标使用；Listing 使用 contactBroker，Lead 使用 owner。
 * 此处仅返回通用的 assigneeId；调用方按需映射到正确字段。
 */
export function buildAssigneeWhere(
  filters: MetricFilters,
): number | string | null {
  return filters.assigneeId
}

/**
 * 合并多个 where 片段为 AND 查询（Payload where 用 and: [...] 组合）。
 *
 * 空片段跳过；全空时返回空对象（匹配全部）。
 */
export function mergeWhere(
  ...parts: Array<Record<string, unknown> | null>
): Record<string, unknown> {
  const valid = parts.filter(
    (p): p is Record<string, unknown> => p !== null && Object.keys(p).length > 0,
  )
  if (valid.length === 0) return {}
  if (valid.length === 1) return valid[0]
  return { and: valid }
}

/**
 * 把时间范围转为 `createdAt: { greater_than_equal, less_than }` 片段。
 *
 * 用于 trend / range 类指标的时间过滤。
 * range 为 null 时返回空对象（无时间过滤）。
 */
export function buildRangeWhere(
  range: MetricFilters['range'],
): Record<string, unknown> {
  if (!range) return {}
  return {
    createdAt: {
      greater_than_equal: range.start.toISOString(),
      less_than: range.end.toISOString(),
    },
  }
}
