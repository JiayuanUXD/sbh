import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export type RoleCode = 'ADM' | 'OPS' | 'MGR' | 'BRK' | 'CSR'

export type RolePermissions = {
  menuPermissions: string[]
  operationPermissions: string[]
  fieldPermissions: string[]
}

const ROLE_CODES: readonly RoleCode[] = ['ADM', 'OPS', 'MGR', 'BRK', 'CSR']

const PREVIOUS_ROLE_PERMISSIONS: Readonly<Record<RoleCode, RolePermissions>> = {
  ADM: {
    menuPermissions: ['*'],
    operationPermissions: ['*'],
    fieldPermissions: ['*'],
  },
  OPS: {
    menuPermissions: [
      'dashboard',
      'buildings',
      'listings',
      'listing-reviews',
      'merchants',
      'reports',
      'analytics',
    ],
    operationPermissions: [
      'listing:review',
      'listing:publish',
      'listing:unpublish',
      'merchant:freeze',
      'merchant:restore',
      'report:triage',
      'report:resolve',
    ],
    fieldPermissions: ['phone:full', 'phone:masked', 'audit:before_after'],
  },
  MGR: {
    menuPermissions: ['dashboard', 'leads', 'customers', 'brokers', 'teams', 'follow-ups'],
    operationPermissions: ['lead:assign', 'lead:transfer', 'lead:reclaim', 'broker:manage'],
    fieldPermissions: ['phone:full', 'phone:masked'],
  },
  BRK: {
    menuPermissions: ['my-leads', 'my-customers', 'follow-ups', 'listings'],
    operationPermissions: ['lead:claim', 'lead:follow_up', 'lead:recommend'],
    fieldPermissions: ['phone:full'],
  },
  CSR: {
    menuPermissions: ['leads', 'customers'],
    operationPermissions: ['lead:create', 'lead:assign'],
    fieldPermissions: ['phone:masked'],
  },
}

const ADMIN_NAVIGATION_ROLE_PERMISSIONS: Readonly<Record<RoleCode, RolePermissions>> = {
  ADM: {
    menuPermissions: ['*'],
    operationPermissions: ['*'],
    fieldPermissions: ['*'],
  },
  OPS: {
    menuPermissions: [
      'dashboard',
      'todos',
      'notifications',
      'buildings',
      'listings',
      'locations',
      'business-areas',
      'dictionaries',
      'listing-reviews',
      'merchants',
      'reports',
      'analytics',
      'pages',
      'media',
      'forms',
      'form-submissions',
    ],
    operationPermissions: [
      'task:read',
      'notification:read',
      'listing:review',
      'listing:publish',
      'listing:unpublish',
      'merchant:freeze',
      'merchant:restore',
      'report:read',
      'report:triage',
      'report:resolve',
    ],
    fieldPermissions: ['phone:full', 'phone:masked', 'audit:before_after'],
  },
  MGR: {
    menuPermissions: [
      'dashboard',
      'todos',
      'notifications',
      'buildings',
      'listings',
      'leads',
      'customers',
      'follow-ups',
      'teams',
      'brokers',
    ],
    operationPermissions: [
      'task:read',
      'notification:read',
      'lead:assign',
      'lead:transfer',
      'lead:reclaim',
      'broker:manage',
    ],
    fieldPermissions: ['phone:full', 'phone:masked'],
  },
  BRK: {
    menuPermissions: [
      'dashboard',
      'todos',
      'notifications',
      'listings',
      'my-leads',
      'my-customers',
      'follow-ups',
    ],
    operationPermissions: [
      'task:read',
      'notification:read',
      'lead:claim',
      'lead:follow_up',
      'lead:recommend',
    ],
    fieldPermissions: ['phone:full'],
  },
  CSR: {
    menuPermissions: [
      'dashboard',
      'todos',
      'notifications',
      'leads',
      'customers',
      'forms',
      'form-submissions',
    ],
    operationPermissions: [
      'task:read',
      'notification:read',
      'lead:create',
      'lead:assign',
    ],
    fieldPermissions: ['phone:masked'],
  },
}

export type MigrationRoleDocument = {
  id: number | string
  code: unknown
  isBuiltin?: boolean | null
}

export type RolePermissionUpdate = {
  id: number | string
  code: RoleCode
  permissions: RolePermissions
}

export function planAdminNavigationRoleUpdates(
  roles: readonly MigrationRoleDocument[],
): RolePermissionUpdate[] {
  return planRolePermissionUpdates(roles, ADMIN_NAVIGATION_ROLE_PERMISSIONS)
}

export function planPreviousRolePermissionUpdates(
  roles: readonly MigrationRoleDocument[],
): RolePermissionUpdate[] {
  return planRolePermissionUpdates(roles, PREVIOUS_ROLE_PERMISSIONS)
}

function isRoleCode(code: unknown): code is RoleCode {
  return (
    code === 'ADM' ||
    code === 'OPS' ||
    code === 'MGR' ||
    code === 'BRK' ||
    code === 'CSR'
  )
}

function planRolePermissionUpdates(
  roles: readonly MigrationRoleDocument[],
  permissionsByCode: Readonly<Record<RoleCode, RolePermissions>>,
): RolePermissionUpdate[] {
  const updates: RolePermissionUpdate[] = []

  for (const role of roles) {
    if (role.isBuiltin !== true || !isRoleCode(role.code)) continue
    updates.push({
      id: role.id,
      code: role.code,
      permissions: permissionsByCode[role.code],
    })
  }

  return updates
}

async function updateBuiltinRolePermissions(
  args: MigrateUpArgs | MigrateDownArgs,
  planUpdates: (
    roles: readonly MigrationRoleDocument[],
  ) => RolePermissionUpdate[],
): Promise<void> {
  const { payload, req } = args
  const roles = await payload.find({
    collection: 'roles',
    where: {
      and: [
        { isBuiltin: { equals: true } },
        { code: { in: [...ROLE_CODES] } },
      ],
    },
    limit: ROLE_CODES.length,
    depth: 0,
    overrideAccess: true,
    req,
  })

  for (const role of planUpdates(roles.docs)) {
    await payload.update({
      collection: 'roles',
      id: role.id,
      data: role.permissions,
      depth: 0,
      overrideAccess: true,
      req,
    })
  }
}

export async function up(args: MigrateUpArgs): Promise<void> {
  await updateBuiltinRolePermissions(args, planAdminNavigationRoleUpdates)
}

export async function down(args: MigrateDownArgs): Promise<void> {
  await updateBuiltinRolePermissions(args, planPreviousRolePermissionUpdates)
}
