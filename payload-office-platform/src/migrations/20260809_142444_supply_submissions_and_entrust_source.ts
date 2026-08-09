import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_supply_submissions_commission_months" AS ENUM('none', '0.5', '1', '1.5', '2');
  CREATE TYPE "public"."enum_supply_submissions_rent_unit" AS ENUM('rmb-sqm-day', 'rmb-month', 'rmb-seat-month', 'rmb-total');
  CREATE TYPE "public"."enum_supply_submissions_status" AS ENUM('pending', 'contacted', 'converted', 'rejected', 'duplicate');
  CREATE TYPE "public"."enum_supply_submissions_submitter_role" AS ENUM('owner', 'property', 'agency', 'operator');
  CREATE TYPE "public"."enum_supply_submissions_lease_mode" AS ENUM('whole-floor', 'office', 'seat', 'sale');
  CREATE TYPE "public"."enum_supply_submissions_fitout_status" AS ENUM('bare', 'simple', 'full', 'furnished');
  ALTER TYPE "public"."enum_leads_source_page_type" ADD VALUE 'entrust';
  ALTER TYPE "public"."enum_notifications_type" ADD VALUE 'supply-submission-created';
  ALTER TYPE "public"."enum_notifications_source_type" ADD VALUE 'supply-submission';
  CREATE TABLE "supply_submissions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"building_name" varchar NOT NULL,
  	"address" varchar NOT NULL,
  	"area_sqm" numeric NOT NULL,
  	"commission_months" "enum_supply_submissions_commission_months" DEFAULT 'none' NOT NULL,
  	"rent_amount" numeric,
  	"rent_unit" "enum_supply_submissions_rent_unit",
  	"contact_phone" varchar NOT NULL,
  	"status" "enum_supply_submissions_status" DEFAULT 'pending' NOT NULL,
  	"assignee_id" integer,
  	"contact_name" varchar,
  	"company_name" varchar,
  	"submitter_role" "enum_supply_submissions_submitter_role",
  	"lease_mode" "enum_supply_submissions_lease_mode",
  	"fitout_status" "enum_supply_submissions_fitout_status",
  	"available_from" timestamp(3) with time zone,
  	"city_id" integer,
  	"district_id" integer,
  	"description" varchar,
  	"review_note" varchar,
  	"matched_building_id" integer,
  	"converted_listing_id" integer,
  	"handled_at" timestamp(3) with time zone,
  	"request_id" varchar NOT NULL,
  	"idempotency_key" varchar NOT NULL,
  	"source_path" varchar,
  	"source_url" varchar,
  	"consent_accepted" boolean,
  	"consent_policy_version" varchar,
  	"submitter_ip_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "supply_submissions_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "supply_submissions_id" integer;
  ALTER TABLE "supply_submissions" ADD CONSTRAINT "supply_submissions_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "supply_submissions" ADD CONSTRAINT "supply_submissions_city_id_locations_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "supply_submissions" ADD CONSTRAINT "supply_submissions_district_id_locations_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "supply_submissions" ADD CONSTRAINT "supply_submissions_matched_building_id_buildings_id_fk" FOREIGN KEY ("matched_building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "supply_submissions" ADD CONSTRAINT "supply_submissions_converted_listing_id_listings_id_fk" FOREIGN KEY ("converted_listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "supply_submissions_rels" ADD CONSTRAINT "supply_submissions_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."supply_submissions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "supply_submissions_rels" ADD CONSTRAINT "supply_submissions_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "supply_submissions_building_name_idx" ON "supply_submissions" USING btree ("building_name");
  CREATE INDEX "supply_submissions_commission_months_idx" ON "supply_submissions" USING btree ("commission_months");
  CREATE INDEX "supply_submissions_contact_phone_idx" ON "supply_submissions" USING btree ("contact_phone");
  CREATE INDEX "supply_submissions_status_idx" ON "supply_submissions" USING btree ("status");
  CREATE INDEX "supply_submissions_assignee_idx" ON "supply_submissions" USING btree ("assignee_id");
  CREATE INDEX "supply_submissions_city_idx" ON "supply_submissions" USING btree ("city_id");
  CREATE INDEX "supply_submissions_district_idx" ON "supply_submissions" USING btree ("district_id");
  CREATE INDEX "supply_submissions_matched_building_idx" ON "supply_submissions" USING btree ("matched_building_id");
  CREATE INDEX "supply_submissions_converted_listing_idx" ON "supply_submissions" USING btree ("converted_listing_id");
  CREATE UNIQUE INDEX "supply_submissions_idempotency_key_idx" ON "supply_submissions" USING btree ("idempotency_key");
  CREATE INDEX "supply_submissions_updated_at_idx" ON "supply_submissions" USING btree ("updated_at");
  CREATE INDEX "supply_submissions_created_at_idx" ON "supply_submissions" USING btree ("created_at");
  CREATE INDEX "supply_submissions_rels_order_idx" ON "supply_submissions_rels" USING btree ("order");
  CREATE INDEX "supply_submissions_rels_parent_idx" ON "supply_submissions_rels" USING btree ("parent_id");
  CREATE INDEX "supply_submissions_rels_path_idx" ON "supply_submissions_rels" USING btree ("path");
  CREATE INDEX "supply_submissions_rels_users_id_idx" ON "supply_submissions_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_supply_submissions_fk" FOREIGN KEY ("supply_submissions_id") REFERENCES "public"."supply_submissions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_supply_submissions_id_idx" ON "payload_locked_documents_rels" USING btree ("supply_submissions_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "supply_submissions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "supply_submissions_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "supply_submissions" CASCADE;
  DROP TABLE "supply_submissions_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_supply_submissions_fk";
  
  ALTER TABLE "leads" ALTER COLUMN "source_page_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_leads_source_page_type";
  CREATE TYPE "public"."enum_leads_source_page_type" AS ENUM('home', 'search', 'listing', 'building', 'content');
  ALTER TABLE "leads" ALTER COLUMN "source_page_type" SET DATA TYPE "public"."enum_leads_source_page_type" USING "source_page_type"::"public"."enum_leads_source_page_type";
  ALTER TABLE "notifications" ALTER COLUMN "type" SET DATA TYPE text;
  DROP TYPE "public"."enum_notifications_type";
  CREATE TYPE "public"."enum_notifications_type" AS ENUM('review-rejected', 'lead-assigned', 'lead-transferred', 'sla-breached', 'task-completed', 'task-cancelled');
  ALTER TABLE "notifications" ALTER COLUMN "type" SET DATA TYPE "public"."enum_notifications_type" USING "type"::"public"."enum_notifications_type";
  ALTER TABLE "notifications" ALTER COLUMN "source_type" SET DATA TYPE text;
  DROP TYPE "public"."enum_notifications_source_type";
  CREATE TYPE "public"."enum_notifications_source_type" AS ENUM('listing-review', 'lead', 'followup', 'task');
  ALTER TABLE "notifications" ALTER COLUMN "source_type" SET DATA TYPE "public"."enum_notifications_source_type" USING "source_type"::"public"."enum_notifications_source_type";
  DROP INDEX "payload_locked_documents_rels_supply_submissions_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "supply_submissions_id";
  DROP TYPE "public"."enum_supply_submissions_commission_months";
  DROP TYPE "public"."enum_supply_submissions_rent_unit";
  DROP TYPE "public"."enum_supply_submissions_status";
  DROP TYPE "public"."enum_supply_submissions_submitter_role";
  DROP TYPE "public"."enum_supply_submissions_lease_mode";
  DROP TYPE "public"."enum_supply_submissions_fitout_status";`)
}
