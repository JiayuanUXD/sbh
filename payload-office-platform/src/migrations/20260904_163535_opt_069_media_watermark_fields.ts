import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_media_usage" AS ENUM('listing-photo', 'brand', 'article', 'other');
  ALTER TABLE "media" ADD COLUMN "usage" "enum_media_usage" DEFAULT 'listing-photo' NOT NULL;
  ALTER TABLE "media" ADD COLUMN "watermark_version" varchar;
  ALTER TABLE "media" ADD COLUMN "watermark_applied_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "media" DROP COLUMN "usage";
  ALTER TABLE "media" DROP COLUMN "watermark_version";
  ALTER TABLE "media" DROP COLUMN "watermark_applied_at";
  DROP TYPE "public"."enum_media_usage";`)
}
