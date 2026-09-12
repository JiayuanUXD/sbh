import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "city_site_profiles" ADD COLUMN "service_phone" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "member_entry_visible" boolean DEFAULT false;
  ALTER TABLE "site_settings" ADD COLUMN "service_phone_visible" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "service_phone" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "city_site_profiles" DROP COLUMN "service_phone";
  ALTER TABLE "site_settings" DROP COLUMN "member_entry_visible";
  ALTER TABLE "site_settings" DROP COLUMN "service_phone_visible";
  ALTER TABLE "site_settings" DROP COLUMN "service_phone";`)
}
