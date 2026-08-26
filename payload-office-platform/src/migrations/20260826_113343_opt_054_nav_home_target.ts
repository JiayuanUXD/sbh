import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_site_settings_main_nav_target" ADD VALUE 'home' BEFORE 'listings';
  ALTER TYPE "public"."enum_site_settings_footer_columns_links_target" ADD VALUE 'home' BEFORE 'listings';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings_main_nav" ALTER COLUMN "target" SET DATA TYPE text;
  DROP TYPE "public"."enum_site_settings_main_nav_target";
  CREATE TYPE "public"."enum_site_settings_main_nav_target" AS ENUM('listings', 'buildings', 'entrust', 'publish', 'news', 'city-partner', 'sale', 'listings-type-traditional-office', 'listings-type-coworking', 'listings-type-full-floor', 'listings-type-serviced-office');
  ALTER TABLE "site_settings_main_nav" ALTER COLUMN "target" SET DATA TYPE "public"."enum_site_settings_main_nav_target" USING "target"::"public"."enum_site_settings_main_nav_target";
  ALTER TABLE "site_settings_footer_columns_links" ALTER COLUMN "target" SET DATA TYPE text;
  DROP TYPE "public"."enum_site_settings_footer_columns_links_target";
  CREATE TYPE "public"."enum_site_settings_footer_columns_links_target" AS ENUM('listings', 'buildings', 'entrust', 'publish', 'news', 'city-partner', 'sale', 'listings-type-traditional-office', 'listings-type-coworking', 'listings-type-full-floor', 'listings-type-serviced-office');
  ALTER TABLE "site_settings_footer_columns_links" ALTER COLUMN "target" SET DATA TYPE "public"."enum_site_settings_footer_columns_links_target" USING "target"::"public"."enum_site_settings_footer_columns_links_target";`)
}
