import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * OPT-034 Task 6：删除 `listing_merchant_relations` 表与配套 collection。
 *
 * 为何删：房源-商户关系的「有效期」机制（effectiveFrom/effectiveTo）从未在业务上
 * 被使用——数据审计显示 2208 条关系记录全部是 1:1（每条房源恰好一条现行关系），
 * 0 条记录设置过 effectiveTo（即从未真正"终止"过一条关系）。OPT-034 Task 1-4 已把
 * 所有读侧代码（精筛 §8-§10、后台列表、供给统计）迁移到直接读 `listings.merchant`
 * 字段，这张关系表切换后不再有任何消费者。切换前后可见房源数 2169 → 2172
 * （+3，是 `listings.merchant` 已有值、但关系表里查不到对应行的 3 条房源——生产
 * 只读核查确认关系行商户与 `listings.merchant` 不一致的记录数为 0，问题只在于
 * 这 3 条房源根本没有关系行，不是关系数据本身有误。其中 1 条是已知事故案例
 * #2464（slug `test08192325`）：后台完整度、可见性、发布三处信号全绿，前台
 * 却查无此房——切换后这类房源会被正确纳入），0 条房源因切换而消失。
 *
 * 回滚说明：`down()` 只重建表结构（含索引与外键），**不恢复数据**——
 * 2208 条关系记录一旦随 `up()` 的 DROP TABLE 删除即不可逆。真要回滚，要么从删表前的
 * 备份恢复这张表的数据，要么接受这段关系历史彻底丢失（`listings.merchant` 字段本身
 * 不在这张表里，不受影响，供给关系不会因此丢失，丢的只是「谁在何时被指定过供给商户」
 * 这段审计轨迹）。
 *
 * 注：`payload migrate:create` 生成的原始 diff 还包含一段与本次改动无关的
 * `media.prefix` 列 DEFAULT 漂移（本地 `.env.local` 未配置 COS_*，s3Storage 插件在
 * `enabled:false` 时不会声明该默认值，纯属本地环境差异）。已手动从本迁移与快照 json
 * 中剔除。经 CloudBase MCP 只读查询核实，生产库 `media.prefix` 列当前
 * `column_default` 确为 `'media'::character varying`——若不剔除，这段无关 diff
 * 会把生产这条真实存在的默认值删掉，与本次任务（删表）无关且高风险。
 *
 * 注 2：原始 diff 还生成了一条多余的
 * `ALTER TABLE payload_locked_documents_rels DROP CONSTRAINT ..._fk`——
 * `DROP TABLE ... CASCADE` 在删除 listing_merchant_relations 时已经把这条引用它的
 * 外键约束一并级联删除，本地实测这条多余语句会报「约束不存在」而中断迁移，已删除。
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "listing_merchant_relations" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "listing_merchant_relations" CASCADE;
  DROP INDEX "payload_locked_documents_rels_listing_merchant_relations_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "listing_merchant_relations_id";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "listing_merchant_relations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"listing_id" integer NOT NULL,
  	"merchant_id" integer,
  	"effective_from" timestamp(3) with time zone NOT NULL,
  	"effective_to" timestamp(3) with time zone,
  	"created_reason" varchar,
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "listing_merchant_relations_id" integer;
  ALTER TABLE "listing_merchant_relations" ADD CONSTRAINT "listing_merchant_relations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listing_merchant_relations" ADD CONSTRAINT "listing_merchant_relations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "listing_merchant_relations_listing_idx" ON "listing_merchant_relations" USING btree ("listing_id");
  CREATE INDEX "listing_merchant_relations_merchant_idx" ON "listing_merchant_relations" USING btree ("merchant_id");
  CREATE INDEX "listing_merchant_relations_updated_at_idx" ON "listing_merchant_relations" USING btree ("updated_at");
  CREATE INDEX "listing_merchant_relations_created_at_idx" ON "listing_merchant_relations" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_listing_merchant_relations_fk" FOREIGN KEY ("listing_merchant_relations_id") REFERENCES "public"."listing_merchant_relations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_listing_merchant_relations_idx" ON "payload_locked_documents_rels" USING btree ("listing_merchant_relations_id");`)
}
