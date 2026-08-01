import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_leads_viewing_preference_status" AS ENUM('pending-confirmation');
  ALTER TABLE "leads" ADD COLUMN "viewing_preference_starts_at" timestamp(3) with time zone;
  ALTER TABLE "leads" ADD COLUMN "viewing_preference_ends_at" timestamp(3) with time zone;
  ALTER TABLE "leads" ADD COLUMN "viewing_preference_timezone" varchar;
  ALTER TABLE "leads" ADD COLUMN "viewing_preference_status" "enum_leads_viewing_preference_status";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "leads" DROP COLUMN "viewing_preference_starts_at";
  ALTER TABLE "leads" DROP COLUMN "viewing_preference_ends_at";
  ALTER TABLE "leads" DROP COLUMN "viewing_preference_timezone";
  ALTER TABLE "leads" DROP COLUMN "viewing_preference_status";
  DROP TYPE "public"."enum_leads_viewing_preference_status";`)
}
