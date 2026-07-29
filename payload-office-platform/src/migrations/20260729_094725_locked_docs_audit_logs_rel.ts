import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_audit_logs_action" AS ENUM('listing.create', 'listing.update', 'listing.delete', 'listing.review_submit', 'listing.review_approve', 'listing.review_reject', 'listing.publish', 'listing.unpublish', 'building.create', 'building.update', 'building.delete', 'building.freeze', 'building.restore', 'merchant.create', 'merchant.update', 'merchant.freeze', 'merchant.restore', 'report.triage', 'report.sustain', 'report.dismiss', 'report.pause_supply', 'report.resume_supply', 'report.close', 'lead.create', 'lead.update', 'lead.assign', 'lead.claim', 'lead.transfer', 'lead.to_public_pool', 'lead.reclaim', 'lead.lose', 'lead.stage_transition', 'customer.create', 'customer.update', 'followup.create', 'followup.correct', 'user.create', 'user.disable', 'user.enable', 'user.reset_password', 'role.create', 'role.update', 'role.delete', 'role.assign', 'role.revoke', 'data.import', 'data.export', 'audit.view_detail', 'audit.export');
  CREATE TYPE "public"."enum_audit_logs_result" AS ENUM('success', 'failed');
  CREATE TABLE "audit_logs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"audit_id" varchar NOT NULL,
  	"action" "enum_audit_logs_action" NOT NULL,
  	"result" "enum_audit_logs_result" NOT NULL,
  	"object_collection" varchar NOT NULL,
  	"object_id" varchar NOT NULL,
  	"object_version" numeric NOT NULL,
  	"before" jsonb,
  	"after" jsonb,
  	"changed_fields" jsonb,
  	"subject_user_id" varchar,
  	"subject_role_codes" jsonb,
  	"subject_team_id" varchar,
  	"subject_city_scope" jsonb,
  	"request_id" varchar,
  	"ip" varchar,
  	"user_agent" varchar,
  	"method" varchar,
  	"path" varchar,
  	"error_code" varchar,
  	"error_message" varchar,
  	"event_id" varchar,
  	"occurred_at" timestamp(3) with time zone NOT NULL,
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "audit_logs_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "audit_logs_id" integer;
  ALTER TABLE "audit_logs_rels" ADD CONSTRAINT "audit_logs_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."audit_logs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "audit_logs_rels" ADD CONSTRAINT "audit_logs_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "audit_logs_audit_id_idx" ON "audit_logs" USING btree ("audit_id");
  CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");
  CREATE INDEX "audit_logs_result_idx" ON "audit_logs" USING btree ("result");
  CREATE INDEX "audit_logs_object_collection_idx" ON "audit_logs" USING btree ("object_collection");
  CREATE INDEX "audit_logs_object_id_idx" ON "audit_logs" USING btree ("object_id");
  CREATE INDEX "audit_logs_subject_user_id_idx" ON "audit_logs" USING btree ("subject_user_id");
  CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs" USING btree ("request_id");
  CREATE INDEX "audit_logs_event_id_idx" ON "audit_logs" USING btree ("event_id");
  CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs" USING btree ("occurred_at");
  CREATE INDEX "audit_logs_updated_at_idx" ON "audit_logs" USING btree ("updated_at");
  CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");
  CREATE INDEX "audit_logs_rels_order_idx" ON "audit_logs_rels" USING btree ("order");
  CREATE INDEX "audit_logs_rels_parent_idx" ON "audit_logs_rels" USING btree ("parent_id");
  CREATE INDEX "audit_logs_rels_path_idx" ON "audit_logs_rels" USING btree ("path");
  CREATE INDEX "audit_logs_rels_users_id_idx" ON "audit_logs_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_audit_logs_fk" FOREIGN KEY ("audit_logs_id") REFERENCES "public"."audit_logs"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_audit_logs_id_idx" ON "payload_locked_documents_rels" USING btree ("audit_logs_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "audit_logs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "audit_logs_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "audit_logs" CASCADE;
  DROP TABLE "audit_logs_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_audit_logs_fk";
  
  DROP INDEX "payload_locked_documents_rels_audit_logs_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "audit_logs_id";
  DROP TYPE "public"."enum_audit_logs_action";
  DROP TYPE "public"."enum_audit_logs_result";`)
}
