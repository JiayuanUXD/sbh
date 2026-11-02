import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * 给内置 OPS 角色授予站内搜索未命中词的菜单码 search-miss-terms 与操作码 search_miss:manage（OPT-126）。
 * ADM 是 ['*'] 不用授。写法与 20260908_150000_grant_ops_supply_write_codes 同款：逐码判存在再追加，
 * 不整体覆写。**必须与 src/test/factory/roles.ts 同步**（seed 会用夹具覆写角色）。
 */
const OPS = 'OPS'

async function grant(args: MigrateUpArgs, column: 'menu_permissions' | 'operation_permissions', code: string): Promise<void> {
  await args.db.execute(sql`
    UPDATE "roles"
    SET ${sql.raw(`"${column}"`)} = COALESCE(${sql.raw(`"${column}"`)}, '[]'::jsonb) || ${JSON.stringify([code])}::jsonb
    WHERE "is_builtin" = true AND "code" = ${OPS}
      AND NOT (COALESCE(${sql.raw(`"${column}"`)}, '[]'::jsonb) ? ${code});
  `)
}

async function revoke(args: MigrateDownArgs, column: 'menu_permissions' | 'operation_permissions', code: string): Promise<void> {
  await args.db.execute(sql`
    UPDATE "roles"
    SET ${sql.raw(`"${column}"`)} = COALESCE(${sql.raw(`"${column}"`)}, '[]'::jsonb) - ${code}
    WHERE "is_builtin" = true AND "code" = ${OPS};
  `)
}

export async function up(args: MigrateUpArgs): Promise<void> {
  await grant(args, 'menu_permissions', 'search-miss-terms')
  await grant(args, 'operation_permissions', 'search_miss:manage')
}

export async function down(args: MigrateDownArgs): Promise<void> {
  await revoke(args, 'operation_permissions', 'search_miss:manage')
  await revoke(args, 'menu_permissions', 'search-miss-terms')
}
