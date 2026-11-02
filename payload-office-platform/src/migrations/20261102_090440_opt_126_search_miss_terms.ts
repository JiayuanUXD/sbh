import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_search_miss_terms_miss_kind" AS ENUM('zero', 'entity-no-supply', 'relaxed');
  CREATE TYPE "public"."enum_search_miss_terms_status" AS ENUM('new', 'handled', 'ignored');
  CREATE TYPE "public"."enum_search_miss_terms_resolution" AS ENUM('alias-added', 'data-gap', 'out-of-scope', 'noise');
  CREATE TABLE "search_miss_terms" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"city" varchar NOT NULL,
  	"term" varchar NOT NULL,
  	"miss_kind" "enum_search_miss_terms_miss_kind" NOT NULL,
  	"count" numeric DEFAULT 1 NOT NULL,
  	"last_result_total" numeric DEFAULT 0,
  	"first_seen_at" timestamp(3) with time zone NOT NULL,
  	"last_seen_at" timestamp(3) with time zone NOT NULL,
  	"status" "enum_search_miss_terms_status" DEFAULT 'new' NOT NULL,
  	"resolution" "enum_search_miss_terms_resolution",
  	"note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "search_miss_terms_id" integer;
  CREATE INDEX "search_miss_terms_city_idx" ON "search_miss_terms" USING btree ("city");
  CREATE INDEX "search_miss_terms_miss_kind_idx" ON "search_miss_terms" USING btree ("miss_kind");
  CREATE INDEX "search_miss_terms_count_idx" ON "search_miss_terms" USING btree ("count");
  CREATE INDEX "search_miss_terms_last_seen_at_idx" ON "search_miss_terms" USING btree ("last_seen_at");
  CREATE INDEX "search_miss_terms_status_idx" ON "search_miss_terms" USING btree ("status");
  CREATE INDEX "search_miss_terms_updated_at_idx" ON "search_miss_terms" USING btree ("updated_at");
  CREATE INDEX "search_miss_terms_created_at_idx" ON "search_miss_terms" USING btree ("created_at");
  CREATE UNIQUE INDEX "city_term_missKind_idx" ON "search_miss_terms" USING btree ("city","term","miss_kind");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_search_miss_terms_fk" FOREIGN KEY ("search_miss_terms_id") REFERENCES "public"."search_miss_terms"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_search_miss_terms_id_idx" ON "payload_locked_documents_rels" USING btree ("search_miss_terms_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "search_miss_terms" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "search_miss_terms" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_search_miss_terms_fk";
  
  DROP INDEX "payload_locked_documents_rels_search_miss_terms_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "search_miss_terms_id";
  DROP TYPE "public"."enum_search_miss_terms_miss_kind";
  DROP TYPE "public"."enum_search_miss_terms_status";
  DROP TYPE "public"."enum_search_miss_terms_resolution";`)
}
