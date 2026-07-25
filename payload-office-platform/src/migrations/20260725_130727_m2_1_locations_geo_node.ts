import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_locations_status" AS ENUM('active', 'disabled');
  ALTER TABLE "locations" ALTER COLUMN "type" SET DATA TYPE text;
  DROP TYPE "public"."enum_locations_type";
  CREATE TYPE "public"."enum_locations_type" AS ENUM('city', 'district', 'business_area', 'metro_line', 'metro_station');
  ALTER TABLE "locations" ALTER COLUMN "type" SET DATA TYPE "public"."enum_locations_type" USING "type"::"public"."enum_locations_type";
  ALTER TABLE "locations" ADD COLUMN "immutable_code" varchar NOT NULL;
  ALTER TABLE "locations" ADD COLUMN "status" "enum_locations_status" DEFAULT 'active' NOT NULL;
  ALTER TABLE "locations" ADD COLUMN "frontend_visible" boolean DEFAULT false;
  ALTER TABLE "locations" ADD COLUMN "center_latitude" numeric;
  ALTER TABLE "locations" ADD COLUMN "center_longitude" numeric;
  ALTER TABLE "locations" ADD COLUMN "version" numeric DEFAULT 1;
  CREATE UNIQUE INDEX "locations_immutable_code_idx" ON "locations" USING btree ("immutable_code");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "locations" ALTER COLUMN "type" SET DATA TYPE text;
  DROP TYPE "public"."enum_locations_type";
  CREATE TYPE "public"."enum_locations_type" AS ENUM('city', 'district', 'business-district', 'metro');
  ALTER TABLE "locations" ALTER COLUMN "type" SET DATA TYPE "public"."enum_locations_type" USING "type"::"public"."enum_locations_type";
  DROP INDEX "locations_immutable_code_idx";
  ALTER TABLE "locations" DROP COLUMN "immutable_code";
  ALTER TABLE "locations" DROP COLUMN "status";
  ALTER TABLE "locations" DROP COLUMN "frontend_visible";
  ALTER TABLE "locations" DROP COLUMN "center_latitude";
  ALTER TABLE "locations" DROP COLUMN "center_longitude";
  ALTER TABLE "locations" DROP COLUMN "version";
  DROP TYPE "public"."enum_locations_status";`)
}
