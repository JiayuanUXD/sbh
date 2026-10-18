import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "buildings" ALTER COLUMN "grade" SET DATA TYPE text;
  DROP TYPE "public"."enum_buildings_grade";
  CREATE TYPE "public"."enum_buildings_grade" AS ENUM('super-grade-a', 'grade-a', 'grade-b', 'ungraded', 'creative-park', 'serviced-office');
  ALTER TABLE "buildings" ALTER COLUMN "grade" SET DATA TYPE "public"."enum_buildings_grade" USING "grade"::"public"."enum_buildings_grade";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "buildings" ALTER COLUMN "grade" SET DATA TYPE text;
  DROP TYPE "public"."enum_buildings_grade";
  CREATE TYPE "public"."enum_buildings_grade" AS ENUM('grade-a', 'super-grade-a', 'creative-park', 'serviced-office');
  ALTER TABLE "buildings" ALTER COLUMN "grade" SET DATA TYPE "public"."enum_buildings_grade" USING "grade"::"public"."enum_buildings_grade";`)
}
