import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_building_type" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_grade" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_completion_year" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_gross_floor_area" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_total_floors" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_typical_floor_area" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_floor_height" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_efficiency_rate" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_elevators" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_air_conditioning" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_power_supply" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_network" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_access_control" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_elevator_zoning" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_service_hours" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_property_fee" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_property_company" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_developer" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_parking_spaces" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_parking_fee" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_certifications" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_registration_capability" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_building_min_leasable_area" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_area" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_usable_area" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_efficiency_rate" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_net_ceiling_height" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_seats" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_floor" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_orientation" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_divisible" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_price" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_minimum_lease" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_deposit" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_payment_terms" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_decoration" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_furniture" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_available_from" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_registration" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_air_conditioning" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_network" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_property_fee" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_parking_fee" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_invoice" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_other_fixed_costs" boolean DEFAULT true;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_verified_at" boolean DEFAULT false;
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_price_verified_at" boolean DEFAULT false;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_building_type";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_grade";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_completion_year";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_gross_floor_area";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_total_floors";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_typical_floor_area";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_floor_height";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_efficiency_rate";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_elevators";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_air_conditioning";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_power_supply";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_network";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_access_control";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_elevator_zoning";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_service_hours";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_property_fee";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_property_company";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_developer";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_parking_spaces";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_parking_fee";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_certifications";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_registration_capability";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_building_min_leasable_area";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_area";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_usable_area";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_efficiency_rate";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_net_ceiling_height";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_seats";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_floor";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_orientation";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_divisible";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_price";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_minimum_lease";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_deposit";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_payment_terms";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_decoration";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_furniture";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_available_from";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_registration";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_air_conditioning";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_network";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_property_fee";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_parking_fee";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_invoice";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_other_fixed_costs";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_verified_at";
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_price_verified_at";`)
}
