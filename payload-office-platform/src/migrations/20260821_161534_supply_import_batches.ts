import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DO $$
  BEGIN
    IF to_regtype('public.enum_buildings_data_source_source') IS NULL THEN
      CREATE TYPE "public"."enum_buildings_data_source_source" AS ENUM('huizuxuanzhi', 'manual-import');
    END IF;
    IF to_regtype('public.enum_supply_import_batches_type') IS NULL THEN
      CREATE TYPE "public"."enum_supply_import_batches_type" AS ENUM('buildings', 'listings');
    END IF;
    IF to_regtype('public.enum_supply_import_batches_status') IS NULL THEN
      CREATE TYPE "public"."enum_supply_import_batches_status" AS ENUM('preflight', 'queued', 'running', 'completed', 'failed');
    END IF;
    IF to_regtype('public.enum_location_aliases_kind') IS NULL THEN
      CREATE TYPE "public"."enum_location_aliases_kind" AS ENUM('city', 'district', 'business_area', 'metro_station');
    END IF;
  END $$;
  ALTER TYPE "public"."enum_buildings_data_source_source" ADD VALUE IF NOT EXISTS 'manual-import';
  ALTER TYPE "public"."enum_listings_data_source_source" ADD VALUE IF NOT EXISTS 'manual-import';
  CREATE TABLE IF NOT EXISTS "supply_import_batches" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"type" "enum_supply_import_batches_type" NOT NULL,
  	"status" "enum_supply_import_batches_status" DEFAULT 'preflight' NOT NULL,
  	"operator_id" integer,
  	"city_id" integer,
  	"file_name" varchar,
  	"row_count" numeric,
  	"valid_rows" jsonb,
  	"row_errors" jsonb,
  	"stats_processed" numeric DEFAULT 0,
  	"stats_created" numeric DEFAULT 0,
  	"stats_updated" numeric DEFAULT 0,
  	"stats_failed" numeric DEFAULT 0,
  	"affected_ids" jsonb,
  	"started_at" timestamp(3) with time zone,
  	"finished_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS "location_aliases" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alias" varchar NOT NULL,
  	"normalized_alias" varchar NOT NULL,
  	"kind" "enum_location_aliases_kind" NOT NULL,
  	"location_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "data_source_source" "enum_buildings_data_source_source";
  ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "data_source_external_id" varchar;
  ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "data_source_synced_at" timestamp(3) with time zone;
  ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "data_source_source_url" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "supply_import_batches_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "location_aliases_id" integer;
  DO $$ BEGIN
    ALTER TABLE "supply_import_batches" ADD CONSTRAINT "supply_import_batches_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  DO $$ BEGIN
    ALTER TABLE "supply_import_batches" ADD CONSTRAINT "supply_import_batches_city_id_locations_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  DO $$ BEGIN
    ALTER TABLE "location_aliases" ADD CONSTRAINT "location_aliases_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  CREATE INDEX IF NOT EXISTS "supply_import_batches_operator_idx" ON "supply_import_batches" USING btree ("operator_id");
  CREATE INDEX IF NOT EXISTS "supply_import_batches_city_idx" ON "supply_import_batches" USING btree ("city_id");
  CREATE INDEX IF NOT EXISTS "supply_import_batches_updated_at_idx" ON "supply_import_batches" USING btree ("updated_at");
  CREATE INDEX IF NOT EXISTS "supply_import_batches_created_at_idx" ON "supply_import_batches" USING btree ("created_at");
  CREATE INDEX IF NOT EXISTS "location_aliases_normalized_alias_idx" ON "location_aliases" USING btree ("normalized_alias");
  CREATE INDEX IF NOT EXISTS "location_aliases_location_idx" ON "location_aliases" USING btree ("location_id");
  CREATE INDEX IF NOT EXISTS "location_aliases_updated_at_idx" ON "location_aliases" USING btree ("updated_at");
  CREATE INDEX IF NOT EXISTS "location_aliases_created_at_idx" ON "location_aliases" USING btree ("created_at");
  CREATE UNIQUE INDEX IF NOT EXISTS "normalizedAlias_kind_idx" ON "location_aliases" USING btree ("normalized_alias","kind");
  DO $$ BEGIN
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_supply_import_batches_fk" FOREIGN KEY ("supply_import_batches_id") REFERENCES "public"."supply_import_batches"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  DO $$ BEGIN
    ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_location_aliases_fk" FOREIGN KEY ("location_aliases_id") REFERENCES "public"."location_aliases"("id") ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_supply_import_batches_id_idx" ON "payload_locked_documents_rels" USING btree ("supply_import_batches_id");
  CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_location_aliases_id_idx" ON "payload_locked_documents_rels" USING btree ("location_aliases_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "supply_import_batches" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "location_aliases" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "supply_import_batches" CASCADE;
  DROP TABLE "location_aliases" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_supply_import_batches_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_location_aliases_fk";
  
  ALTER TABLE "listings" ALTER COLUMN "data_source_source" SET DATA TYPE text;
  DROP TYPE "public"."enum_listings_data_source_source";
  CREATE TYPE "public"."enum_listings_data_source_source" AS ENUM('huizuxuanzhi');
  ALTER TABLE "listings" ALTER COLUMN "data_source_source" SET DATA TYPE "public"."enum_listings_data_source_source" USING "data_source_source"::"public"."enum_listings_data_source_source";
  DROP INDEX "payload_locked_documents_rels_supply_import_batches_id_idx";
  DROP INDEX "payload_locked_documents_rels_location_aliases_id_idx";
  ALTER TABLE "buildings" DROP COLUMN "data_source_source";
  ALTER TABLE "buildings" DROP COLUMN "data_source_external_id";
  ALTER TABLE "buildings" DROP COLUMN "data_source_synced_at";
  ALTER TABLE "buildings" DROP COLUMN "data_source_source_url";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "supply_import_batches_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "location_aliases_id";
  DROP TYPE "public"."enum_buildings_data_source_source";
  DROP TYPE "public"."enum_supply_import_batches_type";
  DROP TYPE "public"."enum_supply_import_batches_status";
  DROP TYPE "public"."enum_location_aliases_kind";`)
}
