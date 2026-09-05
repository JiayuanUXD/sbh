import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_site_settings_watermark_badge_position" AS ENUM('bottom-right', 'bottom-left', 'top-right', 'top-left');
  ALTER TABLE "site_settings" ADD COLUMN "watermark_enabled" boolean DEFAULT false;
  ALTER TABLE "site_settings" ADD COLUMN "watermark_tiled_text" varchar DEFAULT '商办荟';
  ALTER TABLE "site_settings" ADD COLUMN "watermark_tiled_density" numeric DEFAULT 3;
  ALTER TABLE "site_settings" ADD COLUMN "watermark_tiled_opacity" numeric DEFAULT 0.38;
  ALTER TABLE "site_settings" ADD COLUMN "watermark_tiled_angle" numeric DEFAULT -30;
  ALTER TABLE "site_settings" ADD COLUMN "watermark_badge_text" varchar DEFAULT '商办荟';
  ALTER TABLE "site_settings" ADD COLUMN "watermark_badge_position" "enum_site_settings_watermark_badge_position" DEFAULT 'bottom-right';
  ALTER TABLE "site_settings" ADD COLUMN "watermark_badge_opacity" numeric DEFAULT 0.95;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" DROP COLUMN "watermark_enabled";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_tiled_text";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_tiled_density";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_tiled_opacity";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_tiled_angle";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_badge_text";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_badge_position";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_badge_opacity";
  DROP TYPE "public"."enum_site_settings_watermark_badge_position";`)
}
