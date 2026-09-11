import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_site_settings_main_nav_target" ADD VALUE 'page';
  ALTER TYPE "public"."enum_site_settings_footer_columns_links_target" ADD VALUE 'page';
  ALTER TABLE "site_settings_main_nav" ADD COLUMN "page_id" integer;
  ALTER TABLE "site_settings_footer_columns_links" ADD COLUMN "page_id" integer;
  ALTER TABLE "site_settings_main_nav" ADD CONSTRAINT "site_settings_main_nav_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_settings_footer_columns_links" ADD CONSTRAINT "site_settings_footer_columns_links_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "site_settings_main_nav_page_idx" ON "site_settings_main_nav" USING btree ("page_id");
  CREATE INDEX "site_settings_footer_columns_links_page_idx" ON "site_settings_footer_columns_links" USING btree ("page_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings_main_nav" DROP CONSTRAINT "site_settings_main_nav_page_id_pages_id_fk";
  
  ALTER TABLE "site_settings_footer_columns_links" DROP CONSTRAINT "site_settings_footer_columns_links_page_id_pages_id_fk";
  
  ALTER TABLE "site_settings_main_nav" ALTER COLUMN "target" SET DATA TYPE text;
  DROP TYPE "public"."enum_site_settings_main_nav_target";
  CREATE TYPE "public"."enum_site_settings_main_nav_target" AS ENUM('home', 'listings', 'buildings', 'entrust', 'publish', 'news', 'city-partner', 'sale', 'listings-type-traditional-office', 'listings-type-coworking', 'listings-type-full-floor', 'listings-type-serviced-office');
  ALTER TABLE "site_settings_main_nav" ALTER COLUMN "target" SET DATA TYPE "public"."enum_site_settings_main_nav_target" USING "target"::"public"."enum_site_settings_main_nav_target";
  ALTER TABLE "site_settings_footer_columns_links" ALTER COLUMN "target" SET DATA TYPE text;
  DROP TYPE "public"."enum_site_settings_footer_columns_links_target";
  CREATE TYPE "public"."enum_site_settings_footer_columns_links_target" AS ENUM('home', 'listings', 'buildings', 'entrust', 'publish', 'news', 'city-partner', 'sale', 'listings-type-traditional-office', 'listings-type-coworking', 'listings-type-full-floor', 'listings-type-serviced-office');
  ALTER TABLE "site_settings_footer_columns_links" ALTER COLUMN "target" SET DATA TYPE "public"."enum_site_settings_footer_columns_links_target" USING "target"::"public"."enum_site_settings_footer_columns_links_target";
  DROP INDEX "site_settings_main_nav_page_idx";
  DROP INDEX "site_settings_footer_columns_links_page_idx";
  ALTER TABLE "site_settings_main_nav" DROP COLUMN "page_id";
  ALTER TABLE "site_settings_footer_columns_links" DROP COLUMN "page_id";`)
}
