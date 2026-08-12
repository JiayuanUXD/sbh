import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_city_site_profiles_service_status" AS ENUM('live', 'coming-soon');
  CREATE TABLE "city_site_profiles" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"city_id" integer NOT NULL,
  	"service_status" "enum_city_site_profiles_service_status" NOT NULL,
  	"switcher_visible" boolean DEFAULT true NOT NULL,
  	"sort_order" numeric DEFAULT 100 NOT NULL,
  	"seo_title" varchar NOT NULL,
  	"seo_description" varchar NOT NULL,
  	"hero_eyebrow" varchar,
  	"hero_heading" varchar,
  	"hero_body" varchar,
  	"hero_media_id" integer,
  	"intro_heading" varchar,
  	"intro_body" varchar,
  	"contact_heading" varchar,
  	"contact_body" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "city_site_profiles_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"locations_id" integer,
  	"users_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "city_site_profiles_id" integer;
  ALTER TABLE "city_site_profiles" ADD CONSTRAINT "city_site_profiles_city_id_locations_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "city_site_profiles" ADD CONSTRAINT "city_site_profiles_hero_media_id_media_id_fk" FOREIGN KEY ("hero_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "city_site_profiles_rels" ADD CONSTRAINT "city_site_profiles_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."city_site_profiles"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "city_site_profiles_rels" ADD CONSTRAINT "city_site_profiles_rels_locations_fk" FOREIGN KEY ("locations_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "city_site_profiles_rels" ADD CONSTRAINT "city_site_profiles_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "city_site_profiles_city_idx" ON "city_site_profiles" USING btree ("city_id");
  CREATE INDEX "city_site_profiles_hero_media_idx" ON "city_site_profiles" USING btree ("hero_media_id");
  CREATE INDEX "city_site_profiles_updated_at_idx" ON "city_site_profiles" USING btree ("updated_at");
  CREATE INDEX "city_site_profiles_created_at_idx" ON "city_site_profiles" USING btree ("created_at");
  CREATE INDEX "city_site_profiles_rels_order_idx" ON "city_site_profiles_rels" USING btree ("order");
  CREATE INDEX "city_site_profiles_rels_parent_idx" ON "city_site_profiles_rels" USING btree ("parent_id");
  CREATE INDEX "city_site_profiles_rels_path_idx" ON "city_site_profiles_rels" USING btree ("path");
  CREATE INDEX "city_site_profiles_rels_locations_id_idx" ON "city_site_profiles_rels" USING btree ("locations_id");
  CREATE INDEX "city_site_profiles_rels_users_id_idx" ON "city_site_profiles_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_city_site_profiles_fk" FOREIGN KEY ("city_site_profiles_id") REFERENCES "public"."city_site_profiles"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_city_site_profiles_id_idx" ON "payload_locked_documents_rels" USING btree ("city_site_profiles_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "city_site_profiles" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "city_site_profiles_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "city_site_profiles" CASCADE;
  DROP TABLE "city_site_profiles_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_city_site_profiles_fk";
  
  DROP INDEX "payload_locked_documents_rels_city_site_profiles_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "city_site_profiles_id";
  DROP TYPE "public"."enum_city_site_profiles_service_status";`)
}
