import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_listings_sale_terms_property_right_years" AS ENUM('40', '50', '70');
  CREATE TYPE "public"."enum_listings_sale_terms_sale_tax_bearer" AS ENUM('buyer', 'seller', 'split', 'negotiable');
  ALTER TYPE "public"."enum_listings_publication_status" ADD VALUE 'sold';
  ALTER TABLE "listings" ADD COLUMN "sale_terms_property_right_years" "enum_listings_sale_terms_property_right_years";
  ALTER TABLE "listings" ADD COLUMN "sale_terms_sale_tax_bearer" "enum_listings_sale_terms_sale_tax_bearer";
  ALTER TABLE "listings" ADD COLUMN "sale_terms_sale_five_years_unique" boolean;
  ALTER TABLE "listings" ADD COLUMN "sale_terms_sale_parking_spaces" numeric;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "listings" ALTER COLUMN "publication_status" SET DATA TYPE text;
  ALTER TABLE "listings" ALTER COLUMN "publication_status" SET DEFAULT 'draft'::text;
  DROP TYPE "public"."enum_listings_publication_status";
  CREATE TYPE "public"."enum_listings_publication_status" AS ENUM('draft', 'published', 'unpublished', 'leased');
  ALTER TABLE "listings" ALTER COLUMN "publication_status" SET DEFAULT 'draft'::"public"."enum_listings_publication_status";
  ALTER TABLE "listings" ALTER COLUMN "publication_status" SET DATA TYPE "public"."enum_listings_publication_status" USING "publication_status"::"public"."enum_listings_publication_status";
  ALTER TABLE "listings" DROP COLUMN "sale_terms_property_right_years";
  ALTER TABLE "listings" DROP COLUMN "sale_terms_sale_tax_bearer";
  ALTER TABLE "listings" DROP COLUMN "sale_terms_sale_five_years_unique";
  ALTER TABLE "listings" DROP COLUMN "sale_terms_sale_parking_spaces";
  DROP TYPE "public"."enum_listings_sale_terms_property_right_years";
  DROP TYPE "public"."enum_listings_sale_terms_sale_tax_bearer";`)
}
