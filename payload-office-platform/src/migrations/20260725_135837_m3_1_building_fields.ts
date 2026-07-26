import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_buildings_operational_status" AS ENUM('active', 'disabled');
  CREATE TYPE "public"."enum_buildings_building_type" AS ENUM('office_building', 'business_park', 'commercial_complex', 'serviced_office');
  CREATE TYPE "public"."enum_buildings_verification_status" AS ENUM('unverified', 'pending', 'verified');
  CREATE TYPE "public"."enum_buildings_registration_capability" AS ENUM('supported', 'conditional', 'not_supported');
  ALTER TABLE "buildings" ADD COLUMN "operational_status" "enum_buildings_operational_status" DEFAULT 'active';
  ALTER TABLE "buildings" ADD COLUMN "building_type" "enum_buildings_building_type";
  ALTER TABLE "buildings" ADD COLUMN "verification_status" "enum_buildings_verification_status" DEFAULT 'unverified';
  ALTER TABLE "buildings" ADD COLUMN "registration_capability" "enum_buildings_registration_capability";
  ALTER TABLE "buildings" ADD COLUMN "recommended_order" numeric DEFAULT 0;
  ALTER TABLE "buildings" ADD COLUMN "version" numeric DEFAULT 1;
  ALTER TABLE "buildings" ADD COLUMN "city_id" integer;
  ALTER TABLE "buildings" ADD COLUMN "completion_date" timestamp(3) with time zone;
  ALTER TABLE "buildings" ADD COLUMN "total_floors" numeric;
  ALTER TABLE "buildings" ADD COLUMN "property_company" varchar;
  ALTER TABLE "buildings" ADD COLUMN "property_fee" numeric;
  ALTER TABLE "buildings" ADD COLUMN "parking_spaces" numeric;
  ALTER TABLE "buildings" ADD CONSTRAINT "buildings_city_id_locations_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "buildings_city_idx" ON "buildings" USING btree ("city_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "buildings" DROP CONSTRAINT "buildings_city_id_locations_id_fk";
  
  DROP INDEX "buildings_city_idx";
  ALTER TABLE "buildings" DROP COLUMN "operational_status";
  ALTER TABLE "buildings" DROP COLUMN "building_type";
  ALTER TABLE "buildings" DROP COLUMN "verification_status";
  ALTER TABLE "buildings" DROP COLUMN "registration_capability";
  ALTER TABLE "buildings" DROP COLUMN "recommended_order";
  ALTER TABLE "buildings" DROP COLUMN "version";
  ALTER TABLE "buildings" DROP COLUMN "city_id";
  ALTER TABLE "buildings" DROP COLUMN "completion_date";
  ALTER TABLE "buildings" DROP COLUMN "total_floors";
  ALTER TABLE "buildings" DROP COLUMN "property_company";
  ALTER TABLE "buildings" DROP COLUMN "property_fee";
  ALTER TABLE "buildings" DROP COLUMN "parking_spaces";
  DROP TYPE "public"."enum_buildings_operational_status";
  DROP TYPE "public"."enum_buildings_building_type";
  DROP TYPE "public"."enum_buildings_verification_status";
  DROP TYPE "public"."enum_buildings_registration_capability";`)
}
