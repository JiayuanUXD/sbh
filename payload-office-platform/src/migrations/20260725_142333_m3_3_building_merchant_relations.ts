import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "building_merchant_relations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"building_id" integer NOT NULL,
  	"merchant_id" integer NOT NULL,
  	"effective_from" timestamp(3) with time zone NOT NULL,
  	"effective_to" timestamp(3) with time zone,
  	"created_reason" varchar,
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "building_merchant_relations_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "building_merchant_relations_id" integer;
  ALTER TABLE "building_merchant_relations" ADD CONSTRAINT "building_merchant_relations_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "building_merchant_relations" ADD CONSTRAINT "building_merchant_relations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "building_merchant_relations_rels" ADD CONSTRAINT "building_merchant_relations_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."building_merchant_relations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "building_merchant_relations_rels" ADD CONSTRAINT "building_merchant_relations_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "building_merchant_relations_building_idx" ON "building_merchant_relations" USING btree ("building_id");
  CREATE INDEX "building_merchant_relations_merchant_idx" ON "building_merchant_relations" USING btree ("merchant_id");
  CREATE INDEX "building_merchant_relations_updated_at_idx" ON "building_merchant_relations" USING btree ("updated_at");
  CREATE INDEX "building_merchant_relations_created_at_idx" ON "building_merchant_relations" USING btree ("created_at");
  CREATE INDEX "building_merchant_relations_rels_order_idx" ON "building_merchant_relations_rels" USING btree ("order");
  CREATE INDEX "building_merchant_relations_rels_parent_idx" ON "building_merchant_relations_rels" USING btree ("parent_id");
  CREATE INDEX "building_merchant_relations_rels_path_idx" ON "building_merchant_relations_rels" USING btree ("path");
  CREATE INDEX "building_merchant_relations_rels_users_id_idx" ON "building_merchant_relations_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_building_merchant_relations_fk" FOREIGN KEY ("building_merchant_relations_id") REFERENCES "public"."building_merchant_relations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_building_merchant_relation_idx" ON "payload_locked_documents_rels" USING btree ("building_merchant_relations_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "building_merchant_relations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "building_merchant_relations_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "building_merchant_relations" CASCADE;
  DROP TABLE "building_merchant_relations_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_building_merchant_relations_fk";
  
  DROP INDEX "payload_locked_documents_rels_building_merchant_relation_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "building_merchant_relations_id";`)
}
