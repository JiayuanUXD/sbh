/**
 * 字段脱敏工具（tasks.md M1.4, design.md §6.1）
 *
 * 业务不变量（AGENTS.md §6 强制规则）：
 *   - 手机号默认返回脱敏值；完整手机号使用独立字段权限 phone:full
 *   - 坐标、IP、设备、审计前后值同样按字段权限脱敏
 *   - 禁止仅靠前端隐藏保护敏感字段
 *
 * 实现方式：
 *   - 在 Collection afterRead / afterChange hook 中调用 maskDocFields
 *   - 通过 PermissionContext.fieldPermissions 判定是否保留原值
 *   - 未登录或缺失权限时返回脱敏值；overrideAccess=true 仍返回原值
 */

import { maskPhone, normalizePhone } from '@/domain/shared/phone'
import type { PermissionContext } from './permission-context'

/** 字段脱敏规则：从字段名 → 字段权限编码 + 脱敏函数 */
export type FieldMaskRule = {
  /** 字段名（顶层即可；嵌套字段需在调用方展平后传入） */
  field: string
  /** 需要此权限才看原值；否则返回脱敏值 */
  requiredPermission: string
  /** 缺权限时调用的脱敏函数 */
  mask: (value: unknown) => unknown
}

/**
 * 单文档字段脱敏：根据 PermissionContext.fieldPermissions 判定是否保留原值。
 *
 * - ctx=null 或缺失权限 → 调用 mask() 返回脱敏值
 * - 通配符 * 权限 → 保留原值
 * - 字段不存在 → 不修改
 *
 * 注意：本函数就地修改 doc 对象，并返回同一引用。
 */
export function maskDocFields(
  doc: Record<string, unknown>,
  rules: readonly FieldMaskRule[],
  ctx: PermissionContext | null,
): Record<string, unknown> {
  if (!doc || typeof doc !== 'object') return doc
  for (const rule of rules) {
    if (!(rule.field in doc)) continue
    const value = doc[rule.field]
    if (value === null || value === undefined) continue
    if (!canSeeField(ctx, rule)) {
      doc[rule.field] = rule.mask(value)
    }
  }
  return doc
}

/**
 * 批量文档字段脱敏。
 *
 * 用于 Collection afterRead hook 中处理 docs 数组。
 */
export function maskDocsFields(
  docs: readonly Record<string, unknown>[],
  rules: readonly FieldMaskRule[],
  ctx: PermissionContext | null,
): Record<string, unknown>[] {
  return docs.map((d) => maskDocFields({ ...d }, rules, ctx))
}

// ────────────────────────────────────────────────────────────
// 预置脱敏规则
// ────────────────────────────────────────────────────────────

/** 手机号脱敏：缺失 phone:full 权限时返回 138****1111 格式 */
export const PHONE_MASK_RULE: FieldMaskRule = {
  field: 'phone',
  requiredPermission: 'phone:full',
  mask: (v) => {
    if (typeof v !== 'string') return v
    return maskPhone(v)
  },
}

/** 规范化手机号脱敏：与 phone 字段保持一致；缺失 phone:full → 脱敏 */
export const PHONE_NORMALIZED_MASK_RULE: FieldMaskRule = {
  field: 'phoneNormalized',
  requiredPermission: 'phone:full',
  mask: (v) => {
    if (typeof v !== 'string') return v
    return maskPhone(v)
  },
}

/**
 * 仅脱敏手机号字段规则集（phone + phoneNormalized）。
 *
 * 缺失 phone:full 权限时 → 返回 138****1111
 * 缺失 phone:full 但有 phone:masked → 也返回 138****1111（默认即脱敏）
 */
export const PHONE_MASK_RULES: readonly FieldMaskRule[] = [
  PHONE_MASK_RULE,
  PHONE_NORMALIZED_MASK_RULE,
]

/** 楼盘坐标脱敏：缺失 building:coordinate 权限时清空经纬度 */
export const BUILDING_COORDINATE_MASK_RULES: readonly FieldMaskRule[] = [
  {
    field: 'latitude',
    requiredPermission: 'building:coordinate',
    mask: () => null,
  },
  {
    field: 'longitude',
    requiredPermission: 'building:coordinate',
    mask: () => null,
  },
]

/**
 * 审计日志 before/after 值脱敏：缺失 audit:before_after 权限时返回 null。
 *
 * 用于审计 Collection afterRead hook；M1 暂未引入审计 Collection，
 * 此规则在 M8 操作日志落地后启用。
 */
export const AUDIT_BEFORE_AFTER_MASK_RULES: readonly FieldMaskRule[] = [
  {
    field: 'beforeValue',
    requiredPermission: 'audit:before_after',
    mask: () => null,
  },
  {
    field: 'afterValue',
    requiredPermission: 'audit:before_after',
    mask: () => null,
  },
]

// ────────────────────────────────────────────────────────────
// 工具：构造典型 Collection 字段脱敏规则集
// ────────────────────────────────────────────────────────────

/**
 * 用户文档脱敏规则（phone + phoneNormalized）。
 *
 * 用于 Users Collection afterRead：缺 phone:full → 返回 138****1111
 */
export function getUserMaskRules(): readonly FieldMaskRule[] {
  return PHONE_MASK_RULES
}

/**
 * 线索文档脱敏规则（phone）。
 *
 * 用于 Leads Collection afterRead：缺 phone:full → 返回 138****1111
 * 业务不变量：经纪人只能看自己负责线索的完整手机号（M5 进一步收窄）
 */
export function getLeadMaskRules(): readonly FieldMaskRule[] {
  return [PHONE_MASK_RULE]
}

/**
 * 楼盘文档脱敏规则（坐标）。
 *
 * 用于 Buildings Collection afterRead：缺 building:coordinate → 坐标清空
 */
export function getBuildingMaskRules(): readonly FieldMaskRule[] {
  return BUILDING_COORDINATE_MASK_RULES
}

// ────────────────────────────────────────────────────────────
// 工具：是否保留原值的判定
// ────────────────────────────────────────────────────────────

/**
 * 判断 ctx 是否拥有规则所需权限。
 *
 * - ctx=null → false（默认脱敏）
 * - 通配符 * → true
 * - 精确匹配 → ctx.fieldPermissions.has(code)
 */
export function canSeeField(
  ctx: PermissionContext | null,
  rule: FieldMaskRule,
): boolean {
  if (!ctx) return false
  if (ctx.fieldPermissions.has('*')) return true
  return ctx.fieldPermissions.has(rule.requiredPermission)
}

/**
 * 工具：脱敏单个字符串值（不依赖文档），用于关系字段展开或单独展示。
 *
 * 例如：
 *   const masked = maskSinglePhone(value, ctx) // 缺 phone:full → 138****1111
 */
export function maskSinglePhone(
  value: string,
  ctx: PermissionContext | null,
): string {
  if (!value) return value
  const allowed = canSeeField(ctx, PHONE_MASK_RULE)
  return allowed ? value : maskPhone(value)
}

/**
 * 工具：脱敏单个手机号并返回规范化格式。
 *
 * 用于查询或日志展示：保证脱敏前后使用统一规范化字符串。
 */
export function normalizeAndMaskPhone(
  value: string,
  ctx: PermissionContext | null,
): string {
  const normalized = normalizePhone(value)
  return maskSinglePhone(normalized, ctx)
}
