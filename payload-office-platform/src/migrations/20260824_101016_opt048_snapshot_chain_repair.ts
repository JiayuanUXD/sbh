/**
 * OPT-048 快照链修复：让快照重新对齐 config，而不是真的改 schema。
 *
 * ## 这条迁移为什么存在
 *
 * `payload migrate:create` 比对的是「当前 config」与「上一份 `.json` 快照」，
 * **从不看真实数据库**。而 `20260821_161534_supply_import_batches`（OPT-041）的快照
 * 是基于一个**早于 `20260820_110024`** 的旧基线生成的，把那次加的
 * `city_site_profiles.avg_response_hours` 弄丢了。
 *
 * 后果：任何人跑 `migrate:create` 都会凭空得到一条重复的
 * `ALTER TABLE "city_site_profiles" ADD COLUMN "avg_response_hours" numeric;`
 * ——**且没有 `IF NOT EXISTS`**。一旦被误提交并部署，会在早已有该列的生产库上直接失败；
 * 容器 CMD 是 `migrate-locked.ts && pnpm start`，短路后服务根本起不来。
 * 这与 2026-08-23 那次部署失败（裸 `CREATE TYPE`）是同一种死法。
 *
 * ## 它做什么
 *
 * 语义上**什么都不做**：
 * - 生产库、以及任何跑过 `20260820_110024` 的库，该列已存在 → `IF NOT EXISTS` 直接跳过；
 * - 全新库按顺序跑到这里时，`20260820_110024` 已经建过该列 → 同样跳过。
 *
 * 真正的产出是它**配套的 `.json` 快照**——那份快照含 `avg_response_hours`，
 * 于是快照链重新与 config 对齐，`migrate:create` 从此报 no changes。
 *
 * ## down 为什么是空的
 *
 * 该列的所有权属于 `20260820_110024`，回滚它是那条迁移的职责。
 * 这条只修快照，回滚它不该删掉别人的列。
 *
 * ## 已知仍未对齐的部分（不在本迁移范围）
 *
 * 生产有 19 张 `*_rels` 表与 `inquiry_rate_limit` 不在快照里。它们不影响
 * `migrate:create`（config 里没有 → 不会被生成），`inquiry_rate_limit` 更是裸 SQL
 * 迁移建的、本就不该进 Payload 快照。19 张 `_rels` 基本为空表，属历史残留，
 * 是否清理需单独评估，见 OPT-048 §5。
 */
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "city_site_profiles" ADD COLUMN IF NOT EXISTS "avg_response_hours" numeric;`)
}

export async function down({}: MigrateDownArgs): Promise<void> {
  // 故意留空：列归 20260820_110024 所有，见文件头注释。
}
