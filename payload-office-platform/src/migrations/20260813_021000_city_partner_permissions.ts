import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

const TARGET_ROLE_CODES = ['OPS', 'MGR'] as const
type TargetRoleCode = (typeof TARGET_ROLE_CODES)[number]

const REQUIRED = {
  menu: ['city-partner-applications'],
  operation: ['city_partner_application:read', 'city_partner_application:manage'],
} as const

export type CityPartnerMigrationRole = {
  id: number | string
  code: unknown
  isBuiltin?: boolean | null
  menuPermissions?: unknown
  operationPermissions?: unknown
}

export type CityPartnerRoleUpdate = {
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
      result.push(permission)
      present.add(permission)
    }
  }
  return result
}

function isTargetRoleCode(value: unknown): value is TargetRoleCode {
  return typeof value === 'string' && TARGET_ROLE_CODES.some((code) => code === value)
}

export function planCityPartnerRoleUpdate(
  role: CityPartnerMigrationRole,
): CityPartnerRoleUpdate | null {
  if (role.isBuiltin !== true || !isTargetRoleCode(role.code)) return null
  const currentMenu = strings(role.menuPermissions)
  const currentOperations = strings(role.operationPermissions)
  const menuPermissions = appendMissing(currentMenu, REQUIRED.menu)
  const operationPermissions = appendMissing(currentOperations, REQUIRED.operation)
  if (
    menuPermissions.length === currentMenu.length &&
    operationPermissions.length === currentOperations.length
  ) return null
  return { id: role.id, menuPermissions, operationPermissions }
}

type RoleRow = {
  id: number | string
  code: unknown
  is_builtin?: boolean | null
  menu_permissions?: unknown
  operation_permissions?: unknown
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const result = await db.execute(sql`
    SELECT "id", "code", "is_builtin", "menu_permissions", "operation_permissions"
    FROM "roles"
    WHERE "is_builtin" = true;
  `)
  const rows = result.rows as RoleRow[]
  const codes = rows.map((row) => row.code).filter((code): code is string => typeof code === 'string')
  const expected = ['ADM', 'OPS', 'MGR', 'BRK', 'CSR']
  if (codes.length !== expected.length || expected.some((code) => !codes.includes(code))) {
    throw new Error(`city_partner_builtin_role_invariant:${codes.sort().join(',')}`)
  }

  for (const row of rows) {
    const update = planCityPartnerRoleUpdate({
      id: row.id,
      code: row.code,
      isBuiltin: row.is_builtin,
      menuPermissions: row.menu_permissions,
      operationPermissions: row.operation_permissions,
    })
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
    '20260813_021000_city_partner_permissions down is intentionally non-destructive; additive permissions are retained',
  )
}
