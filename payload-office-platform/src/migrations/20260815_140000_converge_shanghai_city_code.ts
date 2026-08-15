import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * 上海城市 immutableCode 收敛：LEGACY_LOC_1 → CITY-SH，并移除零引用的重复行 SH。
 *
 * 背景：七城导入时对上海走的是「按 legacyCodes 认领存量节点、不改码」，于是上海成了
 * 唯一一个码不合 `CITY-<缩写>` 规范的城市（其余六城均为 CITY-HZ / CITY-NJ / ...）。
 * 代价是每个要寻址上海的地方都得永久携带别名表 ['CITY-SH','LEGACY_LOC_1','SH']，
 * 而只要有人把停用的重复行 SH 在后台点成启用，别名解析立刻出现两条 active 候选
 * （见 20260813_011000_seed_city_site_profiles 的 activeCities 守卫）。
 *
 * 执行时的生产状态（2026-08-15 实测）：
 *   id=1  LEGACY_LOC_1  active   前台可见  slug=shanghai    71 楼盘 + 40 下级 + 1 站点档案
 *   id=6  SH            disabled 不可见    slug=shang-hai   全部 22 个外键列 0 引用
 *   CITY-SH 不存在
 *
 * ⚠️ 指向 locations 的外键**没有一个是 RESTRICT**，全是 CASCADE 或 SET NULL：
 * 删除一个被引用的城市不会报错，而会静默把 buildings.city_id 等置空、级联删 *_rels。
 * 数据库层不提供任何保护，所以下面在 DELETE 前自己逐列点引用，非零即中止。
 *
 * 回滚：down() 忠实还原改名与被删行（原行字段已在下方按实测值固化）。
 */

type SeedDb = {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: Array<Record<string, unknown>> }>
}

const CANONICAL = 'CITY-SH'
const LEGACY = 'LEGACY_LOC_1'
const DUPLICATE = 'SH'

/** 被删行的实测快照，供 down() 还原。 */
const DUPLICATE_ROW = {
  id: 6,
  name: '上海',
  slug: 'shang-hai',
  sortOrder: 100,
  version: 2,
} as const

async function resolveCityByCode(
  db: SeedDb,
  code: string,
): Promise<{ id: number; status: string } | null> {
  const result = await db.execute(sql`
      SELECT "id", "status"
      FROM "locations"
      WHERE "immutable_code" = ${code} AND "type" = 'city'
      LIMIT 1;
  `)
  const row = result.rows[0]
  if (!row || typeof row.id !== 'number') return null
  return { id: row.id, status: String(row.status) }
}

/**
 * 逐列点引用。FK 全是 CASCADE / SET NULL，数据库不会拦，只能自己数。
 * 新增指向 locations 的外键时必须同步补进这里。
 */
