/**
 * 指标数据一致性验证（tasks.md M7.6 / design.md §7.3 / R7）
 *
 * 业务不变量：
 *   - 卡片 = 趋势桶之和
 *   - 卡片 = 图表点击 = 明细数量
 *   - 单卡失败局部重试并展示数据截至时间
 *
 * M7.1 阶段：仅提供纯函数断言工具，供 M7.3-M7.5 集成测试复用。
 */

import type { MetricQueryResult, MetricScalarResult, MetricSeriesResult } from './metric-types'

/** 一致性断言结果 */
export interface ConsistencyCheckResult {
  ok: boolean
  /** 不一致原因 */
  reason?: string
  /** 期望值（卡片值或桶之和） */
  expected?: number
  /** 实际值 */
  actual?: number
  /** 容差（浮点比较） */
  tolerance?: number
}

/**
 * 断言：单值 = 序列桶之和。
 *
 * 用于验证「卡片 = 趋势桶之和」。
 * 浮点比较使用 tolerance（默认 1e-9）；count 类指标使用 0 容差。
 */
export function assertCardEqualsSeriesSum(
  scalar: MetricScalarResult,
  series: MetricSeriesResult,
  tolerance = 1e-9,
): ConsistencyCheckResult {
  if (series.buckets.length === 0) {
    // 空序列：和 = 0
    if (scalar.value === 0) return { ok: true }
    return {
      ok: false,
      reason: 'series_empty_but_scalar_nonzero',
      expected: 0,
      actual: scalar.value,
      tolerance,
    }
  }

  const sum = series.buckets.reduce((acc, b) => acc + b.value, 0)
  const diff = Math.abs(sum - scalar.value)
  if (diff <= tolerance) {
    return { ok: true }
  }
  return {
    ok: false,
    reason: 'scalar_not_equal_to_series_sum',
    expected: sum,
    actual: scalar.value,
    tolerance,
  }
}

/**
 * 断言：两个查询结果在容差内相等。
 *
 * 用于验证「卡片 = 图表点击值 = 明细数量」。
 */
export function assertResultsEqual(
  a: MetricQueryResult,
  b: MetricQueryResult,
  tolerance = 1e-9,
): ConsistencyCheckResult {
  if (a.kind !== b.kind) {
    return {
      ok: false,
      reason: `kind_mismatch:${a.kind} vs ${b.kind}`,
      tolerance,
    }
  }
  if (a.kind === 'scalar' && b.kind === 'scalar') {
    const diff = Math.abs(a.value - b.value)
    if (diff <= tolerance) return { ok: true }
    return {
      ok: false,
      reason: 'scalar_value_mismatch',
      expected: a.value,
      actual: b.value,
      tolerance,
    }
  }
  if (a.kind === 'series' && b.kind === 'series') {
    return assertSeriesEqual(a, b, tolerance)
  }
  return { ok: true }
}

/**
 * 断言：两个序列桶数量与对应值相等。
 *
 * 不要求桶顺序一致（按 label 排序后比较）。
 */
export function assertSeriesEqual(
  a: MetricSeriesResult,
  b: MetricSeriesResult,
  tolerance = 1e-9,
): ConsistencyCheckResult {
  if (a.buckets.length !== b.buckets.length) {
    return {
      ok: false,
      reason: 'series_length_mismatch',
      expected: a.buckets.length,
      actual: b.buckets.length,
      tolerance,
    }
  }
  const aSorted = [...a.buckets].sort((x, y) => x.label.localeCompare(y.label))
  const bSorted = [...b.buckets].sort((x, y) => x.label.localeCompare(y.label))
  for (let i = 0; i < aSorted.length; i++) {
    const ai = aSorted[i]
    const bi = bSorted[i]
    if (ai.label !== bi.label) {
      return {
        ok: false,
        reason: `bucket_label_mismatch:${ai.label} vs ${bi.label}`,
        tolerance,
      }
    }
    const diff = Math.abs(ai.value - bi.value)
    if (diff > tolerance) {
      return {
        ok: false,
        reason: `bucket_value_mismatch:${ai.label}`,
        expected: ai.value,
        actual: bi.value,
        tolerance,
      }
    }
  }
  return { ok: true }
}

/**
 * 断言：URL 参数未扩大数据范围。
 *
 * 用于验证 sanitizeFilters 行为：
 *   - cityIds 限定在 permission.cityIds 内
 *   - teamIds 限定在 permission.teamIds 内
 *
 * 此函数为 M7.6 的辅助断言；M7.1 阶段仅在测试中使用。
 */
export function assertUrlNotExpandScope(
  input: { cityIds?: ReadonlyArray<number | string>; teamIds?: ReadonlyArray<number | string> },
  sanitized: { cityIds: ReadonlyArray<number | string>; teamIds: ReadonlyArray<number | string> },
  scope: {
    cityIds: 'all' | Set<number | string>
    teamIds: 'all' | Set<number | string>
  },
): ConsistencyCheckResult {
  // 城市校验
  if (scope.cityIds !== 'all') {
    const scopeSet = scope.cityIds
    for (const id of sanitized.cityIds) {
      if (!scopeSet.has(id)) {
        return {
          ok: false,
          reason: `city_id_out_of_scope:${id}`,
          actual: Number(id),
        }
      }
    }
    // 客户端输入超出范围的不应在 sanitized 中保留
    for (const id of input.cityIds ?? []) {
      if (!scopeSet.has(id)) {
        // 此 id 应被 sanitize 过滤掉，不出现在 sanitized 中
        if (sanitized.cityIds.includes(id)) {
          return {
            ok: false,
            reason: `city_id_injection_blocked:${id}`,
            actual: Number(id),
          }
        }
      }
    }
  }

  // 团队校验（同上）
  if (scope.teamIds !== 'all') {
    const scopeSet = scope.teamIds
    for (const id of sanitized.teamIds) {
      if (!scopeSet.has(id)) {
        return {
          ok: false,
          reason: `team_id_out_of_scope:${id}`,
          actual: Number(id),
        }
      }
    }
    for (const id of input.teamIds ?? []) {
      if (!scopeSet.has(id)) {
        if (sanitized.teamIds.includes(id)) {
          return {
            ok: false,
            reason: `team_id_injection_blocked:${id}`,
            actual: Number(id),
          }
        }
      }
    }
  }

  return { ok: true }
}
