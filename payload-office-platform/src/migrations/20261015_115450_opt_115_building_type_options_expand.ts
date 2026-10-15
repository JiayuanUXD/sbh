import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "buildings" ALTER COLUMN "building_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_buildings_building_type";
  CREATE TYPE "public"."enum_buildings_building_type" AS ENUM('traditional_office', 'coworking', 'full_floor', 'standalone_building', 'business_park', 'office_building', 'commercial_complex', 'serviced_office');
  ALTER TABLE "buildings" ALTER COLUMN "building_type" SET DATA TYPE "public"."enum_buildings_building_type" USING "building_type"::"public"."enum_buildings_building_type";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "buildings" ALTER COLUMN "building_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_buildings_building_type";
  CREATE TYPE "public"."enum_buildings_building_type" AS ENUM('office_building', 'business_park', 'commercial_complex', 'serviced_office');
  ALTER TABLE "buildings" ALTER COLUMN "building_type" SET DATA TYPE "public"."enum_buildings_building_type" USING "building_type"::"public"."enum_buildings_building_type";`)
}
