/**
 * 指标查询上下文构建与过滤清洗（tasks.md M7.1 / R7）
 *
 * 设计原则：
 *   - 客户端提交的 city/team/merchant/assignee 不可信
 *   - 服务端按 PermissionContext 上限裁剪，不允许扩大范围
 *   - 不在 metric.allowedScopeDims 中的维度一律丢弃
 *   - 时间窗口最长 365 天，避免范围过大撑爆查询
 *   - dataScope=self 时 assigneeId 强制 = userId
 *
 * 业务不变量：URL 参数不能扩大数据范围（design.md §6.1, §7.3）
 */

import type { PermissionContext } from '@/domain/auth/permission-context'
import { parseUtcIso } from '@/domain/shared/time'
import type {
  MetricDefinition,
  MetricFilterInput,
  MetricFilters,
  MetricScopeDim,
} from './metric-types'

/** 自定义时间范围最大跨度（自然日） */
export const MAX_RANGE_DAYS = 365

/** 空过滤（用于全局指标或 sanitize 失败兜底） */
export const EMPTY_FILTERS: MetricFilters = Object.freeze({
  cityIds: Object.freeze([]),
  teamIds: Object.freeze([]),
  merchantIds: Object.freeze([]),
  assigneeId: null,
  range: null,
}) as MetricFilters

/**
 * 将客户端不可信的过滤输入清洗为可信 MetricFilters。
 *
 * 清洗规则：
 *   1. 维度白名单：不在 metric.allowedScopeDims 中的维度丢弃
 *   2. 城市上限：cityIds ∩ permission.cityIds（permission.cityIds='all' 时不限制）
 *   3. 团队上限：teamIds ∩ permission.teamIds
 *   4. 商户：暂不强制范围校验（M2 merchants 后接入），按 metric.allowedScopeDims 决定是否接受
 *   5. assigneeId：
 *      - dataScope=self → 强制 = userId
 *      - dataScope=team → 接受任意 assigneeId（仍受 teamIds 间接限制）
 *      - dataScope=city/global → 接受任意 assigneeId
 *   6. range：仅当 metric.timeRange='range' 时生效；解析失败丢弃
 *
 * @param input 客户端提交（来自 URL / 表单）
 * @param permission 服务端权限上下文
 * @param metric 指标定义（决定允许的维度）
 */
export function sanitizeFilters(
  input: MetricFilterInput | null | undefined,
  permission: PermissionContext,
  metric: MetricDefinition,
): MetricFilters {
  // null / undefined 视为空对象，让后续维度逻辑按 permission 上限兜底
  // （city/team 未传 → 使用 permission 上限；其他维度 → 空数组）
  const safeInput: MetricFilterInput = !input || typeof input !== 'object' ? {} : input

  const allowed = new Set<MetricScopeDim>(metric.allowedScopeDims)

  // ── 城市维度 ──
  let cityIds: ReadonlyArray<number | string> = []
  if (allowed.has('city')) {
    cityIds = intersectCityScope(safeInput.cityIds, permission.cityIds)
  }

  // ── 团队维度 ──
  let teamIds: ReadonlyArray<number | string> = []
  if (allowed.has('team')) {
    teamIds = intersectTeamScope(safeInput.teamIds, permission.teamIds)
  }

  // ── 商户维度 ──
  let merchantIds: ReadonlyArray<number | string> = []
  if (allowed.has('merchant')) {
    merchantIds = normalizeIdArray(safeInput.merchantIds)
  }

  // ── 负责人维度 ──
  let assigneeId: number | string | null = null
  if (allowed.has('assignee')) {
    assigneeId = resolveAssignee(safeInput.assigneeId, permission)
  }

  // ── 时间范围 ──
  let range: { start: Date; end: Date } | null = null
  if (metric.timeRange === 'range') {
    range = parseRange(safeInput.rangeStart, safeInput.rangeEnd)
  }

  return Object.freeze({
    cityIds: Object.freeze([...cityIds]),
    teamIds: Object.freeze([...teamIds]),
    merchantIds: Object.freeze([...merchantIds]),
    assigneeId,
    range,
  }) as MetricFilters
}

// ────────────────────────────────────────────────────────────
// 内部辅助
// ────────────────────────────────────────────────────────────

function intersectCityScope(
  input: ReadonlyArray<number | string> | undefined,
  scope: PermissionContext['cityIds'],
): Array<number | string> {
  const inputIds = normalizeIdArray(input)
  if (inputIds.length === 0) {
    // 客户端未传城市 → 使用 permission 上限
    if (scope === 'all') return []
    return [...scope]
  }
  if (scope === 'all') return inputIds
  // 求交集
  const scopeSet = new Set(scope)
  return inputIds.filter((id) => scopeSet.has(id))
}

function intersectTeamScope(
  input: ReadonlyArray<number | string> | undefined,
  scope: PermissionContext['teamIds'],
): Array<number | string> {
  const inputIds = normalizeIdArray(input)
  if (inputIds.length === 0) {
    if (scope === 'all') return []
    return [...scope]
  }
  if (scope === 'all') return inputIds
  const scopeSet = new Set(scope)
  return inputIds.filter((id) => scopeSet.has(id))
}

function normalizeIdArray(
  input: ReadonlyArray<number | string> | undefined,
): Array<number | string> {
  if (!Array.isArray(input)) return []
  const result: Array<number | string> = []
  for (const v of input) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      result.push(v)
      continue
    }
    if (typeof v === 'string' && v.length > 0) {
      result.push(v)
    }
  }
  // 去重
  return [...new Set(result)]
}

function resolveAssignee(
  input: number | string | null | undefined,
  permission: PermissionContext,
): number | string | null {
  // dataScope=self → 强制 = userId
  if (permission.dataScope === 'self') {
    return permission.userId
  }
  // 其他范围接受客户端输入（仍受 city/team 上限限制）
  if (input === null || input === undefined) return null
  if (typeof input === 'number' && Number.isFinite(input)) return input
  if (typeof input === 'string' && input.length > 0) return input
  return null
}

function parseRange(
  start: string | Date | undefined,
  end: string | Date | undefined,
): { start: Date; end: Date } | null {
  const s = toDate(start)
  const e = toDate(end)
  if (!s || !e) return null
  if (e.getTime() <= s.getTime()) return null
  // 跨度上限
  const spanDays = (e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)
  if (spanDays > MAX_RANGE_DAYS) return null
  return { start: s, end: e }
}

function toDate(v: string | Date | undefined): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null
  if (typeof v !== 'string' || v.length === 0) return null
  return parseUtcIso(v)
}

/**
 * 判断权限上下文是否能查看指定指标。
 *
 * 规则：
 *   - metric.requiredPermissions 为空 → 任意已登录用户可查看
 *   - 否则任一权限匹配即可（允许并集）
 */
export function canViewMetric(
  permission: PermissionContext,
  metric: MetricDefinition,
): boolean {
  if (metric.requiredPermissions.length === 0) return true
  if (permission.operationPermissions.has('*')) return true
  for (const code of metric.requiredPermissions) {
    if (permission.operationPermissions.has(code)) return true
  }
  return false
}
