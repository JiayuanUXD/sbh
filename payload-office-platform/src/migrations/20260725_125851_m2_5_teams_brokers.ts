import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_merchants_type" AS ENUM('OWNER', 'AGENCY', 'FLEX_OFFICE_BRAND', 'CHANNEL');
  CREATE TYPE "public"."enum_merchants_status" AS ENUM('active', 'disabled');
  CREATE TYPE "public"."enum_merchants_qualification_status" AS ENUM('pending', 'valid', 'rejected');
  CREATE TYPE "public"."enum_teams_status" AS ENUM('active', 'disabled');
  CREATE TYPE "public"."enum_brokers_employment_status" AS ENUM('active', 'disabled');
  CREATE TABLE "business_area_extensions_aliases" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"alias" varchar NOT NULL
  );
  
  CREATE TABLE "business_area_extensions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"business_area_id" integer NOT NULL,
  	"boundary" jsonb,
  	"extended_center_latitude" numeric,
  	"extended_center_longitude" numeric,
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "business_area_extensions_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"locations_id" integer,
  	"users_id" integer
  );
  
  CREATE TABLE "merchants" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"type" "enum_merchants_type" NOT NULL,
  	"contact_name" varchar,
  	"contact_phone" varchar,
  	"status" "enum_merchants_status" DEFAULT 'active' NOT NULL,
  	"qualification_status" "enum_merchants_qualification_status" DEFAULT 'pending' NOT NULL,
  	"qualification_expires_at" timestamp(3) with time zone,
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "merchants_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"locations_id" integer,
  	"users_id" integer
  );
  
  CREATE TABLE "teams" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"manager_id" integer,
  	"status" "enum_teams_status" DEFAULT 'active' NOT NULL,
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "teams_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"locations_id" integer,
  	"users_id" integer
  );
  
  CREATE TABLE "brokers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"display_name" varchar NOT NULL,
  	"user_id" integer NOT NULL,
  	"team_id" integer,
  	"employment_status" "enum_brokers_employment_status" DEFAULT 'active' NOT NULL,
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "brokers_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"locations_id" integer,
  	"users_id" integer
  );
  
  ALTER TABLE "users_rels" ADD COLUMN "teams_id" integer;
  ALTER TABLE "leads" ADD COLUMN "owner_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "business_area_extensions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "merchants_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "teams_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "brokers_id" integer;
  ALTER TABLE "business_area_extensions_aliases" ADD CONSTRAINT "business_area_extensions_aliases_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."business_area_extensions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "business_area_extensions" ADD CONSTRAINT "business_area_extensions_business_area_id_locations_id_fk" FOREIGN KEY ("business_area_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "business_area_extensions_rels" ADD CONSTRAINT "business_area_extensions_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."business_area_extensions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "business_area_extensions_rels" ADD CONSTRAINT "business_area_extensions_rels_locations_fk" FOREIGN KEY ("locations_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "business_area_extensions_rels" ADD CONSTRAINT "business_area_extensions_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "merchants_rels" ADD CONSTRAINT "merchants_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "merchants_rels" ADD CONSTRAINT "merchants_rels_locations_fk" FOREIGN KEY ("locations_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "merchants_rels" ADD CONSTRAINT "merchants_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "teams" ADD CONSTRAINT "teams_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "teams_rels" ADD CONSTRAINT "teams_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "teams_rels" ADD CONSTRAINT "teams_rels_locations_fk" FOREIGN KEY ("locations_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "teams_rels" ADD CONSTRAINT "teams_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "brokers" ADD CONSTRAINT "brokers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "brokers" ADD CONSTRAINT "brokers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "brokers_rels" ADD CONSTRAINT "brokers_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."brokers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "brokers_rels" ADD CONSTRAINT "brokers_rels_locations_fk" FOREIGN KEY ("locations_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "brokers_rels" ADD CONSTRAINT "brokers_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "business_area_extensions_aliases_order_idx" ON "business_area_extensions_aliases" USING btree ("_order");
  CREATE INDEX "business_area_extensions_aliases_parent_id_idx" ON "business_area_extensions_aliases" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "business_area_extensions_business_area_idx" ON "business_area_extensions" USING btree ("business_area_id");
  CREATE INDEX "business_area_extensions_updated_at_idx" ON "business_area_extensions" USING btree ("updated_at");
  CREATE INDEX "business_area_extensions_created_at_idx" ON "business_area_extensions" USING btree ("created_at");
  CREATE INDEX "business_area_extensions_rels_order_idx" ON "business_area_extensions_rels" USING btree ("order");
  CREATE INDEX "business_area_extensions_rels_parent_idx" ON "business_area_extensions_rels" USING btree ("parent_id");
  CREATE INDEX "business_area_extensions_rels_path_idx" ON "business_area_extensions_rels" USING btree ("path");
  CREATE INDEX "business_area_extensions_rels_locations_id_idx" ON "business_area_extensions_rels" USING btree ("locations_id");
  CREATE INDEX "business_area_extensions_rels_users_id_idx" ON "business_area_extensions_rels" USING btree ("users_id");
  CREATE INDEX "merchants_updated_at_idx" ON "merchants" USING btree ("updated_at");
  CREATE INDEX "merchants_created_at_idx" ON "merchants" USING btree ("created_at");
  CREATE INDEX "merchants_rels_order_idx" ON "merchants_rels" USING btree ("order");
  CREATE INDEX "merchants_rels_parent_idx" ON "merchants_rels" USING btree ("parent_id");
  CREATE INDEX "merchants_rels_path_idx" ON "merchants_rels" USING btree ("path");
  CREATE INDEX "merchants_rels_locations_id_idx" ON "merchants_rels" USING btree ("locations_id");
  CREATE INDEX "merchants_rels_users_id_idx" ON "merchants_rels" USING btree ("users_id");
  CREATE INDEX "teams_manager_idx" ON "teams" USING btree ("manager_id");
  CREATE INDEX "teams_updated_at_idx" ON "teams" USING btree ("updated_at");
  CREATE INDEX "teams_created_at_idx" ON "teams" USING btree ("created_at");
  CREATE INDEX "teams_rels_order_idx" ON "teams_rels" USING btree ("order");
  CREATE INDEX "teams_rels_parent_idx" ON "teams_rels" USING btree ("parent_id");
  CREATE INDEX "teams_rels_path_idx" ON "teams_rels" USING btree ("path");
  CREATE INDEX "teams_rels_locations_id_idx" ON "teams_rels" USING btree ("locations_id");
  CREATE INDEX "teams_rels_users_id_idx" ON "teams_rels" USING btree ("users_id");
  CREATE INDEX "brokers_user_idx" ON "brokers" USING btree ("user_id");
  CREATE INDEX "brokers_team_idx" ON "brokers" USING btree ("team_id");
  CREATE INDEX "brokers_updated_at_idx" ON "brokers" USING btree ("updated_at");
  CREATE INDEX "brokers_created_at_idx" ON "brokers" USING btree ("created_at");
  CREATE INDEX "brokers_rels_order_idx" ON "brokers_rels" USING btree ("order");
  CREATE INDEX "brokers_rels_parent_idx" ON "brokers_rels" USING btree ("parent_id");
  CREATE INDEX "brokers_rels_path_idx" ON "brokers_rels" USING btree ("path");
  CREATE INDEX "brokers_rels_locations_id_idx" ON "brokers_rels" USING btree ("locations_id");
  CREATE INDEX "brokers_rels_users_id_idx" ON "brokers_rels" USING btree ("users_id");
  ALTER TABLE "users_rels" ADD CONSTRAINT "users_rels_teams_fk" FOREIGN KEY ("teams_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_brokers_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."brokers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_business_area_extensions_fk" FOREIGN KEY ("business_area_extensions_id") REFERENCES "public"."business_area_extensions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_merchants_fk" FOREIGN KEY ("merchants_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_teams_fk" FOREIGN KEY ("teams_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_brokers_fk" FOREIGN KEY ("brokers_id") REFERENCES "public"."brokers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_rels_teams_id_idx" ON "users_rels" USING btree ("teams_id");
  CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_id");
  CREATE INDEX "payload_locked_documents_rels_business_area_extensions_i_idx" ON "payload_locked_documents_rels" USING btree ("business_area_extensions_id");
  CREATE INDEX "payload_locked_documents_rels_merchants_id_idx" ON "payload_locked_documents_rels" USING btree ("merchants_id");
  CREATE INDEX "payload_locked_documents_rels_teams_id_idx" ON "payload_locked_documents_rels" USING btree ("teams_id");
  CREATE INDEX "payload_locked_documents_rels_brokers_id_idx" ON "payload_locked_documents_rels" USING btree ("brokers_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "business_area_extensions_aliases" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "business_area_extensions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "business_area_extensions_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "merchants" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "merchants_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "teams" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "teams_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "brokers" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "brokers_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "business_area_extensions_aliases" CASCADE;
  DROP TABLE "business_area_extensions" CASCADE;
  DROP TABLE "business_area_extensions_rels" CASCADE;
  DROP TABLE "merchants" CASCADE;
  DROP TABLE "merchants_rels" CASCADE;
  DROP TABLE "teams" CASCADE;
  DROP TABLE "teams_rels" CASCADE;
  DROP TABLE "brokers" CASCADE;
  DROP TABLE "brokers_rels" CASCADE;
  ALTER TABLE "users_rels" DROP CONSTRAINT "users_rels_teams_fk";
  
  ALTER TABLE "leads" DROP CONSTRAINT "leads_owner_id_brokers_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_business_area_extensions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_merchants_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_teams_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_brokers_fk";
  
  DROP INDEX "users_rels_teams_id_idx";
  DROP INDEX "leads_owner_idx";
  DROP INDEX "payload_locked_documents_rels_business_area_extensions_i_idx";
  DROP INDEX "payload_locked_documents_rels_merchants_id_idx";
  DROP INDEX "payload_locked_documents_rels_teams_id_idx";
  DROP INDEX "payload_locked_documents_rels_brokers_id_idx";
  ALTER TABLE "users_rels" DROP COLUMN "teams_id";
  ALTER TABLE "leads" DROP COLUMN "owner_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "business_area_extensions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "merchants_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "teams_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "brokers_id";
  DROP TYPE "public"."enum_merchants_type";
  DROP TYPE "public"."enum_merchants_status";
  DROP TYPE "public"."enum_merchants_qualification_status";
  DROP TYPE "public"."enum_teams_status";
  DROP TYPE "public"."enum_brokers_employment_status";`)
}
