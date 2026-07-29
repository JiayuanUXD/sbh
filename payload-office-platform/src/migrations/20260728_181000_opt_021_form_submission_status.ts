import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * OPT-021 form submission processing status.
 *
 * The status column is added as nullable first so existing rows can be backfilled
 * explicitly before the default and NOT NULL invariant are applied.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_form_submissions_processing_status" AS ENUM('new', 'processing', 'processed');

   ALTER TABLE "form_submissions" ADD COLUMN "processing_status" "enum_form_submissions_processing_status";
   ALTER TABLE "form_submissions" ADD COLUMN "processed_at" timestamp(3) with time zone;
   ALTER TABLE "form_submissions" ADD COLUMN "processed_by_id" integer;

   UPDATE "form_submissions" SET "processing_status" = 'new' WHERE "processing_status" IS NULL;
   ALTER TABLE "form_submissions" ALTER COLUMN "processing_status" SET DEFAULT 'new';
   ALTER TABLE "form_submissions" ALTER COLUMN "processing_status" SET NOT NULL;

   ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_processed_by_id_users_id_fk" FOREIGN KEY ("processed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

   CREATE INDEX "form_submissions_processing_status_idx" ON "form_submissions" USING btree ("processing_status");
   CREATE INDEX "form_submissions_processed_by_idx" ON "form_submissions" USING btree ("processed_by_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "form_submissions_processing_status_idx";
   DROP INDEX "form_submissions_processed_by_idx";

   ALTER TABLE "form_submissions"
     DROP CONSTRAINT "form_submissions_processed_by_id_users_id_fk";

   ALTER TABLE "form_submissions" DROP COLUMN "processed_by_id";
   ALTER TABLE "form_submissions" DROP COLUMN "processed_at";
   ALTER TABLE "form_submissions" DROP COLUMN "processing_status";

   DROP TYPE "public"."enum_form_submissions_processing_status";
  `)
}
