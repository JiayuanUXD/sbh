import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_site_settings_type_cards_slot" AS ENUM('traditional-office', 'coworking', 'full-floor', 'serviced-office', 'creative-park');
  CREATE TABLE "site_settings_value_props" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"body" varchar NOT NULL
  );
  
  CREATE TABLE "site_settings_type_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"slot" "enum_site_settings_type_cards_slot" NOT NULL,
  	"label" varchar NOT NULL,
  	"sublabel" varchar,
  	"visible" boolean DEFAULT true
  );
  
  CREATE TABLE "site_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"site_name" varchar DEFAULT '商办租赁',
  	"logo_id" integer,
  	"hero_heading" varchar DEFAULT '汇聚高端商务空间，赋能企业卓越成长',
  	"slogan" varchar DEFAULT '覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策',
  	"price_disclaimer" varchar DEFAULT '页面价格为公开挂牌价，实际价格以顾问报价为准',
  	"image_disclaimer" varchar DEFAULT '示意图，以现场实际情况为准',
  	"footer_brand_blurb" varchar DEFAULT '聚合{城市}甲级写字楼、独栋办公、共享办公与整层办公机会，免费帮成长型企业匹配更体面的办公室。',
  	"copyright_holder" varchar DEFAULT '商办租赁平台',
  	"footer_tagline_suffix" varchar DEFAULT '商务办公租赁',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "city_site_profiles" ADD COLUMN "hero_video_id" integer;
  ALTER TABLE "city_site_profiles" ADD COLUMN "hero_video_enabled" boolean DEFAULT true;
  ALTER TABLE "site_settings_value_props" ADD CONSTRAINT "site_settings_value_props_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_settings_type_cards" ADD CONSTRAINT "site_settings_type_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_logo_id_media_id_fk" FOREIGN KEY ("logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "site_settings_value_props_order_idx" ON "site_settings_value_props" USING btree ("_order");
  CREATE INDEX "site_settings_value_props_parent_id_idx" ON "site_settings_value_props" USING btree ("_parent_id");
  CREATE INDEX "site_settings_type_cards_order_idx" ON "site_settings_type_cards" USING btree ("_order");
  CREATE INDEX "site_settings_type_cards_parent_id_idx" ON "site_settings_type_cards" USING btree ("_parent_id");
  CREATE INDEX "site_settings_logo_idx" ON "site_settings" USING btree ("logo_id");
  ALTER TABLE "city_site_profiles" ADD CONSTRAINT "city_site_profiles_hero_video_id_media_id_fk" FOREIGN KEY ("hero_video_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "city_site_profiles_hero_video_idx" ON "city_site_profiles" USING btree ("hero_video_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings_value_props" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_settings_type_cards" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "site_settings_value_props" CASCADE;
  DROP TABLE "site_settings_type_cards" CASCADE;
  DROP TABLE "site_settings" CASCADE;
  ALTER TABLE "city_site_profiles" DROP CONSTRAINT "city_site_profiles_hero_video_id_media_id_fk";
  
  DROP INDEX "city_site_profiles_hero_video_idx";
  ALTER TABLE "city_site_profiles" DROP COLUMN "hero_video_id";
  ALTER TABLE "city_site_profiles" DROP COLUMN "hero_video_enabled";
  DROP TYPE "public"."enum_site_settings_type_cards_slot";`)
}
