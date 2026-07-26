import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_listing_reports_reason" AS ENUM('false-info', 'price-anomaly', 'leased-not-delisted', 'policy-violation', 'other');
  CREATE TYPE "public"."enum_listing_reports_status" AS ENUM('pending-triage', 'assigned', 'verifying', 'awaiting-info', 'submitted-review', 'closed');
  CREATE TYPE "public"."enum_listing_reports_conclusion" AS ENUM('sustained', 'dismissed', 'partial');
  CREATE TABLE "listing_reports" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"target_listing_id" integer NOT NULL,
  	"reason" "enum_listing_reports_reason" NOT NULL,
  	"reason_detail" varchar,
  	"reporter_name" varchar,
  	"reporter_phone" varchar,
  	"reporter_ip_hash" varchar,
  	"status" "enum_listing_reports_status",
  	"status_version" numeric DEFAULT 1,
  	"assignee_id" integer,
  	"conclusion" "enum_listing_reports_conclusion",
  	"conclusion_reason" varchar,
  	"supply_paused" boolean DEFAULT false,
  	"supply_paused_at" timestamp(3) with time zone,
  	"supply_resumed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "listing_reports_evidence" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer
  );

  CREATE TABLE "listing_reports_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "listing_reports_id" integer;
  ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_target_listing_id_listings_id_fk" FOREIGN KEY ("target_listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listing_reports_evidence" ADD CONSTRAINT "listing_reports_evidence_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listing_reports_evidence" ADD CONSTRAINT "listing_reports_evidence_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."listing_reports"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "listing_reports_rels" ADD CONSTRAINT "listing_reports_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."listing_reports"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "listing_reports_rels" ADD CONSTRAINT "listing_reports_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "listing_reports_target_listing_idx" ON "listing_reports" USING btree ("target_listing_id");
  CREATE INDEX "listing_reports_assignee_idx" ON "listing_reports" USING btree ("assignee_id");
  CREATE INDEX "listing_reports_status_idx" ON "listing_reports" USING btree ("status");
  CREATE INDEX "listing_reports_updated_at_idx" ON "listing_reports" USING btree ("updated_at");
  CREATE INDEX "listing_reports_created_at_idx" ON "listing_reports" USING btree ("created_at");
  CREATE INDEX "listing_reports_evidence_order_idx" ON "listing_reports_evidence" USING btree ("_order");
  CREATE INDEX "listing_reports_evidence_parent_id_idx" ON "listing_reports_evidence" USING btree ("_parent_id");
  CREATE INDEX "listing_reports_evidence_image_idx" ON "listing_reports_evidence" USING btree ("image_id");
  CREATE INDEX "listing_reports_rels_order_idx" ON "listing_reports_rels" USING btree ("order");
  CREATE INDEX "listing_reports_rels_parent_idx" ON "listing_reports_rels" USING btree ("parent_id");
  CREATE INDEX "listing_reports_rels_path_idx" ON "listing_reports_rels" USING btree ("path");
  CREATE INDEX "listing_reports_rels_users_id_idx" ON "listing_reports_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_listing_reports_fk" FOREIGN KEY ("listing_reports_id") REFERENCES "public"."listing_reports"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_listing_reports_id_idx" ON "payload_locked_documents_rels" USING btree ("listing_reports_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "listing_reports" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "listing_reports_evidence" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "listing_reports_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "listing_reports" CASCADE;
  DROP TABLE "listing_reports_evidence" CASCADE;
  DROP TABLE "listing_reports_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_listing_reports_fk";

  DROP INDEX "payload_locked_documents_rels_listing_reports_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "listing_reports_id";
  DROP TYPE "public"."enum_listing_reports_reason";
  DROP TYPE "public"."enum_listing_reports_status";
  DROP TYPE "public"."enum_listing_reports_conclusion";`)
}
