import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_site_settings_watermark_tiled_source" AS ENUM('text', 'image');
  CREATE TYPE "public"."enum_site_settings_watermark_badge_source" AS ENUM('text', 'image');
  ALTER TABLE "site_settings" ADD COLUMN "watermark_tiled_source" "enum_site_settings_watermark_tiled_source" DEFAULT 'text';
  ALTER TABLE "site_settings" ADD COLUMN "watermark_tiled_image_id" integer;
  ALTER TABLE "site_settings" ADD COLUMN "watermark_tiled_image_scale" numeric DEFAULT 0.18;
  ALTER TABLE "site_settings" ADD COLUMN "watermark_badge_source" "enum_site_settings_watermark_badge_source" DEFAULT 'text';
  ALTER TABLE "site_settings" ADD COLUMN "watermark_badge_image_id" integer;
  ALTER TABLE "site_settings" ADD COLUMN "watermark_badge_image_scale" numeric DEFAULT 0.12;
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_watermark_tiled_image_id_media_id_fk" FOREIGN KEY ("watermark_tiled_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_watermark_badge_image_id_media_id_fk" FOREIGN KEY ("watermark_badge_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "site_settings_watermark_tiled_watermark_tiled_image_idx" ON "site_settings" USING btree ("watermark_tiled_image_id");
  CREATE INDEX "site_settings_watermark_badge_watermark_badge_image_idx" ON "site_settings" USING btree ("watermark_badge_image_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" DROP CONSTRAINT "site_settings_watermark_tiled_image_id_media_id_fk";
  
  ALTER TABLE "site_settings" DROP CONSTRAINT "site_settings_watermark_badge_image_id_media_id_fk";
  
  DROP INDEX "site_settings_watermark_tiled_watermark_tiled_image_idx";
  DROP INDEX "site_settings_watermark_badge_watermark_badge_image_idx";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_tiled_source";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_tiled_image_id";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_tiled_image_scale";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_badge_source";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_badge_image_id";
  ALTER TABLE "site_settings" DROP COLUMN "watermark_badge_image_scale";
  DROP TYPE "public"."enum_site_settings_watermark_tiled_source";
  DROP TYPE "public"."enum_site_settings_watermark_badge_source";`)
}
