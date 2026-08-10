import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "locations" ADD COLUMN "city_id" integer;
  ALTER TABLE "locations" ADD CONSTRAINT "locations_city_id_locations_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "locations_city_idx" ON "locations" USING btree ("city_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "locations" DROP CONSTRAINT "locations_city_id_locations_id_fk";
  
  DROP INDEX "locations_city_idx";
  ALTER TABLE "locations" DROP COLUMN "city_id";`)
}
