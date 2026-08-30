import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "listings" ADD COLUMN "room_number" varchar;
  CREATE UNIQUE INDEX "building_roomNumber_idx" ON "listings" USING btree ("building_id","room_number");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "building_roomNumber_idx";
  ALTER TABLE "listings" DROP COLUMN "room_number";`)
}
