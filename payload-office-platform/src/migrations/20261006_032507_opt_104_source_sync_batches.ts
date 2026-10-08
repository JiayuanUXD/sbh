import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_source_sync_batches_source" AS ENUM('huizuxuanzhi');
  CREATE TYPE "public"."enum_source_sync_batches_kind" AS ENUM('buildings', 'listings', 'retire');
  CREATE TYPE "public"."enum_source_sync_batches_status" AS ENUM('queued', 'running', 'completed', 'failed');
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'run-source-sync' BEFORE 'createCollectionExport';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'run-source-sync' BEFORE 'createCollectionExport';
  CREATE TABLE "source_sync_batches" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"source" "enum_source_sync_batches_source" NOT NULL,
  	"kind" "enum_source_sync_batches_kind" NOT NULL,
  	"status" "enum_source_sync_batches_status" DEFAULT 'queued' NOT NULL,
  	"operator_id" integer,
  	"file_name" varchar,
  	"row_count" numeric,
  	"rows" jsonb,
  	"cursor" numeric DEFAULT 0,
  	"stats_created" numeric DEFAULT 0,
  	"stats_updated" numeric DEFAULT 0,
  	"stats_unchanged" numeric DEFAULT 0,
  	"stats_retired" numeric DEFAULT 0,
  	"stats_skipped" numeric DEFAULT 0,
  	"stats_failed" numeric DEFAULT 0,
  	"stats_images_created" numeric DEFAULT 0,
  	"affected" jsonb,
  	"write_errors" jsonb,
  	"started_at" timestamp(3) with time zone,
  	"finished_at" timestamp(3) with time zone,
  	"rolled_back_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "source_sync_batches_id" integer;
  ALTER TABLE "source_sync_batches" ADD CONSTRAINT "source_sync_batches_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "source_sync_batches_operator_idx" ON "source_sync_batches" USING btree ("operator_id");
  CREATE INDEX "source_sync_batches_updated_at_idx" ON "source_sync_batches" USING btree ("updated_at");
  CREATE INDEX "source_sync_batches_created_at_idx" ON "source_sync_batches" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_sync_batches_fk" FOREIGN KEY ("source_sync_batches_id") REFERENCES "public"."source_sync_batches"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_source_sync_batches_id_idx" ON "payload_locked_documents_rels" USING btree ("source_sync_batches_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "source_sync_batches" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "source_sync_batches" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_source_sync_batches_fk";
  
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'notify-supply-submission-created', 'notify-city-partner-application-created', 'reconcile-city-partner-notification-outbox', 'run-supply-import', 'cascade-merchant-stop-listings', 'rebake-media-watermark', 'createCollectionExport', 'createCollectionImport');
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'notify-supply-submission-created', 'notify-city-partner-application-created', 'reconcile-city-partner-notification-outbox', 'run-supply-import', 'cascade-merchant-stop-listings', 'rebake-media-watermark', 'createCollectionExport', 'createCollectionImport');
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";
  DROP INDEX "payload_locked_documents_rels_source_sync_batches_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "source_sync_batches_id";
  DROP TYPE "public"."enum_source_sync_batches_source";
  DROP TYPE "public"."enum_source_sync_batches_kind";
  DROP TYPE "public"."enum_source_sync_batches_status";`)
}
