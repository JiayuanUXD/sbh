import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_domain_events_event_type" AS ENUM('listing.published', 'listing.unpublished', 'listing.review_submitted', 'listing.review_approved', 'listing.review_rejected', 'report.sustained', 'report.dismissed', 'report.supply_paused', 'report.supply_resumed', 'lead.created', 'lead.assigned', 'lead.transferred', 'lead.reclaimed', 'lead.lost', 'followup.completed', 'followup.corrected', 'sla.breached');
  CREATE TYPE "public"."enum_domain_events_aggregate_type" AS ENUM('listing', 'report', 'lead', 'followup', 'sla');
  CREATE TABLE "domain_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" varchar NOT NULL,
  	"event_type" "enum_domain_events_event_type" NOT NULL,
  	"aggregate_type" "enum_domain_events_aggregate_type" NOT NULL,
  	"aggregate_id" varchar NOT NULL,
  	"aggregate_version" numeric DEFAULT 1,
  	"payload" jsonb,
  	"occurred_at" timestamp(3) with time zone NOT NULL,
  	"processed_at" timestamp(3) with time zone,
  	"attempt_count" numeric DEFAULT 0,
  	"last_error" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	CONSTRAINT "domain_events_event_id_unique" UNIQUE("event_id")
  );

  CREATE TABLE "domain_events_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "domain_events_id" integer;
  ALTER TABLE "domain_events_rels" ADD CONSTRAINT "domain_events_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."domain_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "domain_events_rels" ADD CONSTRAINT "domain_events_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "domain_events_event_id_idx" ON "domain_events" USING btree ("event_id");
  CREATE UNIQUE INDEX "domain_events_event_id_unique" ON "domain_events" USING btree ("event_id");
  CREATE INDEX "domain_events_event_type_idx" ON "domain_events" USING btree ("event_type");
  CREATE INDEX "domain_events_aggregate_type_idx" ON "domain_events" USING btree ("aggregate_type");
  CREATE INDEX "domain_events_aggregate_id_idx" ON "domain_events" USING btree ("aggregate_id");
  CREATE INDEX "domain_events_occurred_at_idx" ON "domain_events" USING btree ("occurred_at");
  CREATE INDEX "domain_events_processed_at_idx" ON "domain_events" USING btree ("processed_at");
  CREATE INDEX "domain_events_updated_at_idx" ON "domain_events" USING btree ("updated_at");
  CREATE INDEX "domain_events_created_at_idx" ON "domain_events" USING btree ("created_at");
  CREATE INDEX "domain_events_rels_order_idx" ON "domain_events_rels" USING btree ("order");
  CREATE INDEX "domain_events_rels_parent_idx" ON "domain_events_rels" USING btree ("parent_id");
  CREATE INDEX "domain_events_rels_path_idx" ON "domain_events_rels" USING btree ("path");
  CREATE INDEX "domain_events_rels_users_id_idx" ON "domain_events_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_domain_events_fk" FOREIGN KEY ("domain_events_id") REFERENCES "public"."domain_events"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_domain_events_id_idx" ON "payload_locked_documents_rels" USING btree ("domain_events_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "domain_events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "domain_events_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "domain_events" CASCADE;
  DROP TABLE "domain_events_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_domain_events_fk";

  DROP INDEX "payload_locked_documents_rels_domain_events_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "domain_events_id";
  DROP TYPE "public"."enum_domain_events_event_type";
  DROP TYPE "public"."enum_domain_events_aggregate_type";`)
}
