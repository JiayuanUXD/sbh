import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * OPT-115：楼盘物业类型换成五类办公业态。
 *
 *   旧：office_building 写字楼 / business_park 商务园区 / commercial_complex 商业综合体 / serviced_office 服务式办公
 *   新：traditional_office 传统办公 / coworking 联合办公 / full_floor 整层办公 / standalone_building 独栋办公 / business_park 商务园区
 *
 * 本文件由 `payload migrate:create` 生成；**唯一的手工改动**是两处 `UPDATE ... CASE` 值映射，
 * 各插在「列转 text」与「转回新枚举」之间——不映射的话，旧值转新枚举直接失败。生成的 DDL 未改。
 * 写法照 `20260725_130727_m2_1_locations_geo_node`（改 locations.type 枚举值的先例）。
 * 拆成「先手写数据迁移、再生成 schema 迁移」两个文件会让回滚卡死（生成的 down 无法转换新值），故不拆。
 *
 * up 映射（用户确认「推荐映射」）：office_building → traditional_office、serviced_office → coworking、
 *   business_park 不变、commercial_complex → NULL（无对应项，留给运营重选）。
 * down 映射：traditional_office → office_building、coworking → serviced_office、business_park 不变；
 *   full_floor / standalone_building 无旧对应 → NULL；up 里清空的 commercial_complex 回滚不恢复。
 *
 * 影响（2026-10-15 只读核查）：
 *   生产 —— office_building 8 行 → traditional_office；business_park 4 行不变；
 *           commercial_complex / serviced_office 0 行；其余 4434 行为空（+1 回收站）。无数据被清空。
 *   本地 —— office_building 5、serviced_office 1。
 * 枚举 `enum_buildings_building_type` 只被 `buildings.building_type` 一列使用（楼盘未开版本，无版本表）。
 * 审计日志里旧值的前后快照不改写。
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "buildings" ALTER COLUMN "building_type" SET DATA TYPE text;
  UPDATE "buildings"
  SET "building_type" = CASE "building_type"
    WHEN 'office_building' THEN 'traditional_office'
    WHEN 'serviced_office' THEN 'coworking'
    WHEN 'commercial_complex' THEN NULL
    ELSE "building_type"
  END
  WHERE "building_type" IN ('office_building', 'serviced_office', 'commercial_complex');
  DROP TYPE "public"."enum_buildings_building_type";
  CREATE TYPE "public"."enum_buildings_building_type" AS ENUM('traditional_office', 'coworking', 'full_floor', 'standalone_building', 'business_park');
  ALTER TABLE "buildings" ALTER COLUMN "building_type" SET DATA TYPE "public"."enum_buildings_building_type" USING "building_type"::"public"."enum_buildings_building_type";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "buildings" ALTER COLUMN "building_type" SET DATA TYPE text;
  UPDATE "buildings"
  SET "building_type" = CASE "building_type"
    WHEN 'traditional_office' THEN 'office_building'
    WHEN 'coworking' THEN 'serviced_office'
    WHEN 'full_floor' THEN NULL
    WHEN 'standalone_building' THEN NULL
    ELSE "building_type"
  END
  WHERE "building_type" IN ('traditional_office', 'coworking', 'full_floor', 'standalone_building');
  DROP TYPE "public"."enum_buildings_building_type";
  CREATE TYPE "public"."enum_buildings_building_type" AS ENUM('office_building', 'business_park', 'commercial_complex', 'serviced_office');
  ALTER TABLE "buildings" ALTER COLUMN "building_type" SET DATA TYPE "public"."enum_buildings_building_type" USING "building_type"::"public"."enum_buildings_building_type";`)
}
