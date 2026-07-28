import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

type RoleCode = 'ADM' | 'OPS' | 'MGR' | 'BRK' | 'CSR'

type RolePermissions = {
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

function isRoleCode(code: unknown): code is RoleCode {
  return typeof code === 'string' && ROLE_CODES.includes(code as RoleCode)
}

async function updateBuiltinRolePermissions(
  args: MigrateUpArgs | MigrateDownArgs,
  permissionsByCode: Readonly<Record<RoleCode, RolePermissions>>,
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

  for (const role of roles.docs) {
    if (role.isBuiltin !== true || !isRoleCode(role.code)) continue

    await payload.update({
      collection: 'roles',
      id: role.id,
      data: permissionsByCode[role.code],
      depth: 0,
      overrideAccess: true,
      req,
    })
  }
}

export async function up(args: MigrateUpArgs): Promise<void> {
  await updateBuiltinRolePermissions(args, ADMIN_NAVIGATION_ROLE_PERMISSIONS)
}

export async function down(args: MigrateDownArgs): Promise<void> {
  await updateBuiltinRolePermissions(args, PREVIOUS_ROLE_PERMISSIONS)
}
