import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_tasks_task_type" AS ENUM('review-pending', 'report-triage', 'lead-unassigned', 'followup-first', 'followup-next', 'listing-stale-maintenance');
  CREATE TYPE "public"."enum_tasks_source_type" AS ENUM('listing-review', 'listing-report', 'lead', 'followup', 'listing');
  CREATE TYPE "public"."enum_tasks_priority" AS ENUM('urgent', 'high', 'normal', 'low');
  CREATE TYPE "public"."enum_tasks_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');
  CREATE TABLE "tasks" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"task_type" "enum_tasks_task_type" NOT NULL,
  	"source_id" varchar NOT NULL,
  	"source_version" numeric DEFAULT 1,
  	"source_type" "enum_tasks_source_type" NOT NULL,
  	"priority" "enum_tasks_priority" DEFAULT 'normal' NOT NULL,
  	"status" "enum_tasks_status" DEFAULT 'pending',
  	"due_at" timestamp(3) with time zone NOT NULL,
  	"completed_at" timestamp(3) with time zone,
  	"cancelled_at" timestamp(3) with time zone,
  	"cancellation_reason" varchar,
  	"completion_event_id" varchar,
  	"metadata" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "tasks_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"teams_id" integer
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "tasks_id" integer;
  ALTER TABLE "tasks_rels" ADD CONSTRAINT "tasks_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "tasks_rels" ADD CONSTRAINT "tasks_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "tasks_rels" ADD CONSTRAINT "tasks_rels_teams_fk" FOREIGN KEY ("teams_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "tasks_task_type_idx" ON "tasks" USING btree ("task_type");
  CREATE INDEX "tasks_source_id_idx" ON "tasks" USING btree ("source_id");
  CREATE INDEX "tasks_source_version_idx" ON "tasks" USING btree ("source_version");
  CREATE INDEX "tasks_source_type_idx" ON "tasks" USING btree ("source_type");
  CREATE INDEX "tasks_priority_idx" ON "tasks" USING btree ("priority");
  CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");
  CREATE INDEX "tasks_due_at_idx" ON "tasks" USING btree ("due_at");
  CREATE INDEX "tasks_completed_at_idx" ON "tasks" USING btree ("completed_at");
  CREATE INDEX "tasks_cancelled_at_idx" ON "tasks" USING btree ("cancelled_at");
  CREATE INDEX "tasks_completion_event_id_idx" ON "tasks" USING btree ("completion_event_id");
  CREATE INDEX "tasks_updated_at_idx" ON "tasks" USING btree ("updated_at");
  CREATE INDEX "tasks_created_at_idx" ON "tasks" USING btree ("created_at");
  CREATE INDEX "tasks_rels_order_idx" ON "tasks_rels" USING btree ("order");
  CREATE INDEX "tasks_rels_parent_idx" ON "tasks_rels" USING btree ("parent_id");
  CREATE INDEX "tasks_rels_path_idx" ON "tasks_rels" USING btree ("path");
  CREATE INDEX "tasks_rels_users_id_idx" ON "tasks_rels" USING btree ("users_id");
  CREATE INDEX "tasks_rels_teams_id_idx" ON "tasks_rels" USING btree ("teams_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tasks_fk" FOREIGN KEY ("tasks_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_tasks_id_idx" ON "payload_locked_documents_rels" USING btree ("tasks_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tasks" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "tasks_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "tasks" CASCADE;
  DROP TABLE "tasks_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_tasks_fk";

  DROP INDEX "payload_locked_documents_rels_tasks_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "tasks_id";
  DROP TYPE "public"."enum_tasks_task_type";
  DROP TYPE "public"."enum_tasks_source_type";
  DROP TYPE "public"."enum_tasks_priority";
  DROP TYPE "public"."enum_tasks_status";`)
}
