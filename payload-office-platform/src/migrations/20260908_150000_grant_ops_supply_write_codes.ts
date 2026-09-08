import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * 给内置 OPS（运营人员）角色补齐供给侧的四个写操作码。
 *
 * 背景：`Buildings` / `Listings` 的 `create` / `update` 此前缺省，落到 Payload
 * 3.86 的 `defaultAccess`（判据仅 `Boolean(req.user)`）——任何登录账号都能建、能改。
 * 收口时把这两条绑到早已注册却从没被消费过的
 * `building:create` / `building:update` / `listing:create` / `listing:update`
 * （与 OPT-051 把 `delete` 绑到 `building:delete` / `listing:delete` 同一手法）。
 *
 * 但内置角色里只有 ADM 持有这四个码（`operationPermissions: ['*']`），OPS 一个都没有。
 * 而 OPS 的职责本就含楼盘与房源维护（角色描述「审核 / 发布 / 商户管理 / 举报处理 /
 * 楼盘维护」，且持有 `buildings` / `listings` 菜单码、后台列表页的「首页推荐」开关
 * 走的正是 `PATCH /api/listings/:id`）。只收 access 不授权 = 顺手砍掉运营现有能力，
 * 故本迁移把四个码授予 OPS。
 *
 * **必须与 `src/test/factory/roles.ts` 同步**：`scripts/seed.ts` 的角色 update 分支
 * 无条件用 `BUILTIN_ROLES` 覆写，只改迁移不改夹具的话，「先跑迁移再跑 seed」会把
 * 刚授予的权限擦掉（OPT-045 §9 的实测教训）。本次已同步。
 *
 * 写法上刻意**增量**（逐码判存在再追加）而不是整体覆写 operationPermissions：
 * OPS 的这份数组是多次迁移累积出来的（20260728_180000 基线 + data:import +
 * analytics:traffic），整体覆写会把后来的授权按写迁移那天的快照抹回去。
 */

const OPS_ROLE_CODE = 'OPS'

/** 本迁移授予 OPS 的供给侧写操作码；顺序即写入顺序。 */
export const OPS_SUPPLY_WRITE_CODES: readonly string[] = [
  'building:create',
  'building:update',
  'listing:create',
  'listing:update',
]

/**
 * 追加单个操作码（幂等）：已有则不动，避免重复元素。
 *
 * `?` 是 jsonb 的「顶层键/数组元素存在」运算符；operation_permissions 是字符串数组，
 * 故可直接用它判存在。
 */
async function grantCode(args: MigrateUpArgs, code: string): Promise<void> {
  await args.db.execute(sql`
    UPDATE "roles"
    SET "operation_permissions" =
      COALESCE("operation_permissions", '[]'::jsonb) || ${JSON.stringify([code])}::jsonb
    WHERE "is_builtin" = true
      AND "code" = ${OPS_ROLE_CODE}
      AND NOT (COALESCE("operation_permissions", '[]'::jsonb) ? ${code});
  `)
}

/** 移除单个操作码；`jsonb - text` 会删掉数组里所有匹配元素。 */
async function revokeCode(args: MigrateDownArgs, code: string): Promise<void> {
  await args.db.execute(sql`
    UPDATE "roles"
    SET "operation_permissions" = COALESCE("operation_permissions", '[]'::jsonb) - ${code}
    WHERE "is_builtin" = true
      AND "code" = ${OPS_ROLE_CODE};
  `)
}

export async function up(args: MigrateUpArgs): Promise<void> {
  for (const code of OPS_SUPPLY_WRITE_CODES) {
    await grantCode(args, code)
  }
}

export async function down(args: MigrateDownArgs): Promise<void> {
  for (const code of OPS_SUPPLY_WRITE_CODES) {
    await revokeCode(args, code)
  }
}
