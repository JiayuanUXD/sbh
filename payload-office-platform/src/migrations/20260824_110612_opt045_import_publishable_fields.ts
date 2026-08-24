/**
 * OPT-045：批量导入「导入即可上架」所需的两个字段。
 *
 * - `merchants.is_platform_default`（D2）：平台自营商户标识。导入在楼盘没有生效
 *   供给商户时按它回落，替代原先按名称找「官网」的约定式解析。
 * - `buildings.sale_unit_price`（D1）：楼盘在售单价，**单值**，招商参考口径。
 *
 * ## 为什么手工改成幂等写法
 *
 * `migrate:create` 生成的是裸 `ADD COLUMN` / `CREATE INDEX`。OPT-045 §7 D1 与 §9
 * 明确要求本迁移沿用 `20260810_003111` / `20260821_161534` 的幂等写法并在模拟生产
 * 形态的库上验证——**理由是真实教训**：2026-08-23 的生产部署 `sbh-104` 就是栽在
 * 裸 DDL 上（`20260821_161534` 用裸 `CREATE TYPE` 建一个生产早已存在的类型，
 * 迁移失败 → 容器 CMD `migrate-locked.ts && pnpm start` 的 `&&` 短路 → 服务不启动）。
 * 生产 schema 与迁移链存在历史分叉（`huizuxuanzhi` 那套采集导入的表从未走过迁移链），
 * 本地与 CI 全绿完全不能推出生产跑得通。
 *
 * 2026-08-24 只读核查生产：`is_platform_default` / `sale_unit_price` / 索引
 * 三样都**不存在**，所以本迁移会真正执行、不是空转。幂等写法防的是重跑与未来分叉，
 * 不是掩盖「这次到底改没改」。
 *
 * `DEFAULT false` 会把存量行一并回填成 false——正是想要的语义：
 * 现有商户默认都不是平台自营，由 D3 的数据变更显式挑出七个置 true。
 */
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "is_platform_default" boolean DEFAULT false;
  ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "sale_unit_price" numeric;
  CREATE INDEX IF NOT EXISTS "merchants_is_platform_default_idx" ON "merchants" USING btree ("is_platform_default");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX IF EXISTS "merchants_is_platform_default_idx";
  ALTER TABLE "merchants" DROP COLUMN IF EXISTS "is_platform_default";
  ALTER TABLE "buildings" DROP COLUMN IF EXISTS "sale_unit_price";`)
}
