import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_advisor_service_hours_weekly_hours_day" AS ENUM('0', '1', '2', '3', '4', '5', '6');
  CREATE TABLE "advisor_service_hours_weekly_hours" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"day" "enum_advisor_service_hours_weekly_hours_day" NOT NULL,
  	"start" varchar NOT NULL,
  	"end" varchar NOT NULL
  );
  
  CREATE TABLE "advisor_service_hours_holidays_ranges" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"start" varchar NOT NULL,
  	"end" varchar NOT NULL
  );
  
  CREATE TABLE "advisor_service_hours_holidays" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"date" varchar NOT NULL
  );
  
  CREATE TABLE "advisor_service_hours" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"timezone" varchar DEFAULT 'Asia/Shanghai',
  	"open_message" varchar DEFAULT '当前服务中，欢迎咨询' NOT NULL,
  	"closed_message" varchar DEFAULT '当前非服务时段' NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "advisor_service_hours_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "advisor_service_hours_weekly_hours" ADD CONSTRAINT "advisor_service_hours_weekly_hours_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."advisor_service_hours"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "advisor_service_hours_holidays_ranges" ADD CONSTRAINT "advisor_service_hours_holidays_ranges_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."advisor_service_hours_holidays"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "advisor_service_hours_holidays" ADD CONSTRAINT "advisor_service_hours_holidays_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."advisor_service_hours"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "advisor_service_hours_rels" ADD CONSTRAINT "advisor_service_hours_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."advisor_service_hours"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "advisor_service_hours_rels" ADD CONSTRAINT "advisor_service_hours_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "advisor_service_hours_weekly_hours_order_idx" ON "advisor_service_hours_weekly_hours" USING btree ("_order");
  CREATE INDEX "advisor_service_hours_weekly_hours_parent_id_idx" ON "advisor_service_hours_weekly_hours" USING btree ("_parent_id");
  CREATE INDEX "advisor_service_hours_holidays_ranges_order_idx" ON "advisor_service_hours_holidays_ranges" USING btree ("_order");
  CREATE INDEX "advisor_service_hours_holidays_ranges_parent_id_idx" ON "advisor_service_hours_holidays_ranges" USING btree ("_parent_id");
  CREATE INDEX "advisor_service_hours_holidays_order_idx" ON "advisor_service_hours_holidays" USING btree ("_order");
  CREATE INDEX "advisor_service_hours_holidays_parent_id_idx" ON "advisor_service_hours_holidays" USING btree ("_parent_id");
  CREATE INDEX "advisor_service_hours_rels_order_idx" ON "advisor_service_hours_rels" USING btree ("order");
  CREATE INDEX "advisor_service_hours_rels_parent_idx" ON "advisor_service_hours_rels" USING btree ("parent_id");
  CREATE INDEX "advisor_service_hours_rels_path_idx" ON "advisor_service_hours_rels" USING btree ("path");
  CREATE INDEX "advisor_service_hours_rels_users_id_idx" ON "advisor_service_hours_rels" USING btree ("users_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "advisor_service_hours_weekly_hours" CASCADE;
  DROP TABLE "advisor_service_hours_holidays_ranges" CASCADE;
  DROP TABLE "advisor_service_hours_holidays" CASCADE;
  DROP TABLE "advisor_service_hours" CASCADE;
  DROP TABLE "advisor_service_hours_rels" CASCADE;
  DROP TYPE "public"."enum_advisor_service_hours_weekly_hours_day";`)
}
