import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_listings_building_form" AS ENUM('detached', 'double-row', 'townhouse');
  CREATE TABLE "listings_building_form" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_listings_building_form",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  ALTER TABLE "site_settings" ADD COLUMN "detail_spec_fields_listing_building_form" boolean DEFAULT true;
  ALTER TABLE "listings_building_form" ADD CONSTRAINT "listings_building_form_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "listings_building_form_order_idx" ON "listings_building_form" USING btree ("order");
  CREATE INDEX "listings_building_form_parent_idx" ON "listings_building_form" USING btree ("parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "listings_building_form" CASCADE;
  ALTER TABLE "site_settings" DROP COLUMN "detail_spec_fields_listing_building_form";
  DROP TYPE "public"."enum_listings_building_form";`)
}
