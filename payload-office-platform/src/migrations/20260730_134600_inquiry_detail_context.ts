import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_leads_source_section" AS ENUM('hero', 'sticky-card', 'mobile-bar', 'supply-lease', 'supply-sale', 'supply-coworking', 'recommendation');
  CREATE TYPE "public"."enum_leads_active_supply_group" AS ENUM('lease', 'sale', 'coworking');
  ALTER TABLE "leads" ADD COLUMN "source_section" "enum_leads_source_section";
  ALTER TABLE "leads" ADD COLUMN "active_supply_group" "enum_leads_active_supply_group";
  ALTER TABLE "leads" ADD COLUMN "current_filters" jsonb;
  ALTER TABLE "leads" ADD COLUMN "price_snapshot" jsonb;
  ALTER TABLE "leads" ADD COLUMN "price_snapshot_submitted_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "leads" DROP COLUMN "source_section";
  ALTER TABLE "leads" DROP COLUMN "active_supply_group";
  ALTER TABLE "leads" DROP COLUMN "current_filters";
  ALTER TABLE "leads" DROP COLUMN "price_snapshot";
  ALTER TABLE "leads" DROP COLUMN "price_snapshot_submitted_at";
  DROP TYPE "public"."enum_leads_source_section";
  DROP TYPE "public"."enum_leads_active_supply_group";`)
}
