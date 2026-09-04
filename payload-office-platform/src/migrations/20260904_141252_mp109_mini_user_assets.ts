import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_mini_user_assets_kind" AS ENUM('favorite-listing', 'favorite-building', 'inquiry');
  CREATE TYPE "public"."enum_mini_user_assets_target_type" AS ENUM('listing', 'building', 'general');
  CREATE TABLE "mini_user_assets" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"asset_key" varchar NOT NULL,
  	"subject" varchar NOT NULL,
  	"kind" "enum_mini_user_assets_kind" NOT NULL,
  	"target_type" "enum_mini_user_assets_target_type" NOT NULL,
  	"target_slug" varchar,
  	"lead_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "mini_user_assets_id" integer;
  ALTER TABLE "mini_user_assets" ADD CONSTRAINT "mini_user_assets_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "mini_user_assets_asset_key_idx" ON "mini_user_assets" USING btree ("asset_key");
  CREATE INDEX "mini_user_assets_subject_idx" ON "mini_user_assets" USING btree ("subject");
  CREATE INDEX "mini_user_assets_kind_idx" ON "mini_user_assets" USING btree ("kind");
  CREATE INDEX "mini_user_assets_target_type_idx" ON "mini_user_assets" USING btree ("target_type");
  CREATE INDEX "mini_user_assets_target_slug_idx" ON "mini_user_assets" USING btree ("target_slug");
  CREATE INDEX "mini_user_assets_lead_idx" ON "mini_user_assets" USING btree ("lead_id");
  CREATE INDEX "mini_user_assets_updated_at_idx" ON "mini_user_assets" USING btree ("updated_at");
  CREATE INDEX "mini_user_assets_created_at_idx" ON "mini_user_assets" USING btree ("created_at");
  CREATE INDEX "subject_kind_idx" ON "mini_user_assets" USING btree ("subject","kind");
  CREATE INDEX "subject_targetType_targetSlug_idx" ON "mini_user_assets" USING btree ("subject","target_type","target_slug");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_mini_user_assets_fk" FOREIGN KEY ("mini_user_assets_id") REFERENCES "public"."mini_user_assets"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_mini_user_assets_id_idx" ON "payload_locked_documents_rels" USING btree ("mini_user_assets_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "mini_user_assets" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "mini_user_assets" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_mini_user_assets_fk";
  
  DROP INDEX "payload_locked_documents_rels_mini_user_assets_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "mini_user_assets_id";
  DROP TYPE "public"."enum_mini_user_assets_kind";
  DROP TYPE "public"."enum_mini_user_assets_target_type";`)
}
