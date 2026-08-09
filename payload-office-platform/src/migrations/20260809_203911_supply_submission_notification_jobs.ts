import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_domain_events_event_type" ADD VALUE 'supply-submission.created';
  ALTER TYPE "public"."enum_domain_events_aggregate_type" ADD VALUE 'supply-submission';
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'notify-supply-submission-created' BEFORE 'createCollectionExport';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'notify-supply-submission-created' BEFORE 'createCollectionExport';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "domain_events" ALTER COLUMN "event_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_domain_events_event_type";
  CREATE TYPE "public"."enum_domain_events_event_type" AS ENUM('listing.published', 'listing.unpublished', 'listing.review_submitted', 'listing.review_approved', 'listing.review_rejected', 'report.sustained', 'report.dismissed', 'report.supply_paused', 'report.supply_resumed', 'lead.created', 'lead.assigned', 'lead.transferred', 'lead.reclaimed', 'lead.lost', 'followup.completed', 'followup.corrected', 'sla.breached', 'task.completed', 'task.cancelled', 'correction.created');
  ALTER TABLE "domain_events" ALTER COLUMN "event_type" SET DATA TYPE "public"."enum_domain_events_event_type" USING "event_type"::"public"."enum_domain_events_event_type";
  ALTER TABLE "domain_events" ALTER COLUMN "aggregate_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_domain_events_aggregate_type";
  CREATE TYPE "public"."enum_domain_events_aggregate_type" AS ENUM('listing', 'report', 'lead', 'followup', 'sla', 'task', 'correction');
  ALTER TABLE "domain_events" ALTER COLUMN "aggregate_type" SET DATA TYPE "public"."enum_domain_events_aggregate_type" USING "aggregate_type"::"public"."enum_domain_events_aggregate_type";
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'createCollectionExport', 'createCollectionImport');
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'createCollectionExport', 'createCollectionImport');
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";`)
}
