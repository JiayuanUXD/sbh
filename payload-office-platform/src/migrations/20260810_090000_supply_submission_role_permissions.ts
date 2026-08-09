import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

const TARGET_ROLE_CODES = ['OPS', 'MGR', 'BRK'] as const
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
  BRK: {
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

export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  const roles = await payload.find({
    collection: 'roles',
    where: {
      and: [
        { isBuiltin: { equals: true } },
        { code: { in: [...TARGET_ROLE_CODES] } },
      ],
    },
    limit: TARGET_ROLE_CODES.length,
    depth: 0,
    overrideAccess: true,
    req,
  })

  for (const document of roles.docs) {
    const update = planSupplySubmissionRoleUpdate(document)
    if (!update) continue
    await payload.update({
      collection: 'roles',
      id: update.id,
      data: {
        menuPermissions: update.menuPermissions,
        operationPermissions: update.operationPermissions,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
  }
}

export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info(
    '20260810_090000_supply_submission_role_permissions down is intentionally non-destructive; additive permissions are retained',
  )
}
