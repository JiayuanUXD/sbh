import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_buildings_media_items_kind" AS ENUM('image', 'floor-plan', 'video');
  CREATE TYPE "public"."enum_buildings_media_items_category" AS ENUM('exterior', 'lobby', 'common-area', 'facilities');
  CREATE TYPE "public"."enum_listings_media_items_kind" AS ENUM('image', 'floor-plan', 'video');
  CREATE TYPE "public"."enum_listings_media_items_category" AS ENUM('workspace', 'meeting-room', 'common-area', 'exterior');
  CREATE TYPE "public"."enum_listings_registration_status" AS ENUM('available', 'conditional', 'unavailable', 'confirm');
  CREATE TYPE "public"."enum_listings_space_details_furniture_status" AS ENUM('included', 'optional', 'none', 'confirm');
  CREATE TYPE "public"."enum_listings_cost_terms_property_fee_inclusion" AS ENUM('included', 'excluded', 'confirm');
  CREATE TYPE "public"."enum_listings_cost_terms_invoice_status" AS ENUM('included', 'extra-tax', 'unavailable', 'confirm');
  CREATE TYPE "public"."enum_audit_logs_action" AS ENUM('listing.create', 'listing.update', 'listing.delete', 'listing.review_submit', 'listing.review_approve', 'listing.review_reject', 'listing.publish', 'listing.unpublish', 'building.create', 'building.update', 'building.delete', 'building.freeze', 'building.restore', 'merchant.create', 'merchant.update', 'merchant.freeze', 'merchant.restore', 'report.triage', 'report.sustain', 'report.dismiss', 'report.pause_supply', 'report.resume_supply', 'report.close', 'lead.create', 'lead.update', 'lead.assign', 'lead.claim', 'lead.transfer', 'lead.to_public_pool', 'lead.reclaim', 'lead.lose', 'lead.stage_transition', 'customer.create', 'customer.update', 'followup.create', 'followup.correct', 'user.create', 'user.disable', 'user.enable', 'user.reset_password', 'role.create', 'role.update', 'role.delete', 'role.assign', 'role.revoke', 'data.import', 'data.export', 'audit.view_detail', 'audit.export');
  CREATE TYPE "public"."enum_audit_logs_result" AS ENUM('success', 'failed');
  CREATE TABLE "buildings_certifications" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"certificate_number" varchar,
  	"valid_from" timestamp(3) with time zone,
  	"valid_to" timestamp(3) with time zone,
  	"public_visible" boolean DEFAULT false
  );
  
  CREATE TABLE "buildings_media_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"resource_id" integer NOT NULL,
  	"kind" "enum_buildings_media_items_kind" NOT NULL,
  	"category" "enum_buildings_media_items_category" NOT NULL,
  	"alt" varchar NOT NULL,
  	"captured_at" timestamp(3) with time zone,
  	"is_schematic" boolean DEFAULT false
  );
  
  CREATE TABLE "listings_media_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"resource_id" integer NOT NULL,
  	"kind" "enum_listings_media_items_kind" NOT NULL,
  	"category" "enum_listings_media_items_category" NOT NULL,
  	"alt" varchar NOT NULL,
  	"captured_at" timestamp(3) with time zone,
  	"is_schematic" boolean DEFAULT false
  );
  
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
  
  ALTER TABLE "buildings" ADD COLUMN "developer_and_scale_developer" varchar;
  ALTER TABLE "buildings" ADD COLUMN "developer_and_scale_gross_floor_area" numeric;
  ALTER TABLE "buildings" ADD COLUMN "developer_and_scale_typical_floor_area" numeric;
  ALTER TABLE "buildings" ADD COLUMN "developer_and_scale_standard_floor_height" numeric;
  ALTER TABLE "buildings" ADD COLUMN "developer_and_scale_net_ceiling_height" numeric;
  ALTER TABLE "buildings" ADD COLUMN "developer_and_scale_efficiency_rate" numeric;
  ALTER TABLE "buildings" ADD COLUMN "vertical_transport_passenger_elevators" numeric;
  ALTER TABLE "buildings" ADD COLUMN "vertical_transport_freight_elevators" numeric;
  ALTER TABLE "buildings" ADD COLUMN "vertical_transport_zoning_note" varchar;
  ALTER TABLE "buildings" ADD COLUMN "building_services_air_conditioning" varchar;
  ALTER TABLE "buildings" ADD COLUMN "building_services_network" varchar;
  ALTER TABLE "buildings" ADD COLUMN "building_services_power_supply" varchar;
  ALTER TABLE "buildings" ADD COLUMN "building_services_access_control" varchar;
  ALTER TABLE "buildings" ADD COLUMN "building_services_parking_fee" varchar;
  ALTER TABLE "buildings" ADD COLUMN "building_services_service_hours" varchar;
  ALTER TABLE "buildings" ADD COLUMN "verification_info_verified_at" timestamp(3) with time zone;
  ALTER TABLE "buildings" ADD COLUMN "verification_info_price_verified_at" timestamp(3) with time zone;
  ALTER TABLE "listings" ADD COLUMN "registration_status" "enum_listings_registration_status";
  ALTER TABLE "listings" ADD COLUMN "space_details_efficiency_rate" numeric;
  ALTER TABLE "listings" ADD COLUMN "space_details_seat_min" numeric;
  ALTER TABLE "listings" ADD COLUMN "space_details_seat_max" numeric;
  ALTER TABLE "listings" ADD COLUMN "space_details_orientation" varchar;
  ALTER TABLE "listings" ADD COLUMN "space_details_net_ceiling_height" numeric;
  ALTER TABLE "listings" ADD COLUMN "space_details_is_divisible" boolean DEFAULT false;
  ALTER TABLE "listings" ADD COLUMN "space_details_furniture_status" "enum_listings_space_details_furniture_status";
  ALTER TABLE "listings" ADD COLUMN "cost_terms_deposit_months" numeric;
  ALTER TABLE "listings" ADD COLUMN "cost_terms_property_fee_inclusion" "enum_listings_cost_terms_property_fee_inclusion";
  ALTER TABLE "listings" ADD COLUMN "cost_terms_property_fee_amount" numeric;
  ALTER TABLE "listings" ADD COLUMN "cost_terms_invoice_status" "enum_listings_cost_terms_invoice_status";
  ALTER TABLE "listings" ADD COLUMN "cost_terms_other_fixed_costs" varchar;
  ALTER TABLE "listings" ADD COLUMN "verification_info_verified_at" timestamp(3) with time zone;
  ALTER TABLE "listings" ADD COLUMN "verification_info_price_verified_at" timestamp(3) with time zone;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "audit_logs_id" integer;
  ALTER TABLE "buildings_certifications" ADD CONSTRAINT "buildings_certifications_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "buildings_media_items" ADD CONSTRAINT "buildings_media_items_resource_id_media_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "buildings_media_items" ADD CONSTRAINT "buildings_media_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "listings_media_items" ADD CONSTRAINT "listings_media_items_resource_id_media_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listings_media_items" ADD CONSTRAINT "listings_media_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "audit_logs_rels" ADD CONSTRAINT "audit_logs_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."audit_logs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "audit_logs_rels" ADD CONSTRAINT "audit_logs_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "buildings_certifications_order_idx" ON "buildings_certifications" USING btree ("_order");
  CREATE INDEX "buildings_certifications_parent_id_idx" ON "buildings_certifications" USING btree ("_parent_id");
  CREATE INDEX "buildings_media_items_order_idx" ON "buildings_media_items" USING btree ("_order");
  CREATE INDEX "buildings_media_items_parent_id_idx" ON "buildings_media_items" USING btree ("_parent_id");
  CREATE INDEX "buildings_media_items_resource_idx" ON "buildings_media_items" USING btree ("resource_id");
  CREATE INDEX "listings_media_items_order_idx" ON "listings_media_items" USING btree ("_order");
  CREATE INDEX "listings_media_items_parent_id_idx" ON "listings_media_items" USING btree ("_parent_id");
  CREATE INDEX "listings_media_items_resource_idx" ON "listings_media_items" USING btree ("resource_id");
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
  CREATE INDEX "payload_locked_documents_rels_audit_logs_id_idx" ON "payload_locked_documents_rels" USING btree ("audit_logs_id");
  ALTER TABLE "listings" DROP COLUMN "status";
  DROP TYPE "public"."enum_listings_status";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_listings_status" AS ENUM('available', 'reserved', 'leased', 'archived');
  ALTER TABLE "buildings_certifications" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "buildings_media_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "listings_media_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "audit_logs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "audit_logs_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "buildings_certifications" CASCADE;
  DROP TABLE "buildings_media_items" CASCADE;
  DROP TABLE "listings_media_items" CASCADE;
  DROP TABLE "audit_logs" CASCADE;
  DROP TABLE "audit_logs_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_audit_logs_fk";
  
  DROP INDEX "payload_locked_documents_rels_audit_logs_id_idx";
  ALTER TABLE "listings" ADD COLUMN "status" "enum_listings_status" DEFAULT 'available';
  ALTER TABLE "buildings" DROP COLUMN "developer_and_scale_developer";
  ALTER TABLE "buildings" DROP COLUMN "developer_and_scale_gross_floor_area";
  ALTER TABLE "buildings" DROP COLUMN "developer_and_scale_typical_floor_area";
  ALTER TABLE "buildings" DROP COLUMN "developer_and_scale_standard_floor_height";
  ALTER TABLE "buildings" DROP COLUMN "developer_and_scale_net_ceiling_height";
  ALTER TABLE "buildings" DROP COLUMN "developer_and_scale_efficiency_rate";
  ALTER TABLE "buildings" DROP COLUMN "vertical_transport_passenger_elevators";
  ALTER TABLE "buildings" DROP COLUMN "vertical_transport_freight_elevators";
  ALTER TABLE "buildings" DROP COLUMN "vertical_transport_zoning_note";
  ALTER TABLE "buildings" DROP COLUMN "building_services_air_conditioning";
  ALTER TABLE "buildings" DROP COLUMN "building_services_network";
  ALTER TABLE "buildings" DROP COLUMN "building_services_power_supply";
  ALTER TABLE "buildings" DROP COLUMN "building_services_access_control";
  ALTER TABLE "buildings" DROP COLUMN "building_services_parking_fee";
  ALTER TABLE "buildings" DROP COLUMN "building_services_service_hours";
  ALTER TABLE "buildings" DROP COLUMN "verification_info_verified_at";
  ALTER TABLE "buildings" DROP COLUMN "verification_info_price_verified_at";
  ALTER TABLE "listings" DROP COLUMN "registration_status";
  ALTER TABLE "listings" DROP COLUMN "space_details_efficiency_rate";
  ALTER TABLE "listings" DROP COLUMN "space_details_seat_min";
  ALTER TABLE "listings" DROP COLUMN "space_details_seat_max";
  ALTER TABLE "listings" DROP COLUMN "space_details_orientation";
  ALTER TABLE "listings" DROP COLUMN "space_details_net_ceiling_height";
  ALTER TABLE "listings" DROP COLUMN "space_details_is_divisible";
  ALTER TABLE "listings" DROP COLUMN "space_details_furniture_status";
  ALTER TABLE "listings" DROP COLUMN "cost_terms_deposit_months";
  ALTER TABLE "listings" DROP COLUMN "cost_terms_property_fee_inclusion";
  ALTER TABLE "listings" DROP COLUMN "cost_terms_property_fee_amount";
  ALTER TABLE "listings" DROP COLUMN "cost_terms_invoice_status";
  ALTER TABLE "listings" DROP COLUMN "cost_terms_other_fixed_costs";
  ALTER TABLE "listings" DROP COLUMN "verification_info_verified_at";
  ALTER TABLE "listings" DROP COLUMN "verification_info_price_verified_at";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "audit_logs_id";
  DROP TYPE "public"."enum_buildings_media_items_kind";
  DROP TYPE "public"."enum_buildings_media_items_category";
  DROP TYPE "public"."enum_listings_media_items_kind";
  DROP TYPE "public"."enum_listings_media_items_category";
  DROP TYPE "public"."enum_listings_registration_status";
  DROP TYPE "public"."enum_listings_space_details_furniture_status";
  DROP TYPE "public"."enum_listings_cost_terms_property_fee_inclusion";
  DROP TYPE "public"."enum_listings_cost_terms_invoice_status";
  DROP TYPE "public"."enum_audit_logs_action";
  DROP TYPE "public"."enum_audit_logs_result";`)
}
