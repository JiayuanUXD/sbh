import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * 审计动作枚举新增 listing.review_fast_track（OPT-033）。
 *
 * 平台管理员保存房源时自动上架，审计上必须与「有人点了通过」分开记——
 * 否则审计流里 review_approve 既可能是人工审过、也可能是管理员直发，事后无从区分。
 *
 * `IF NOT EXISTS` 是必需的，不是保险起见（与 20260818_072207 同因）：PG 的 ENUM
 * 加值**回滚不掉**——迁移中途失败后，已执行的 ADD VALUE 仍然生效但迁移记录没写，
 * 重跑会报「枚举标签已经存在」并卡死整条迁移链。生产上已经踩过两次
 * （20260817_172754 / 20260817_180000）。
 *
 * 这是对 Payload 生成正文的**唯一**改动：只加幂等性，不改最终 schema。
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'listing.review_fast_track' BEFORE 'listing.publish';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "audit_logs" ALTER COLUMN "action" SET DATA TYPE text;
  DROP TYPE "public"."enum_audit_logs_action";
  CREATE TYPE "public"."enum_audit_logs_action" AS ENUM('listing.create', 'listing.update', 'listing.delete', 'listing.review_submit', 'listing.review_approve', 'listing.review_reject', 'listing.publish', 'listing.unpublish', 'building.create', 'building.update', 'building.delete', 'building.freeze', 'building.restore', 'merchant.create', 'merchant.update', 'merchant.freeze', 'merchant.restore', 'report.triage', 'report.sustain', 'report.dismiss', 'report.pause_supply', 'report.resume_supply', 'report.close', 'lead.create', 'lead.update', 'lead.assign', 'lead.claim', 'lead.transfer', 'lead.to_public_pool', 'lead.reclaim', 'lead.lose', 'lead.stage_transition', 'customer.create', 'customer.update', 'followup.create', 'followup.correct', 'user.create', 'user.disable', 'user.enable', 'user.reset_password', 'role.create', 'role.update', 'role.delete', 'role.assign', 'role.revoke', 'data.import', 'data.export', 'audit.view_detail', 'audit.export');
  ALTER TABLE "audit_logs" ALTER COLUMN "action" SET DATA TYPE "public"."enum_audit_logs_action" USING "action"::"public"."enum_audit_logs_action";`)
}
