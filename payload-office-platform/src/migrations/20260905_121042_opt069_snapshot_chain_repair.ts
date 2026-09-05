/**
 * OPT-069 快照链修复：让快照重新对齐 config，而不是真的改 schema。
 *
 * ## 这条迁移为什么存在
 *
 * `payload migrate:create` 比对的是「当前 config」与「上一份 `.json` 快照」，
 * **从不看真实数据库**。OPT-069 的三条迁移（`20260904_163535` / `20260905_025659` /
 * `20260905_033034`）是在一条**不含** `20260904_170123` 的基线上生成的——那条属于
 * OPT-070，把 `city_site_profiles_type_card_overrides.cover_image_id` 改成了可空，
 * 与本分支并行合入 master。
 *
 * 两边合并后，链上最新的快照是 OPT-069 的，里面那一列仍是 NOT NULL，而 config
 * 已经是可空。于是 `migrate:drift` 判定分叉，CI 的 `postgres-migrations` 作业红。
 *
 * ## 它做什么
 *
 * 语义上**什么都不做**：
 * - 生产库、以及任何跑过 `20260904_170123` 的库，该列已可空 →
 *   `DROP NOT NULL` 对已可空的列是无操作，PostgreSQL 不报错；
 * - 全新库按顺序跑到这里时，`20260904_170123` 已经改过 → 同样是无操作。
 *
 * 真正的产出是它**配套的 `.json` 快照**——那份快照记录了可空状态，
 * 于是快照链重新与 config 对齐，`migrate:create` 从此报 no changes。
 *
 * ## down 为什么是空的
 *
 * 该列的可空性归 `20260904_170123` 所有，回滚它是那条迁移的职责。这条只修快照。
 * 若在这里写 `SET NOT NULL`，回滚会**撤销 OPT-070 的修复**（那次修的是删 media 时
 * 的 NOT NULL 外键死结），而且一旦已有 NULL 行还会直接失败。
 *
 * 同类先例见 `20260824_101016_opt048_snapshot_chain_repair.ts`。
 * 根因与预防写在仓库根 `CLAUDE.md`「永远从最新 master 开分支」一条。
 */
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "city_site_profiles_type_card_overrides" ALTER COLUMN "cover_image_id" DROP NOT NULL;`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // 故意留空：该列的可空性归 20260904_170123 所有，见文件头注释。
}
