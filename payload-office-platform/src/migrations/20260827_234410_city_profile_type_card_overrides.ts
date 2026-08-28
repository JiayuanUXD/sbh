import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_city_site_profiles_type_card_overrides_slot" AS ENUM('traditional-office', 'coworking', 'full-floor', 'serviced-office', 'creative-park');
  CREATE TABLE "city_site_profiles_type_card_overrides" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"slot" "enum_city_site_profiles_type_card_overrides_slot" NOT NULL,
  	"cover_image_id" integer NOT NULL
  );
  
  ALTER TABLE "city_site_profiles_type_card_overrides" ADD CONSTRAINT "city_site_profiles_type_card_overrides_cover_image_id_media_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "city_site_profiles_type_card_overrides" ADD CONSTRAINT "city_site_profiles_type_card_overrides_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."city_site_profiles"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "city_site_profiles_type_card_overrides_order_idx" ON "city_site_profiles_type_card_overrides" USING btree ("_order");
  CREATE INDEX "city_site_profiles_type_card_overrides_parent_id_idx" ON "city_site_profiles_type_card_overrides" USING btree ("_parent_id");
  CREATE INDEX "city_site_profiles_type_card_overrides_cover_image_idx" ON "city_site_profiles_type_card_overrides" USING btree ("cover_image_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "city_site_profiles_type_card_overrides" CASCADE;
  DROP TYPE "public"."enum_city_site_profiles_type_card_overrides_slot";`)
}
