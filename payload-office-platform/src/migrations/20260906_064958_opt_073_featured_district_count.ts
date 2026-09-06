import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_city_site_profiles_featured_district_count" AS ENUM('5', '3');
  ALTER TABLE "city_site_profiles" ADD COLUMN "featured_district_count" "enum_city_site_profiles_featured_district_count" DEFAULT '5';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "city_site_profiles" DROP COLUMN "featured_district_count";
  DROP TYPE "public"."enum_city_site_profiles_featured_district_count";`)
}
