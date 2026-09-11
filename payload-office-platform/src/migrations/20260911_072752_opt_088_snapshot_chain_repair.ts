/**
 * OPT-088 快照链修复：让快照重新对齐 config，而不是真的改 schema。
 *
 * ## 这条迁移为什么存在
 *
 * `payload migrate:create` 比对的是「当前 config」与「链上最新的 `.json` 快照」，
 * **从不看真实数据库**。OPT-088 的建表迁移 `20260910_233152_opt_088_members` 是在
 * 一条不含 OPT-092 的基线上生成的；OPT-092 的 `20260911_031639_nav_page_target` 与本
 * 分支并行合入 master，时间戳更新，于是合并后链上「最新快照」是它的——那份快照在
 * 没有会员表的 config 上生成，`migrate:drift` 据此判定分叉，CI 的 `postgres-migrations`
 * 作业红（它试图重新生成整套 members 建表语句）。
 *
 * ## 它做什么
 *
 * 语义上**什么都不做**：会员三张表与两个 rels 列归 `20260910_233152` 所有，任何按顺序
 * 跑过它的库（生产、CI 全新库）都已经有了。真正的产出是它**配套的 `.json` 快照**——
 * 那份快照含会员表，快照链重新与 config 对齐，`migrate:create` 从此报 no changes。
 *
 * ## down 为什么是空的
 *
 * 表的生死归 `20260910_233152` 所有，回滚它是那条迁移的职责。这条只修快照。
 *
 * 同类先例：`20260824_101016_opt048_snapshot_chain_repair.ts`、
 * `20260905_121042_opt069_snapshot_chain_repair.ts`。根因与预防写在仓库根 `CLAUDE.md`
 * 「永远从最新 master 开分支」一条——本次分叉发生在分支已开出之后合入 master 的并行工作项。
 */
import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up({}: MigrateUpArgs): Promise<void> {
  // 故意留空：建表归 20260910_233152 所有，见文件头注释。
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // 故意留空：见文件头注释。
}
