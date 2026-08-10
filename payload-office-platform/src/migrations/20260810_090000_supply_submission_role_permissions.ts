import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * BRK（经纪人，dataScope=self）刻意不在此列：投放申请的读取不做逐条数据范围
 * 收窄，授予读权限等于把全平台房东的完整手机号与详细地址开放给全体经纪人，
 * 形成绕开平台的渠道风险。审单是供给运营（OPS）的职责。
 */
const TARGET_ROLE_CODES = ['OPS', 'MGR'] as const
type TargetRoleCode = (typeof TARGET_ROLE_CODES)[number]

const REQUIRED_PERMISSIONS: Readonly<
  Record<TargetRoleCode, { menu: readonly string[]; operation: readonly string[] }>
> = {
  OPS: {
    menu: ['supply-submissions'],
    operation: [
      'supply_submission:read',
      'supply_submission:manage',
      'supply_submission:convert',
    ],
  },
  MGR: {
    menu: ['supply-submissions'],
    operation: ['supply_submission:read'],
  },
}

export type SupplySubmissionMigrationRole = {
  id: number | string
  code: unknown
  isBuiltin?: boolean | null
  menuPermissions?: unknown
  operationPermissions?: unknown
}

export type SupplySubmissionRoleUpdate = {
  id: number | string
  menuPermissions: string[]
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

export function planSupplySubmissionRoleUpdate(
  role: SupplySubmissionMigrationRole,
): SupplySubmissionRoleUpdate | null {
  if (role.isBuiltin !== true || !isTargetRoleCode(role.code)) return null

  const currentMenu = strings(role.menuPermissions)
  const currentOperations = strings(role.operationPermissions)
  const required = REQUIRED_PERMISSIONS[role.code]
  const menuPermissions = appendMissing(currentMenu, required.menu)
  const operationPermissions = appendMissing(currentOperations, required.operation)

  if (
    menuPermissions.length === currentMenu.length &&
    operationPermissions.length === currentOperations.length
  ) {
    return null
  }

  return { id: role.id, menuPermissions, operationPermissions }
}

type RoleRow = {
  id: number | string
  code: unknown
  is_builtin?: boolean | null
  menu_permissions?: unknown
  operation_permissions?: unknown
}

function rowToMigrationRole(row: RoleRow): SupplySubmissionMigrationRole {
  return {
    id: row.id,
    code: row.code,
    isBuiltin: row.is_builtin,
    menuPermissions: row.menu_permissions,
    operationPermissions: row.operation_permissions,
  }
}

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  const result = await db.execute(sql`
    SELECT "id", "code", "is_builtin", "menu_permissions", "operation_permissions"
    FROM "roles"
    WHERE "is_builtin" = true
      AND "code" IN ('OPS', 'MGR');
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
      `[migration] supply_submission role permissions not applied to missing built-in role(s): ${missingCodes.join(', ')}`,
    )
  }

  for (const document of roles) {
    const update = planSupplySubmissionRoleUpdate(document)
    if (!update) continue
    await db.execute(sql`
      UPDATE "roles"
      SET
        "menu_permissions" = ${JSON.stringify(update.menuPermissions)}::jsonb,
        "operation_permissions" = ${JSON.stringify(update.operationPermissions)}::jsonb
      WHERE "id" = ${update.id};
    `)
  }
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info(
    '20260810_090000_supply_submission_role_permissions down is intentionally non-destructive; additive permissions are retained',
  )
}
