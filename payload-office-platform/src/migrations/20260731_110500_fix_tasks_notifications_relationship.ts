import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tasks" ADD COLUMN "assignee_id" integer;
  CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id");
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "notifications" ADD COLUMN "recipient_id" integer;
  ALTER TABLE "notifications" ALTER COLUMN "recipient_id" SET NOT NULL;
  CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id");
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_assignee_id_users_id_fk";
  DROP INDEX IF EXISTS "tasks_assignee_idx";
  ALTER TABLE "tasks" DROP COLUMN IF EXISTS "assignee_id";
  ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_recipient_id_users_id_fk";
  DROP INDEX IF EXISTS "notifications_recipient_idx";
  ALTER TABLE "notifications" DROP COLUMN IF EXISTS "recipient_id";`)
}
