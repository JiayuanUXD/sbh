import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "search_aliases" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"canonical_name" varchar NOT NULL,
  	"alias" varchar NOT NULL,
  	"note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "search_aliases_id" integer;
  CREATE INDEX "search_aliases_canonical_name_idx" ON "search_aliases" USING btree ("canonical_name");
  CREATE INDEX "search_aliases_updated_at_idx" ON "search_aliases" USING btree ("updated_at");
  CREATE INDEX "search_aliases_created_at_idx" ON "search_aliases" USING btree ("created_at");
  CREATE UNIQUE INDEX "canonicalName_alias_idx" ON "search_aliases" USING btree ("canonical_name","alias");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_search_aliases_fk" FOREIGN KEY ("search_aliases_id") REFERENCES "public"."search_aliases"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_search_aliases_id_idx" ON "payload_locked_documents_rels" USING btree ("search_aliases_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "search_aliases" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "search_aliases" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_search_aliases_fk";
  
  DROP INDEX "payload_locked_documents_rels_search_aliases_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "search_aliases_id";`)
}
