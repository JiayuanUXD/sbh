import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_leads_source" AS ENUM('frontend-form', 'phone', 'import', 'other');
  ALTER TABLE "leads" ADD COLUMN "source" "enum_leads_source" DEFAULT 'frontend-form';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "leads" DROP COLUMN "source";
  DROP TYPE "public"."enum_leads_source";`)
}
