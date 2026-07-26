import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * M5 CRM 闭环 Collection 迁移（tasks.md M5.1/M5.2/M5.5 / design §3.6 / R6, R8）
 *
 * 三张新表 + leads 扩展：
 *   - customers（客户档案，可变，带 audit createdBy/lastModifiedBy）
 *   - follow_ups（跟进流水，append-only，audit 排除；hasMany relatedListings → follow_ups_rels）
 *   - lead_ownership_history（归属历史，append-only，audit 排除，无 hasMany 故无 _rels）
 *   - leads ADD COLUMN：客户档案关联、阶段/归属状态、城市/团队、结构化需求区间、
 *     SLA 与运行时策略快照字段、版本号（leads_rels 已由 m0_schema_sync 建好，本次不动）
 *
 * 单值 relationship 一律 inline `<name>_id` + 命名 FK ON DELETE set null + 索引；
 * follow_ups_rels 仅承载 listings_id（audit 排除，无 users_id）。
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   -- ===== 枚举类型 =====
   CREATE TYPE "public"."enum_customers_status" AS ENUM('active', 'converted', 'lost');
   CREATE TYPE "public"."enum_follow_ups_method" AS ENUM('phone', 'wechat', 'visit', 'other');
   CREATE TYPE "public"."enum_follow_ups_result" AS ENUM('connected', 'no_answer', 'recommended', 'appointment', 'invalid');
   CREATE TYPE "public"."enum_lead_ownership_history_action" AS ENUM('assign', 'claim', 'transfer', 'to_public_pool', 'reclaim');
   CREATE TYPE "public"."enum_lead_ownership_history_ownership_status" AS ENUM('unassigned', 'assigned', 'public_pool');
   CREATE TYPE "public"."enum_leads_stage" AS ENUM('new', 'pending_assignment', 'following', 'qualified', 'viewing', 'negotiation', 'converted', 'lost');
   CREATE TYPE "public"."enum_leads_ownership_status" AS ENUM('unassigned', 'assigned', 'public_pool');
   CREATE TYPE "public"."enum_leads_currency" AS ENUM('CNY', 'USD', 'HKD');
   CREATE TYPE "public"."enum_leads_billing_period" AS ENUM('month', 'day_sqm', 'year');

   -- ===== customers 表（可变 + audit fields）=====
   CREATE TABLE "customers" (
   	"id" serial PRIMARY KEY NOT NULL,
   	"name" varchar NOT NULL,
   	"company" varchar,
   	"phone_normalized" varchar NOT NULL,
   	"phone_masked_snapshot" varchar,
   	"status" "enum_customers_status" DEFAULT 'active',
   	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
   );

   CREATE TABLE "customers_rels" (
   	"id" serial PRIMARY KEY NOT NULL,
   	"order" integer,
   	"parent_id" integer NOT NULL,
   	"path" varchar NOT NULL,
   	"users_id" integer
   );

   -- ===== follow_ups 表（append-only，audit 排除）=====
   CREATE TABLE "follow_ups" (
   	"id" serial PRIMARY KEY NOT NULL,
   	"lead_id" integer NOT NULL,
   	"broker_id" integer NOT NULL,
   	"method" "enum_follow_ups_method" NOT NULL,
   	"result" "enum_follow_ups_result" NOT NULL,
   	"content" varchar NOT NULL,
   	"next_follow_up_at" timestamp(3) with time zone,
   	"correction_of_id" integer,
   	"version" numeric DEFAULT 1,
   	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
   );

   CREATE TABLE "follow_ups_rels" (
   	"id" serial PRIMARY KEY NOT NULL,
   	"order" integer,
   	"parent_id" integer NOT NULL,
   	"path" varchar NOT NULL,
   	"listings_id" integer
   );

   -- ===== lead_ownership_history 表（append-only，audit 排除，无 hasMany）=====
   CREATE TABLE "lead_ownership_history" (
   	"id" serial PRIMARY KEY NOT NULL,
   	"lead_id" integer NOT NULL,
   	"action" "enum_lead_ownership_history_action" NOT NULL,
   	"ownership_status" "enum_lead_ownership_history_ownership_status",
   	"from_owner_id" integer,
   	"to_owner_id" integer,
   	"reason" varchar,
   	"operated_by_id" integer,
   	"version" numeric DEFAULT 1,
   	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
   	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
   );

   -- ===== leads 扩展列 =====
   ALTER TABLE "leads" ADD COLUMN "customer_id" integer;
   ALTER TABLE "leads" ADD COLUMN "stage" "enum_leads_stage";
   ALTER TABLE "leads" ADD COLUMN "ownership_status" "enum_leads_ownership_status";
   ALTER TABLE "leads" ADD COLUMN "team_id" integer;
   ALTER TABLE "leads" ADD COLUMN "city_id" integer;
   ALTER TABLE "leads" ADD COLUMN "area_min" numeric;
   ALTER TABLE "leads" ADD COLUMN "area_max" numeric;
   ALTER TABLE "leads" ADD COLUMN "budget_min" numeric;
   ALTER TABLE "leads" ADD COLUMN "budget_max" numeric;
   ALTER TABLE "leads" ADD COLUMN "currency" "enum_leads_currency" DEFAULT 'CNY';
   ALTER TABLE "leads" ADD COLUMN "billing_period" "enum_leads_billing_period";
   ALTER TABLE "leads" ADD COLUMN "seat_count" numeric;
   ALTER TABLE "leads" ADD COLUMN "lease_months" numeric;
   ALTER TABLE "leads" ADD COLUMN "move_in_date" timestamp(3) with time zone;
   ALTER TABLE "leads" ADD COLUMN "special_requirements" varchar;
   ALTER TABLE "leads" ADD COLUMN "effective_created_at" timestamp(3) with time zone;
   ALTER TABLE "leads" ADD COLUMN "effective_source_channel" varchar;
   ALTER TABLE "leads" ADD COLUMN "source_channel" varchar;
   ALTER TABLE "leads" ADD COLUMN "first_valid_follow_up_at" timestamp(3) with time zone;
   ALTER TABLE "leads" ADD COLUMN "last_valid_follow_up_at" timestamp(3) with time zone;
   ALTER TABLE "leads" ADD COLUMN "next_follow_up_at" timestamp(3) with time zone;
   ALTER TABLE "leads" ADD COLUMN "runtime_policy_version" varchar;
   ALTER TABLE "leads" ADD COLUMN "first_follow_up_sla_seconds" numeric;
   ALTER TABLE "leads" ADD COLUMN "public_pool_recycle_seconds" numeric;
   ALTER TABLE "leads" ADD COLUMN "claim_protection_seconds" numeric;
   ALTER TABLE "leads" ADD COLUMN "daily_claim_limit" numeric;
   ALTER TABLE "leads" ADD COLUMN "active_lead_cap" numeric;
   ALTER TABLE "leads" ADD COLUMN "version" numeric DEFAULT 1;

   -- ===== payload_locked_documents_rels 新增关系列 =====
   ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "customers_id" integer;
   ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "follow_ups_id" integer;
   ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "lead_ownership_history_id" integer;

   -- ===== 外键约束 =====
   ALTER TABLE "customers_rels" ADD CONSTRAINT "customers_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
   ALTER TABLE "customers_rels" ADD CONSTRAINT "customers_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
   ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
   ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."brokers"("id") ON DELETE set null ON UPDATE no action;
   ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_correction_of_id_follow_ups_id_fk" FOREIGN KEY ("correction_of_id") REFERENCES "public"."follow_ups"("id") ON DELETE set null ON UPDATE no action;
   ALTER TABLE "follow_ups_rels" ADD CONSTRAINT "follow_ups_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."follow_ups"("id") ON DELETE cascade ON UPDATE no action;
   ALTER TABLE "follow_ups_rels" ADD CONSTRAINT "follow_ups_rels_listings_fk" FOREIGN KEY ("listings_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
   ALTER TABLE "lead_ownership_history" ADD CONSTRAINT "lead_ownership_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
   ALTER TABLE "lead_ownership_history" ADD CONSTRAINT "lead_ownership_history_from_owner_id_brokers_id_fk" FOREIGN KEY ("from_owner_id") REFERENCES "public"."brokers"("id") ON DELETE set null ON UPDATE no action;
   ALTER TABLE "lead_ownership_history" ADD CONSTRAINT "lead_ownership_history_to_owner_id_brokers_id_fk" FOREIGN KEY ("to_owner_id") REFERENCES "public"."brokers"("id") ON DELETE set null ON UPDATE no action;
   ALTER TABLE "lead_ownership_history" ADD CONSTRAINT "lead_ownership_history_operated_by_id_users_id_fk" FOREIGN KEY ("operated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
   ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
   ALTER TABLE "leads" ADD CONSTRAINT "leads_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
   ALTER TABLE "leads" ADD CONSTRAINT "leads_city_id_locations_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
   ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
   ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_follow_ups_fk" FOREIGN KEY ("follow_ups_id") REFERENCES "public"."follow_ups"("id") ON DELETE cascade ON UPDATE no action;
   ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_lead_ownership_history_fk" FOREIGN KEY ("lead_ownership_history_id") REFERENCES "public"."lead_ownership_history"("id") ON DELETE cascade ON UPDATE no action;

   -- ===== 索引 =====
   CREATE INDEX "customers_phone_normalized_idx" ON "customers" USING btree ("phone_normalized");
   CREATE INDEX "customers_updated_at_idx" ON "customers" USING btree ("updated_at");
   CREATE INDEX "customers_created_at_idx" ON "customers" USING btree ("created_at");
   CREATE INDEX "customers_rels_order_idx" ON "customers_rels" USING btree ("order");
   CREATE INDEX "customers_rels_parent_idx" ON "customers_rels" USING btree ("parent_id");
   CREATE INDEX "customers_rels_path_idx" ON "customers_rels" USING btree ("path");
   CREATE INDEX "customers_rels_users_id_idx" ON "customers_rels" USING btree ("users_id");
   CREATE INDEX "follow_ups_lead_idx" ON "follow_ups" USING btree ("lead_id");
   CREATE INDEX "follow_ups_broker_idx" ON "follow_ups" USING btree ("broker_id");
   CREATE INDEX "follow_ups_correction_of_idx" ON "follow_ups" USING btree ("correction_of_id");
   CREATE INDEX "follow_ups_updated_at_idx" ON "follow_ups" USING btree ("updated_at");
   CREATE INDEX "follow_ups_created_at_idx" ON "follow_ups" USING btree ("created_at");
   CREATE INDEX "follow_ups_rels_order_idx" ON "follow_ups_rels" USING btree ("order");
   CREATE INDEX "follow_ups_rels_parent_idx" ON "follow_ups_rels" USING btree ("parent_id");
   CREATE INDEX "follow_ups_rels_path_idx" ON "follow_ups_rels" USING btree ("path");
   CREATE INDEX "follow_ups_rels_listings_id_idx" ON "follow_ups_rels" USING btree ("listings_id");
   CREATE INDEX "lead_ownership_history_lead_idx" ON "lead_ownership_history" USING btree ("lead_id");
   CREATE INDEX "lead_ownership_history_from_owner_idx" ON "lead_ownership_history" USING btree ("from_owner_id");
   CREATE INDEX "lead_ownership_history_to_owner_idx" ON "lead_ownership_history" USING btree ("to_owner_id");
   CREATE INDEX "lead_ownership_history_operated_by_idx" ON "lead_ownership_history" USING btree ("operated_by_id");
   CREATE INDEX "lead_ownership_history_updated_at_idx" ON "lead_ownership_history" USING btree ("updated_at");
   CREATE INDEX "lead_ownership_history_created_at_idx" ON "lead_ownership_history" USING btree ("created_at");
   CREATE INDEX "leads_customer_idx" ON "leads" USING btree ("customer_id");
   CREATE INDEX "leads_team_idx" ON "leads" USING btree ("team_id");
   CREATE INDEX "leads_city_idx" ON "leads" USING btree ("city_id");
   CREATE INDEX "payload_locked_documents_rels_customers_id_idx" ON "payload_locked_documents_rels" USING btree ("customers_id");
   CREATE INDEX "payload_locked_documents_rels_follow_ups_id_idx" ON "payload_locked_documents_rels" USING btree ("follow_ups_id");
   CREATE INDEX "payload_locked_documents_rels_lead_ownership_history_id_idx" ON "payload_locked_documents_rels" USING btree ("lead_ownership_history_id");
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "customers" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "customers_rels" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "follow_ups" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "follow_ups_rels" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "lead_ownership_history" DISABLE ROW LEVEL SECURITY;

   -- leads 扩展列外键
   ALTER TABLE "leads" DROP CONSTRAINT "leads_customer_id_customers_id_fk";
   ALTER TABLE "leads" DROP CONSTRAINT "leads_team_id_teams_id_fk";
   ALTER TABLE "leads" DROP CONSTRAINT "leads_city_id_locations_id_fk";
   DROP INDEX "leads_customer_idx";
   DROP INDEX "leads_team_idx";
   DROP INDEX "leads_city_idx";

   -- payload_locked_documents_rels 关系列
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_customers_fk";
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_follow_ups_fk";
   ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_lead_ownership_history_fk";
   DROP INDEX "payload_locked_documents_rels_customers_id_idx";
   DROP INDEX "payload_locked_documents_rels_follow_ups_id_idx";
   DROP INDEX "payload_locked_documents_rels_lead_ownership_history_id_idx";
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "customers_id";
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "follow_ups_id";
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "lead_ownership_history_id";

   -- 删表
   DROP TABLE "customers" CASCADE;
   DROP TABLE "customers_rels" CASCADE;
   DROP TABLE "follow_ups" CASCADE;
   DROP TABLE "follow_ups_rels" CASCADE;
   DROP TABLE "lead_ownership_history" CASCADE;

   -- leads 扩展列
   ALTER TABLE "leads" DROP COLUMN "customer_id";
   ALTER TABLE "leads" DROP COLUMN "stage";
   ALTER TABLE "leads" DROP COLUMN "ownership_status";
   ALTER TABLE "leads" DROP COLUMN "team_id";
   ALTER TABLE "leads" DROP COLUMN "city_id";
   ALTER TABLE "leads" DROP COLUMN "area_min";
   ALTER TABLE "leads" DROP COLUMN "area_max";
   ALTER TABLE "leads" DROP COLUMN "budget_min";
   ALTER TABLE "leads" DROP COLUMN "budget_max";
   ALTER TABLE "leads" DROP COLUMN "currency";
   ALTER TABLE "leads" DROP COLUMN "billing_period";
   ALTER TABLE "leads" DROP COLUMN "seat_count";
   ALTER TABLE "leads" DROP COLUMN "lease_months";
   ALTER TABLE "leads" DROP COLUMN "move_in_date";
   ALTER TABLE "leads" DROP COLUMN "special_requirements";
   ALTER TABLE "leads" DROP COLUMN "effective_created_at";
   ALTER TABLE "leads" DROP COLUMN "effective_source_channel";
   ALTER TABLE "leads" DROP COLUMN "source_channel";
   ALTER TABLE "leads" DROP COLUMN "first_valid_follow_up_at";
   ALTER TABLE "leads" DROP COLUMN "last_valid_follow_up_at";
   ALTER TABLE "leads" DROP COLUMN "next_follow_up_at";
   ALTER TABLE "leads" DROP COLUMN "runtime_policy_version";
   ALTER TABLE "leads" DROP COLUMN "first_follow_up_sla_seconds";
   ALTER TABLE "leads" DROP COLUMN "public_pool_recycle_seconds";
   ALTER TABLE "leads" DROP COLUMN "claim_protection_seconds";
   ALTER TABLE "leads" DROP COLUMN "daily_claim_limit";
   ALTER TABLE "leads" DROP COLUMN "active_lead_cap";
   ALTER TABLE "leads" DROP COLUMN "version";

   -- 枚举类型
   DROP TYPE "public"."enum_customers_status";
   DROP TYPE "public"."enum_follow_ups_method";
   DROP TYPE "public"."enum_follow_ups_result";
   DROP TYPE "public"."enum_lead_ownership_history_action";
   DROP TYPE "public"."enum_lead_ownership_history_ownership_status";
   DROP TYPE "public"."enum_leads_stage";
   DROP TYPE "public"."enum_leads_ownership_status";
   DROP TYPE "public"."enum_leads_currency";
   DROP TYPE "public"."enum_leads_billing_period";
  `)
}
