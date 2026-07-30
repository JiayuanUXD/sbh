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
  ALTER TABLE "buildings_certifications" ADD CONSTRAINT "buildings_certifications_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "buildings_media_items" ADD CONSTRAINT "buildings_media_items_resource_id_media_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "buildings_media_items" ADD CONSTRAINT "buildings_media_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "listings_media_items" ADD CONSTRAINT "listings_media_items_resource_id_media_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listings_media_items" ADD CONSTRAINT "listings_media_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "buildings_certifications_order_idx" ON "buildings_certifications" USING btree ("_order");
  CREATE INDEX "buildings_certifications_parent_id_idx" ON "buildings_certifications" USING btree ("_parent_id");
  CREATE INDEX "buildings_media_items_order_idx" ON "buildings_media_items" USING btree ("_order");
  CREATE INDEX "buildings_media_items_parent_id_idx" ON "buildings_media_items" USING btree ("_parent_id");
  CREATE INDEX "buildings_media_items_resource_idx" ON "buildings_media_items" USING btree ("resource_id");
  CREATE INDEX "listings_media_items_order_idx" ON "listings_media_items" USING btree ("_order");
  CREATE INDEX "listings_media_items_parent_id_idx" ON "listings_media_items" USING btree ("_parent_id");
  CREATE INDEX "listings_media_items_resource_idx" ON "listings_media_items" USING btree ("resource_id");
  ALTER TABLE "listings" DROP COLUMN "status";
  DROP TYPE "public"."enum_listings_status";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_listings_status" AS ENUM('available', 'reserved', 'leased', 'archived');
  DROP TABLE "buildings_certifications" CASCADE;
  DROP TABLE "buildings_media_items" CASCADE;
  DROP TABLE "listings_media_items" CASCADE;
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
  DROP TYPE "public"."enum_buildings_media_items_kind";
  DROP TYPE "public"."enum_buildings_media_items_category";
  DROP TYPE "public"."enum_listings_media_items_kind";
  DROP TYPE "public"."enum_listings_media_items_category";
  DROP TYPE "public"."enum_listings_registration_status";
  DROP TYPE "public"."enum_listings_space_details_furniture_status";
  DROP TYPE "public"."enum_listings_cost_terms_property_fee_inclusion";
  DROP TYPE "public"."enum_listings_cost_terms_invoice_status";`)
}
