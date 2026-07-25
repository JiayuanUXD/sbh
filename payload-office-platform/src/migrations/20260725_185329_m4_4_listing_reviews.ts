import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_listing_reviews_decision" AS ENUM('submit', 'withdraw', 'approve', 'reject');
  CREATE TYPE "public"."enum_listing_reviews_task_status" AS ENUM('pending', 'processing', 'resolved', 'cancelled');
  CREATE TABLE "listing_reviews" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"listing_id" integer NOT NULL,
  	"decision" "enum_listing_reviews_decision" NOT NULL,
  	"task_status" "enum_listing_reviews_task_status",
  	"reason" varchar,
  	"snapshot" jsonb,
  	"snapshot_hash" varchar,
  	"submitted_by_id" integer,
  	"reviewed_by_id" integer,
  	"submitted_at" timestamp(3) with time zone,
  	"reviewed_at" timestamp(3) with time zone,
  	"listing_version" numeric,
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "listing_reviews_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "listing_reviews_id" integer;
  ALTER TABLE "listing_reviews" ADD CONSTRAINT "listing_reviews_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listing_reviews" ADD CONSTRAINT "listing_reviews_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listing_reviews" ADD CONSTRAINT "listing_reviews_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "listing_reviews_rels" ADD CONSTRAINT "listing_reviews_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."listing_reviews"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "listing_reviews_rels" ADD CONSTRAINT "listing_reviews_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "listing_reviews_listing_idx" ON "listing_reviews" USING btree ("listing_id");
  CREATE INDEX "listing_reviews_submitted_by_idx" ON "listing_reviews" USING btree ("submitted_by_id");
  CREATE INDEX "listing_reviews_reviewed_by_idx" ON "listing_reviews" USING btree ("reviewed_by_id");
  CREATE INDEX "listing_reviews_updated_at_idx" ON "listing_reviews" USING btree ("updated_at");
  CREATE INDEX "listing_reviews_created_at_idx" ON "listing_reviews" USING btree ("created_at");
  CREATE INDEX "listing_reviews_rels_order_idx" ON "listing_reviews_rels" USING btree ("order");
  CREATE INDEX "listing_reviews_rels_parent_idx" ON "listing_reviews_rels" USING btree ("parent_id");
  CREATE INDEX "listing_reviews_rels_path_idx" ON "listing_reviews_rels" USING btree ("path");
  CREATE INDEX "listing_reviews_rels_users_id_idx" ON "listing_reviews_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_listing_reviews_fk" FOREIGN KEY ("listing_reviews_id") REFERENCES "public"."listing_reviews"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_listing_reviews_id_idx" ON "payload_locked_documents_rels" USING btree ("listing_reviews_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "listing_reviews" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "listing_reviews_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "listing_reviews" CASCADE;
  DROP TABLE "listing_reviews_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_listing_reviews_fk";
  
  DROP INDEX "payload_locked_documents_rels_listing_reviews_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "listing_reviews_id";
  DROP TYPE "public"."enum_listing_reviews_decision";
  DROP TYPE "public"."enum_listing_reviews_task_status";`)
}
