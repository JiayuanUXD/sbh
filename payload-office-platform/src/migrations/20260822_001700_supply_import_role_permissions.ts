import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * `data:import` 权限码在 permission-codes.ts 里已存在，但目前没有任何角色持有它。
 * 批量导入功能面向供给运营，授予 ADM（系统管理员）与 OPS（供给运营）两个内置角色的
 * operationPermissions；不涉及菜单权限（导入入口尚未接线自己的 Custom View 菜单项）。
 */
const TARGET_ROLE_CODES = ['ADM', 'OPS'] as const
type TargetRoleCode = (typeof TARGET_ROLE_CODES)[number]

const REQUIRED_OPERATION_PERMISSIONS: Readonly<Record<TargetRoleCode, readonly string[]>> = {
  ADM: ['data:import'],
  OPS: ['data:import'],
}

export type SupplyImportMigrationRole = {
  id: number | string
  code: unknown
  isBuiltin?: boolean | null
  operationPermissions?: unknown
}

export type SupplyImportRoleUpdate = {
  id: number | string
  operationPermissions: string[]
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function appendMissing(current: readonly string[], required: readonly string[]): string[] {
  const result = [...current]
  const present = new Set(current)
  for (const permission of required) {
    if (!present.has(permission)) {
      present.add(permission)
      result.push(permission)
    }
  }
  return result
}

function isTargetRoleCode(value: unknown): value is TargetRoleCode {
  return typeof value === 'string' && TARGET_ROLE_CODES.some((code) => code === value)
}

export function planSupplyImportRoleUpdate(
  role: SupplyImportMigrationRole,
): SupplyImportRoleUpdate | null {
  if (role.isBuiltin !== true || !isTargetRoleCode(role.code)) return null

  const currentOperations = strings(role.operationPermissions)
  const required = REQUIRED_OPERATION_PERMISSIONS[role.code]
  const operationPermissions = appendMissing(currentOperations, required)

  if (operationPermissions.length === currentOperations.length) return null

  return { id: role.id, operationPermissions }
}

type RoleRow = {
  id: number | string
  code: unknown
  is_builtin?: boolean | null
  operation_permissions?: unknown
}

function rowToMigrationRole(row: RoleRow): SupplyImportMigrationRole {
  return {
    id: row.id,
    code: row.code,
    isBuiltin: row.is_builtin,
    operationPermissions: row.operation_permissions,
  }
}

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  const result = await db.execute(sql`
    SELECT "id", "code", "is_builtin", "operation_permissions"
    FROM "roles"
    WHERE "is_builtin" = true
      AND "code" IN ('ADM', 'OPS');
  `)
  const roles = result.rows.map((row) => rowToMigrationRole(row as RoleRow))

  // 静默 no-op 是真实风险：全新环境或运营改过内置角色 code 时，迁移会报成功
  // 但一个权限都没授。缺失只告警不失败（新库尚未 seed 角色属正常）。
  const foundCodes = new Set(
    roles.map((document) => (typeof document.code === 'string' ? document.code : '')),
  )
  const missingCodes = TARGET_ROLE_CODES.filter((code) => !foundCodes.has(code))
  if (missingCodes.length > 0) {
    // 可选链：迁移在测试与部分 CLI 上下文里拿到的 payload 可能没有 logger，
    // 告警本身绝不能反过来让迁移失败。
    payload.logger?.warn?.(
      `[migration] supply_import role permissions not applied to missing built-in role(s): ${missingCodes.join(', ')}`,
    )
  }

  for (const document of roles) {
    const update = planSupplyImportRoleUpdate(document)
    if (!update) continue
    await db.execute(sql`
      UPDATE "roles"
      SET "operation_permissions" = ${JSON.stringify(update.operationPermissions)}::jsonb
      WHERE "id" = ${update.id};
    `)
  }
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info(
    '20260822_001700_supply_import_role_permissions down is intentionally non-destructive; additive permissions are retained',
  )
}
