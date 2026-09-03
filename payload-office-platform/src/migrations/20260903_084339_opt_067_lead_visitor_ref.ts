import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "leads" ADD COLUMN "visitor_ref" varchar;
  CREATE INDEX "leads_visitor_ref_idx" ON "leads" USING btree ("visitor_ref");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "leads_visitor_ref_idx";
  ALTER TABLE "leads" DROP COLUMN "visitor_ref";`)
}
