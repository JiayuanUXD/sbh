import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_display_tags_status" AS ENUM('active', 'disabled');
  CREATE TABLE "display_tags" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"sort_order" numeric DEFAULT 0,
  	"visible" boolean DEFAULT true,
  	"status" "enum_display_tags_status" DEFAULT 'active',
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "display_tags_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "display_tags_id" integer;
  ALTER TABLE "display_tags_rels" ADD CONSTRAINT "display_tags_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."display_tags"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "display_tags_rels" ADD CONSTRAINT "display_tags_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "display_tags_code_idx" ON "display_tags" USING btree ("code");
  CREATE INDEX "display_tags_updated_at_idx" ON "display_tags" USING btree ("updated_at");
  CREATE INDEX "display_tags_created_at_idx" ON "display_tags" USING btree ("created_at");
  CREATE INDEX "display_tags_rels_order_idx" ON "display_tags_rels" USING btree ("order");
  CREATE INDEX "display_tags_rels_parent_idx" ON "display_tags_rels" USING btree ("parent_id");
  CREATE INDEX "display_tags_rels_path_idx" ON "display_tags_rels" USING btree ("path");
  CREATE INDEX "display_tags_rels_users_id_idx" ON "display_tags_rels" USING btree ("users_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_display_tags_fk" FOREIGN KEY ("display_tags_id") REFERENCES "public"."display_tags"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_display_tags_id_idx" ON "payload_locked_documents_rels" USING btree ("display_tags_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "display_tags" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "display_tags_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "display_tags" CASCADE;
  DROP TABLE "display_tags_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_display_tags_fk";
  
  DROP INDEX "payload_locked_documents_rels_display_tags_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "display_tags_id";
  DROP TYPE "public"."enum_display_tags_status";`)
}
