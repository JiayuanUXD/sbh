import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "inquiry_rate_limit" (
  	"key" varchar PRIMARY KEY NOT NULL,
  	"window_start" bigint NOT NULL,
  	"count" integer NOT NULL DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE INDEX "inquiry_rate_limit_window_start_idx" ON "inquiry_rate_limit" USING btree ("window_start");
  CREATE INDEX "inquiry_rate_limit_updated_at_idx" ON "inquiry_rate_limit" USING btree ("updated_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "inquiry_rate_limit" CASCADE;`)
}
