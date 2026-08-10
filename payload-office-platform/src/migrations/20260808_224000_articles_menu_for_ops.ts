import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * 为内置 OPS（运营人员）角色授予 `articles` 菜单编码，
 * 使后台自定义导航「内容管理 → 资讯中心」对运营角色可见。
 *
 * 仅影响内置 OPS 角色的 menuPermissions；操作 / 字段权限与其他角色不变。
 * up 写入目标基线（含 articles），down 回滚到 20260728_180000 迁移写入的基线。
 */

const OPS_ROLE_CODE = 'OPS'

/** 20260728_180000_opt_021_admin_navigation_roles 迁移写入的 OPS 菜单基线（down 回滚目标） */
export const PREVIOUS_OPS_MENU_PERMISSIONS: readonly string[] = [
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
]

/** 目标基线：内容段新增资讯中心（articles）菜单编码 */
export const TARGET_OPS_MENU_PERMISSIONS: readonly string[] = [
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
  'articles',
  'media',
  'forms',
  'form-submissions',
]

export type MigrationOpsRoleDocument = {
  id: number | string
  code: unknown
  isBuiltin?: boolean | null
}

export type ArticlesMenuRoleUpdate = {
  id: number | string
  code: typeof OPS_ROLE_CODE
  menuPermissions: string[]
}

export function planArticlesMenuRoleUpdate(
  role: MigrationOpsRoleDocument,
  menuPermissions: readonly string[],
): ArticlesMenuRoleUpdate | null {
  if (role.isBuiltin !== true || role.code !== OPS_ROLE_CODE) return null

  return {
    id: role.id,
    code: OPS_ROLE_CODE,
    menuPermissions: [...menuPermissions],
  }
}

async function applyOpsMenuPermissions(
  args: MigrateUpArgs | MigrateDownArgs,
  menuPermissions: readonly string[],
): Promise<void> {
  const { db } = args
  const update = planArticlesMenuRoleUpdate(
    { id: OPS_ROLE_CODE, code: OPS_ROLE_CODE, isBuiltin: true },
    menuPermissions,
  )
  if (!update) return

  await db.execute(sql`
    UPDATE "roles"
    SET "menu_permissions" = ${JSON.stringify(update.menuPermissions)}::jsonb
    WHERE "is_builtin" = true
      AND "code" = ${update.code};
  `)
}

export async function up(args: MigrateUpArgs): Promise<void> {
  await applyOpsMenuPermissions(args, TARGET_OPS_MENU_PERMISSIONS)
}

export async function down(args: MigrateDownArgs): Promise<void> {
  await applyOpsMenuPermissions(args, PREVIOUS_OPS_MENU_PERMISSIONS)
}
