import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_listings_business_type" AS ENUM('lease', 'sale');
  CREATE TYPE "public"."enum_listings_decoration_status" AS ENUM('rough', 'simple', 'furnished', 'fully_fitted');
  CREATE TYPE "public"."enum_listings_price_currency" AS ENUM('CNY');
  CREATE TYPE "public"."enum_listings_price_period" AS ENUM('month', 'day', 'year');
  CREATE TYPE "public"."enum_listings_price_unit" AS ENUM('sqm', 'suite', 'seat');
  CREATE TYPE "public"."enum_listings_review_status" AS ENUM('not_submitted', 'pending', 'approved', 'rejected');
  CREATE TYPE "public"."enum_listings_publication_status" AS ENUM('draft', 'published', 'unpublished', 'leased');
  CREATE TYPE "public"."enum_listings_supply_visibility_hold" AS ENUM('normal', 'pending_recheck');
  CREATE TABLE "listing_merchant_relations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"listing_id" integer NOT NULL,
  	"merchant_id" integer,
  	"effective_from" timestamp(3) with time zone NOT NULL,
  	"effective_to" timestamp(3) with time zone,
  	"created_reason" varchar,
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "listing_merchant_relations_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  CREATE TABLE "listings_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL
  );
  
  ALTER TABLE "listings" ALTER COLUMN "rent" DROP NOT NULL;
  ALTER TABLE "listings" ADD COLUMN "business_type" "enum_listings_business_type" DEFAULT 'lease';
  ALTER TABLE "listings" ADD COLUMN "decoration_status" "enum_listings_decoration_status";
  ALTER TABLE "listings" ADD COLUMN "price_amount" numeric;
  ALTER TABLE "listings" ADD COLUMN "price_currency" "enum_listings_price_currency" DEFAULT 'CNY';
  ALTER TABLE "listings" ADD COLUMN "price_period" "enum_listings_price_period" DEFAULT 'month';
  ALTER TABLE "listings" ADD COLUMN "price_unit" "enum_listings_price_unit" DEFAULT 'sqm';
  ALTER TABLE "listings" ADD COLUMN "floor" varchar;
  ALTER TABLE "listings" ADD COLUMN "minimum_lease_months" numeric;
  ALTER TABLE "listings" ADD COLUMN "payment_terms" varchar;
  ALTER TABLE "listings" ADD COLUMN "review_status" "enum_listings_review_status" DEFAULT 'not_submitted';
  ALTER TABLE "listings" ADD COLUMN "publication_status" "enum_listings_publication_status" DEFAULT 'draft';
  ALTER TABLE "listings" ADD COLUMN "supply_visibility_hold" "enum_listings_supply_visibility_hold" DEFAULT 'normal';
  ALTER TABLE "listings" ADD COLUMN "version" numeric DEFAULT 1;
  ALTER TABLE "listings" ADD COLUMN "merchant_id" integer;
  ALTER TABLE "listings" ADD COLUMN "contact_broker_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "listing_merchant_relations_id" integer;
  ALTER TABLE "listing_merchant_relations" ADD CONSTRAINT "listing_merchant_relations_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listing_merchant_relations" ADD CONSTRAINT "listing_merchant_relations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listing_merchant_relations_rels" ADD CONSTRAINT "listing_merchant_relations_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."listing_merchant_relations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "listing_merchant_relations_rels" ADD CONSTRAINT "listing_merchant_relations_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "listings_gallery" ADD CONSTRAINT "listings_gallery_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listings_gallery" ADD CONSTRAINT "listings_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "listing_merchant_relations_listing_idx" ON "listing_merchant_relations" USING btree ("listing_id");
  CREATE INDEX "listing_merchant_relations_merchant_idx" ON "listing_merchant_relations" USING btree ("merchant_id");
  CREATE INDEX "listing_merchant_relations_updated_at_idx" ON "listing_merchant_relations" USING btree ("updated_at");
  CREATE INDEX "listing_merchant_relations_created_at_idx" ON "listing_merchant_relations" USING btree ("created_at");
  CREATE INDEX "listing_merchant_relations_rels_order_idx" ON "listing_merchant_relations_rels" USING btree ("order");
  CREATE INDEX "listing_merchant_relations_rels_parent_idx" ON "listing_merchant_relations_rels" USING btree ("parent_id");
  CREATE INDEX "listing_merchant_relations_rels_path_idx" ON "listing_merchant_relations_rels" USING btree ("path");
  CREATE INDEX "listing_merchant_relations_rels_users_id_idx" ON "listing_merchant_relations_rels" USING btree ("users_id");
  CREATE INDEX "listings_gallery_order_idx" ON "listings_gallery" USING btree ("_order");
  CREATE INDEX "listings_gallery_parent_id_idx" ON "listings_gallery" USING btree ("_parent_id");
  CREATE INDEX "listings_gallery_image_idx" ON "listings_gallery" USING btree ("image_id");
  ALTER TABLE "listings" ADD CONSTRAINT "listings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listings" ADD CONSTRAINT "listings_contact_broker_id_brokers_id_fk" FOREIGN KEY ("contact_broker_id") REFERENCES "public"."brokers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_listing_merchant_relations_fk" FOREIGN KEY ("listing_merchant_relations_id") REFERENCES "public"."listing_merchant_relations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "listings_merchant_idx" ON "listings" USING btree ("merchant_id");
  CREATE INDEX "listings_contact_broker_idx" ON "listings" USING btree ("contact_broker_id");
  CREATE INDEX "payload_locked_documents_rels_listing_merchant_relations_idx" ON "payload_locked_documents_rels" USING btree ("listing_merchant_relations_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "listing_merchant_relations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "listing_merchant_relations_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "listings_gallery" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "listing_merchant_relations" CASCADE;
  DROP TABLE "listing_merchant_relations_rels" CASCADE;
  DROP TABLE "listings_gallery" CASCADE;
  ALTER TABLE "listings" DROP CONSTRAINT "listings_merchant_id_merchants_id_fk";
  
  ALTER TABLE "listings" DROP CONSTRAINT "listings_contact_broker_id_brokers_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_listing_merchant_relations_fk";
  
  DROP INDEX "listings_merchant_idx";
  DROP INDEX "listings_contact_broker_idx";
  DROP INDEX "payload_locked_documents_rels_listing_merchant_relations_idx";
  ALTER TABLE "listings" ALTER COLUMN "rent" SET NOT NULL;
  ALTER TABLE "listings" DROP COLUMN "business_type";
  ALTER TABLE "listings" DROP COLUMN "decoration_status";
  ALTER TABLE "listings" DROP COLUMN "price_amount";
  ALTER TABLE "listings" DROP COLUMN "price_currency";
  ALTER TABLE "listings" DROP COLUMN "price_period";
  ALTER TABLE "listings" DROP COLUMN "price_unit";
  ALTER TABLE "listings" DROP COLUMN "floor";
  ALTER TABLE "listings" DROP COLUMN "minimum_lease_months";
  ALTER TABLE "listings" DROP COLUMN "payment_terms";
  ALTER TABLE "listings" DROP COLUMN "review_status";
  ALTER TABLE "listings" DROP COLUMN "publication_status";
  ALTER TABLE "listings" DROP COLUMN "supply_visibility_hold";
  ALTER TABLE "listings" DROP COLUMN "version";
  ALTER TABLE "listings" DROP COLUMN "merchant_id";
  ALTER TABLE "listings" DROP COLUMN "contact_broker_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "listing_merchant_relations_id";
  DROP TYPE "public"."enum_listings_business_type";
  DROP TYPE "public"."enum_listings_decoration_status";
  DROP TYPE "public"."enum_listings_price_currency";
  DROP TYPE "public"."enum_listings_price_period";
  DROP TYPE "public"."enum_listings_price_unit";
  DROP TYPE "public"."enum_listings_review_status";
  DROP TYPE "public"."enum_listings_publication_status";
  DROP TYPE "public"."enum_listings_supply_visibility_hold";`)
}
