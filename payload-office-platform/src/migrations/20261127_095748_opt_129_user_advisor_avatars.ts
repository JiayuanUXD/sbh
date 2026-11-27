import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" ADD COLUMN "avatar_id" integer;
  ALTER TABLE "members" ADD COLUMN "avatar_id" integer;
  ALTER TABLE "site_settings" ADD COLUMN "advisor_avatar_id" integer;
  ALTER TABLE "users" ADD CONSTRAINT "users_avatar_id_media_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "members" ADD CONSTRAINT "members_avatar_id_media_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_advisor_avatar_id_media_id_fk" FOREIGN KEY ("advisor_avatar_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "users_avatar_idx" ON "users" USING btree ("avatar_id");
  CREATE INDEX "members_avatar_idx" ON "members" USING btree ("avatar_id");
  CREATE INDEX "site_settings_advisor_avatar_idx" ON "site_settings" USING btree ("advisor_avatar_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" DROP CONSTRAINT "users_avatar_id_media_id_fk";
  
  ALTER TABLE "members" DROP CONSTRAINT "members_avatar_id_media_id_fk";
  
  ALTER TABLE "site_settings" DROP CONSTRAINT "site_settings_advisor_avatar_id_media_id_fk";
  
  DROP INDEX "users_avatar_idx";
  DROP INDEX "members_avatar_idx";
  DROP INDEX "site_settings_advisor_avatar_idx";
  ALTER TABLE "users" DROP COLUMN "avatar_id";
  ALTER TABLE "members" DROP COLUMN "avatar_id";
  ALTER TABLE "site_settings" DROP COLUMN "advisor_avatar_id";`)
}
