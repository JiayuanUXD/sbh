import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_members_status" AS ENUM('active', 'disabled');
  CREATE TYPE "public"."enum_member_sms_codes_purpose" AS ENUM('login', 'set-password', 'bind-wechat');
  CREATE TYPE "public"."enum_member_favorites_target_type" AS ENUM('listing', 'building');
  CREATE TABLE "members_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "members" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"nickname" varchar,
  	"status" "enum_members_status" DEFAULT 'active' NOT NULL,
  	"has_password" boolean DEFAULT false,
  	"last_login_at" timestamp(3) with time zone,
  	"wechat_union_id" varchar,
  	"wechat_open_id" varchar,
  	"wechat_bound_at" timestamp(3) with time zone,
  	"consent_policy_version" varchar NOT NULL,
  	"consent_accepted_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar,
  	"username" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "member_sms_codes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"phone" varchar NOT NULL,
  	"purpose" "enum_member_sms_codes_purpose" NOT NULL,
  	"code_hash" varchar NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"attempts" numeric DEFAULT 0 NOT NULL,
  	"consumed_at" timestamp(3) with time zone,
  	"ip_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "member_favorites" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"member_id" integer NOT NULL,
  	"target_type" "enum_member_favorites_target_type" NOT NULL,
  	"target_id" numeric NOT NULL,
  	"target_slug" varchar NOT NULL,
  	"title_snapshot" varchar NOT NULL,
  	"saved_at" timestamp(3) with time zone NOT NULL,
  	"target_key" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "members_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "member_sms_codes_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "member_favorites_id" integer;
  ALTER TABLE "payload_preferences_rels" ADD COLUMN "members_id" integer;
  ALTER TABLE "members_sessions" ADD CONSTRAINT "members_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "member_favorites" ADD CONSTRAINT "member_favorites_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "members_sessions_order_idx" ON "members_sessions" USING btree ("_order");
  CREATE INDEX "members_sessions_parent_id_idx" ON "members_sessions" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "members_wechat_union_id_idx" ON "members" USING btree ("wechat_union_id");
  CREATE INDEX "members_updated_at_idx" ON "members" USING btree ("updated_at");
  CREATE INDEX "members_created_at_idx" ON "members" USING btree ("created_at");
  CREATE UNIQUE INDEX "members_username_idx" ON "members" USING btree ("username");
  CREATE INDEX "member_sms_codes_phone_idx" ON "member_sms_codes" USING btree ("phone");
  CREATE INDEX "member_sms_codes_expires_at_idx" ON "member_sms_codes" USING btree ("expires_at");
  CREATE INDEX "member_sms_codes_updated_at_idx" ON "member_sms_codes" USING btree ("updated_at");
  CREATE INDEX "member_sms_codes_created_at_idx" ON "member_sms_codes" USING btree ("created_at");
  CREATE INDEX "member_favorites_member_idx" ON "member_favorites" USING btree ("member_id");
  CREATE UNIQUE INDEX "member_favorites_target_key_idx" ON "member_favorites" USING btree ("target_key");
  CREATE INDEX "member_favorites_updated_at_idx" ON "member_favorites" USING btree ("updated_at");
  CREATE INDEX "member_favorites_created_at_idx" ON "member_favorites" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_members_fk" FOREIGN KEY ("members_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_member_sms_codes_fk" FOREIGN KEY ("member_sms_codes_id") REFERENCES "public"."member_sms_codes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_member_favorites_fk" FOREIGN KEY ("member_favorites_id") REFERENCES "public"."member_favorites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_members_fk" FOREIGN KEY ("members_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_members_id_idx" ON "payload_locked_documents_rels" USING btree ("members_id");
  CREATE INDEX "payload_locked_documents_rels_member_sms_codes_id_idx" ON "payload_locked_documents_rels" USING btree ("member_sms_codes_id");
  CREATE INDEX "payload_locked_documents_rels_member_favorites_id_idx" ON "payload_locked_documents_rels" USING btree ("member_favorites_id");
  CREATE INDEX "payload_preferences_rels_members_id_idx" ON "payload_preferences_rels" USING btree ("members_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "members_sessions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "members" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "member_sms_codes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "member_favorites" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "members_sessions" CASCADE;
  DROP TABLE "members" CASCADE;
  DROP TABLE "member_sms_codes" CASCADE;
  DROP TABLE "member_favorites" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_members_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_member_sms_codes_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_member_favorites_fk";
  
  ALTER TABLE "payload_preferences_rels" DROP CONSTRAINT "payload_preferences_rels_members_fk";
  
  DROP INDEX "payload_locked_documents_rels_members_id_idx";
  DROP INDEX "payload_locked_documents_rels_member_sms_codes_id_idx";
  DROP INDEX "payload_locked_documents_rels_member_favorites_id_idx";
  DROP INDEX "payload_preferences_rels_members_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "members_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "member_sms_codes_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "member_favorites_id";
  ALTER TABLE "payload_preferences_rels" DROP COLUMN "members_id";
  DROP TYPE "public"."enum_members_status";
  DROP TYPE "public"."enum_member_sms_codes_purpose";
  DROP TYPE "public"."enum_member_favorites_target_type";`)
}
