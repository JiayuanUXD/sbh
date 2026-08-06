import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "locations" ADD COLUMN "cover_image_id" integer;
  ALTER TABLE "locations" ADD CONSTRAINT "locations_cover_image_id_media_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "locations_cover_image_idx" ON "locations" USING btree ("cover_image_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "locations" DROP CONSTRAINT "locations_cover_image_id_media_id_fk";
  
  DROP INDEX "locations_cover_image_idx";
  ALTER TABLE "locations" DROP COLUMN "cover_image_id";`)
}
