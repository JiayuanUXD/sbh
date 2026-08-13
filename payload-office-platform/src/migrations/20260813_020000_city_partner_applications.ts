import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_city_partner_applications_resource_types" AS ENUM('building-owner', 'tenant-demand', 'broker-network', 'local-team', 'government-association', 'other');
  CREATE TYPE "public"."enum_city_partner_applications_applicant_identity" AS ENUM('owner-property', 'broker-channel', 'enterprise-service', 'local-operations', 'other');
  CREATE TYPE "public"."enum_city_partner_applications_status" AS ENUM('pending', 'contacted', 'evaluating', 'qualified', 'not-fit', 'withdrawn');
  CREATE TYPE "public"."enum__city_partner_applications_v_version_resource_types" AS ENUM('building-owner', 'tenant-demand', 'broker-network', 'local-team', 'government-association', 'other');
  CREATE TYPE "public"."enum__city_partner_applications_v_version_applicant_identity" AS ENUM('owner-property', 'broker-channel', 'enterprise-service', 'local-operations', 'other');
  CREATE TYPE "public"."enum__city_partner_applications_v_version_status" AS ENUM('pending', 'contacted', 'evaluating', 'qualified', 'not-fit', 'withdrawn');
  CREATE TABLE "city_partner_applications_resource_types" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_city_partner_applications_resource_types",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "city_partner_applications" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"city_id" integer NOT NULL,
  	"applicant_name" varchar NOT NULL,
  	"contact_phone" varchar NOT NULL,
  	"applicant_identity" "enum_city_partner_applications_applicant_identity" NOT NULL,
  	"other_identity" varchar,
  	"organization_name" varchar,
  	"other_resource" varchar,
  	"experience_summary" varchar,
  	"cooperation_plan" varchar,
  	"details_completed_at" timestamp(3) with time zone,
  	"details_fingerprint" varchar,
  	"status" "enum_city_partner_applications_status" DEFAULT 'pending' NOT NULL,
  	"assignee_id" integer,
  	"internal_note" varchar,
  	"handled_at" timestamp(3) with time zone,
  	"request_id" varchar NOT NULL,
  	"idempotency_key" varchar NOT NULL,
  	"source_path" varchar NOT NULL,
  	"source_url" varchar,
  	"consent_accepted" boolean DEFAULT false NOT NULL,
  	"consent_policy_version" varchar NOT NULL,
  	"submitter_ip_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "city_partner_applications_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "_city_partner_applications_v_version_resource_types" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum__city_partner_applications_v_version_resource_types",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "_city_partner_applications_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_city_id" integer NOT NULL,
  	"version_applicant_name" varchar NOT NULL,
  	"version_contact_phone" varchar NOT NULL,
  	"version_applicant_identity" "enum__city_partner_applications_v_version_applicant_identity" NOT NULL,
  	"version_other_identity" varchar,
  	"version_organization_name" varchar,
  	"version_other_resource" varchar,
  	"version_experience_summary" varchar,
  	"version_cooperation_plan" varchar,
  	"version_details_completed_at" timestamp(3) with time zone,
  	"version_details_fingerprint" varchar,
  	"version_status" "enum__city_partner_applications_v_version_status" DEFAULT 'pending' NOT NULL,
  	"version_assignee_id" integer,
  	"version_internal_note" varchar,
  	"version_handled_at" timestamp(3) with time zone,
  	"version_request_id" varchar NOT NULL,
  	"version_idempotency_key" varchar NOT NULL,
  	"version_source_path" varchar NOT NULL,
  	"version_source_url" varchar,
  	"version_consent_accepted" boolean DEFAULT false NOT NULL,
  	"version_consent_policy_version" varchar NOT NULL,
  	"version_submitter_ip_hash" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_city_partner_applications_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "city_partner_applications_id" integer;
  ALTER TABLE "city_partner_applications_resource_types" ADD CONSTRAINT "city_partner_applications_resource_types_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."city_partner_applications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "city_partner_applications" ADD CONSTRAINT "city_partner_applications_city_id_locations_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "city_partner_applications" ADD CONSTRAINT "city_partner_applications_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "city_partner_applications_rels" ADD CONSTRAINT "city_partner_applications_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."city_partner_applications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "city_partner_applications_rels" ADD CONSTRAINT "city_partner_applications_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_city_partner_applications_v_version_resource_types" ADD CONSTRAINT "_city_partner_applications_v_version_resource_types_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_city_partner_applications_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_city_partner_applications_v" ADD CONSTRAINT "_city_partner_applications_v_parent_id_city_partner_applications_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."city_partner_applications"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_city_partner_applications_v" ADD CONSTRAINT "_city_partner_applications_v_version_city_id_locations_id_fk" FOREIGN KEY ("version_city_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_city_partner_applications_v" ADD CONSTRAINT "_city_partner_applications_v_version_assignee_id_users_id_fk" FOREIGN KEY ("version_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_city_partner_applications_v_rels" ADD CONSTRAINT "_city_partner_applications_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_city_partner_applications_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_city_partner_applications_v_rels" ADD CONSTRAINT "_city_partner_applications_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "city_partner_applications_resource_types_order_idx" ON "city_partner_applications_resource_types" USING btree ("order");
  CREATE INDEX "city_partner_applications_resource_types_parent_idx" ON "city_partner_applications_resource_types" USING btree ("parent_id");
  CREATE INDEX "city_partner_applications_city_idx" ON "city_partner_applications" USING btree ("city_id");
  CREATE INDEX "city_partner_applications_status_idx" ON "city_partner_applications" USING btree ("status");
  CREATE INDEX "city_partner_applications_assignee_idx" ON "city_partner_applications" USING btree ("assignee_id");
  CREATE UNIQUE INDEX "city_partner_applications_idempotency_key_idx" ON "city_partner_applications" USING btree ("idempotency_key");
  CREATE INDEX "city_partner_applications_updated_at_idx" ON "city_partner_applications" USING btree ("updated_at");
  CREATE INDEX "city_partner_applications_created_at_idx" ON "city_partner_applications" USING btree ("created_at");
  CREATE INDEX "city_partner_applications_rels_order_idx" ON "city_partner_applications_rels" USING btree ("order");
  CREATE INDEX "city_partner_applications_rels_parent_idx" ON "city_partner_applications_rels" USING btree ("parent_id");
  CREATE INDEX "city_partner_applications_rels_path_idx" ON "city_partner_applications_rels" USING btree ("path");
  CREATE INDEX "city_partner_applications_rels_users_id_idx" ON "city_partner_applications_rels" USING btree ("users_id");
  CREATE INDEX "_city_partner_applications_v_version_resource_types_order_idx" ON "_city_partner_applications_v_version_resource_types" USING btree ("order");
  CREATE INDEX "_city_partner_applications_v_version_resource_types_parent_idx" ON "_city_partner_applications_v_version_resource_types" USING btree ("parent_id");
  CREATE INDEX "_city_partner_applications_v_parent_idx" ON "_city_partner_applications_v" USING btree ("parent_id");
  CREATE INDEX "_city_partner_applications_v_version_version_city_idx" ON "_city_partner_applications_v" USING btree ("version_city_id");
  CREATE INDEX "_city_partner_applications_v_version_version_status_idx" ON "_city_partner_applications_v" USING btree ("version_status");
  CREATE INDEX "_city_partner_applications_v_version_version_assignee_idx" ON "_city_partner_applications_v" USING btree ("version_assignee_id");
  CREATE INDEX "_city_partner_applications_v_version_version_idempotency_idx" ON "_city_partner_applications_v" USING btree ("version_idempotency_key");
  CREATE INDEX "_city_partner_applications_v_version_version_updated_at_idx" ON "_city_partner_applications_v" USING btree ("version_updated_at");
  CREATE INDEX "_city_partner_applications_v_version_version_created_at_idx" ON "_city_partner_applications_v" USING btree ("version_created_at");
  CREATE INDEX "_city_partner_applications_v_created_at_idx" ON "_city_partner_applications_v" USING btree ("created_at");
  CREATE INDEX "_city_partner_applications_v_updated_at_idx" ON "_city_partner_applications_v" USING btree ("updated_at");
  CREATE INDEX "_city_partner_applications_v_rels_order_idx" ON "_city_partner_applications_v_rels" USING btree ("order");
  CREATE INDEX "_city_partner_applications_v_rels_parent_idx" ON "_city_partner_applications_v_rels" USING btree ("parent_id");
  CREATE INDEX "_city_partner_applications_v_rels_path_idx" ON "_city_partner_applications_v_rels" USING btree ("path");
  CREATE INDEX "_city_partner_applications_v_rels_users_id_idx" ON "_city_partner_applications_v_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_city_partner_applications_fk" FOREIGN KEY ("city_partner_applications_id") REFERENCES "public"."city_partner_applications"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_city_partner_applications__idx" ON "payload_locked_documents_rels" USING btree ("city_partner_applications_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "city_partner_applications_resource_types" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "city_partner_applications" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "city_partner_applications_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_city_partner_applications_v_version_resource_types" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_city_partner_applications_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_city_partner_applications_v_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "city_partner_applications_resource_types" CASCADE;
  DROP TABLE "city_partner_applications" CASCADE;
  DROP TABLE "city_partner_applications_rels" CASCADE;
  DROP TABLE "_city_partner_applications_v_version_resource_types" CASCADE;
  DROP TABLE "_city_partner_applications_v" CASCADE;
  DROP TABLE "_city_partner_applications_v_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_city_partner_applications_fk";
  
  DROP INDEX "payload_locked_documents_rels_city_partner_applications__idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "city_partner_applications_id";
  DROP TYPE "public"."enum_city_partner_applications_resource_types";
  DROP TYPE "public"."enum_city_partner_applications_applicant_identity";
  DROP TYPE "public"."enum_city_partner_applications_status";
  DROP TYPE "public"."enum__city_partner_applications_v_version_resource_types";
  DROP TYPE "public"."enum__city_partner_applications_v_version_applicant_identity";
  DROP TYPE "public"."enum__city_partner_applications_v_version_status";`)
}
