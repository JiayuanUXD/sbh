import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_information_corrections_target_type" AS ENUM('listing', 'building');
  CREATE TYPE "public"."enum_information_corrections_category" AS ENUM('price', 'area', 'availability', 'media', 'location', 'building-fact', 'other');
  CREATE TYPE "public"."enum_information_corrections_status" AS ENUM('new', 'triaged', 'resolved', 'rejected');
  ALTER TYPE "public"."enum_domain_events_event_type" ADD VALUE 'correction.created';
  ALTER TYPE "public"."enum_domain_events_aggregate_type" ADD VALUE 'correction';
  CREATE TABLE "information_corrections" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"target_type" "enum_information_corrections_target_type" NOT NULL,
  	"target_slug" varchar NOT NULL,
  	"category" "enum_information_corrections_category" NOT NULL,
  	"description" varchar NOT NULL,
  	"status" "enum_information_corrections_status" DEFAULT 'new' NOT NULL,
  	"request_id" varchar NOT NULL,
  	"idempotency_key" varchar NOT NULL,
  	"reporter_ip_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "information_corrections_id" integer;
  CREATE UNIQUE INDEX "information_corrections_idempotency_key_idx" ON "information_corrections" USING btree ("idempotency_key");
  CREATE INDEX "information_corrections_updated_at_idx" ON "information_corrections" USING btree ("updated_at");
  CREATE INDEX "information_corrections_created_at_idx" ON "information_corrections" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_information_corrections_fk" FOREIGN KEY ("information_corrections_id") REFERENCES "public"."information_corrections"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_information_corrections_id_idx" ON "payload_locked_documents_rels" USING btree ("information_corrections_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "information_corrections" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "information_corrections" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_information_corrections_fk";
  
  ALTER TABLE "domain_events" ALTER COLUMN "event_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_domain_events_event_type";
  CREATE TYPE "public"."enum_domain_events_event_type" AS ENUM('listing.published', 'listing.unpublished', 'listing.review_submitted', 'listing.review_approved', 'listing.review_rejected', 'report.sustained', 'report.dismissed', 'report.supply_paused', 'report.supply_resumed', 'lead.created', 'lead.assigned', 'lead.transferred', 'lead.reclaimed', 'lead.lost', 'followup.completed', 'followup.corrected', 'sla.breached', 'task.completed', 'task.cancelled');
  ALTER TABLE "domain_events" ALTER COLUMN "event_type" SET DATA TYPE "public"."enum_domain_events_event_type" USING "event_type"::"public"."enum_domain_events_event_type";
  ALTER TABLE "domain_events" ALTER COLUMN "aggregate_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_domain_events_aggregate_type";
  CREATE TYPE "public"."enum_domain_events_aggregate_type" AS ENUM('listing', 'report', 'lead', 'followup', 'sla', 'task');
  ALTER TABLE "domain_events" ALTER COLUMN "aggregate_type" SET DATA TYPE "public"."enum_domain_events_aggregate_type" USING "aggregate_type"::"public"."enum_domain_events_aggregate_type";
  DROP INDEX "payload_locked_documents_rels_information_corrections_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "information_corrections_id";
  DROP TYPE "public"."enum_information_corrections_target_type";
  DROP TYPE "public"."enum_information_corrections_category";
  DROP TYPE "public"."enum_information_corrections_status";`)
}