async function countReferences(db: SeedDb, locationId: number): Promise<number> {
  const result = await db.execute(sql`
      SELECT (
        (SELECT count(*) FROM "locations" WHERE "parent_id" = ${locationId})
      + (SELECT count(*) FROM "locations" WHERE "city_id" = ${locationId})
      + (SELECT count(*) FROM "buildings" WHERE "city_id" = ${locationId} OR "district_id" = ${locationId} OR "business_district_id" = ${locationId} OR "nearest_metro_id" = ${locationId})
      + (SELECT count(*) FROM "leads" WHERE "city_id" = ${locationId} OR "district_id" = ${locationId})
      + (SELECT count(*) FROM "supply_submissions" WHERE "city_id" = ${locationId} OR "district_id" = ${locationId})
      + (SELECT count(*) FROM "city_site_profiles" WHERE "city_id" = ${locationId})
      + (SELECT count(*) FROM "city_partner_applications" WHERE "city_id" = ${locationId})
      + (SELECT count(*) FROM "_city_partner_applications_v" WHERE "version_city_id" = ${locationId})
      + (SELECT count(*) FROM "business_area_extensions" WHERE "business_area_id" = ${locationId})
      + (SELECT count(*) FROM "articles_rels" WHERE "locations_id" = ${locationId})
      + (SELECT count(*) FROM "brokers_rels" WHERE "locations_id" = ${locationId})
      + (SELECT count(*) FROM "merchants_rels" WHERE "locations_id" = ${locationId})
      + (SELECT count(*) FROM "teams_rels" WHERE "locations_id" = ${locationId})
      + (SELECT count(*) FROM "users_rels" WHERE "locations_id" = ${locationId})
      + (SELECT count(*) FROM "city_site_profiles_rels" WHERE "locations_id" = ${locationId})
      + (SELECT count(*) FROM "business_area_extensions_rels" WHERE "locations_id" = ${locationId})
      + (SELECT count(*) FROM "payload_locked_documents_rels" WHERE "locations_id" = ${locationId})
      ) AS "total";
  `)
  return Number(result.rows[0]?.total ?? 0)
}

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const seedDb = db as unknown as SeedDb

  const legacy = await resolveCityByCode(seedDb, LEGACY)
  const canonical = await resolveCityByCode(seedDb, CANONICAL)
  const duplicate = await resolveCityByCode(seedDb, DUPLICATE)

  // 全新空库或已收敛过：无事可做。迁移链必须能打到新环境。
  if (!legacy && !duplicate) {
    console.warn('[converge_shanghai_city_code] 未发现 LEGACY_LOC_1 / SH，判定为全新或已收敛环境，跳过。')
    return
  }

  // 两个码同时存在 = 真实歧义，必须人工判定保留哪一条，绝不自动合并。
  if (legacy && canonical) {
    throw new Error(
      `shanghai_code_converge_conflict: ${CANONICAL}(id=${canonical.id}) 与 ${LEGACY}(id=${legacy.id}) 同时存在，需人工判定保留哪一条`,
    )
  }

  if (legacy) {
    await db.execute(sql`
        UPDATE "locations"
        SET "immutable_code" = ${CANONICAL}
        WHERE "id" = ${legacy.id} AND "immutable_code" = ${LEGACY} AND "type" = 'city';
    `)
    console.warn(`[converge_shanghai_city_code] 已将 id=${legacy.id} 的 ${LEGACY} 收敛为 ${CANONICAL}。`)
  }

  if (duplicate) {
    const references = await countReferences(seedDb, duplicate.id)
    if (references > 0) {
      throw new Error(
        `shanghai_code_converge_conflict: ${DUPLICATE}(id=${duplicate.id}) 仍被 ${references} 处引用，拒绝删除；请先迁移这些引用`,
      )
    }
    await db.execute(sql`
        DELETE FROM "locations"
        WHERE "id" = ${duplicate.id} AND "immutable_code" = ${DUPLICATE} AND "type" = 'city';
    `)
    console.warn(`[converge_shanghai_city_code] 已删除零引用的重复上海节点 id=${duplicate.id}（${DUPLICATE}）。`)
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  const seedDb = db as unknown as SeedDb

  const canonical = await resolveCityByCode(seedDb, CANONICAL)
  if (canonical) {
    await db.execute(sql`
        UPDATE "locations"
        SET "immutable_code" = ${LEGACY}
        WHERE "id" = ${canonical.id} AND "immutable_code" = ${CANONICAL} AND "type" = 'city';
    `)
  }

  const duplicate = await resolveCityByCode(seedDb, DUPLICATE)
  if (!duplicate) {
    await db.execute(sql`
        INSERT INTO "locations"
          ("id", "name", "slug", "type", "parent_id", "sort_order", "immutable_code", "status", "frontend_visible", "version", "updated_at", "created_at")
        VALUES
          (${DUPLICATE_ROW.id}, ${DUPLICATE_ROW.name}, ${DUPLICATE_ROW.slug}, 'city', NULL, ${DUPLICATE_ROW.sortOrder}, ${DUPLICATE}, 'disabled', false, ${DUPLICATE_ROW.version}, now(), now())
        ON CONFLICT ("id") DO NOTHING;
    `)
  }
}
