import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_listings_data_source_source" AS ENUM('huizuxuanzhi');
  ALTER TABLE "listings" ADD COLUMN "data_source_source" "enum_listings_data_source_source";
  ALTER TABLE "listings" ADD COLUMN "data_source_external_id" varchar;
  ALTER TABLE "listings" ADD COLUMN "data_source_source_url" varchar;
  ALTER TABLE "listings" ADD COLUMN "data_source_synced_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "listings" DROP COLUMN "data_source_source";
  ALTER TABLE "listings" DROP COLUMN "data_source_external_id";
  ALTER TABLE "listings" DROP COLUMN "data_source_source_url";
  ALTER TABLE "listings" DROP COLUMN "data_source_synced_at";
  DROP TYPE "public"."enum_listings_data_source_source";`)
}
