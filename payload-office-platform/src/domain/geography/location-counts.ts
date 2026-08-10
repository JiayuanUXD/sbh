/**
 * 地理聚合计数服务（tasks.md M2.5 / 多城管理后台计数）
 *
 * 全部原生 SQL 集中在此文件，经 payload.db.drizzle 执行，供四个 admin 模块
 * （城市 / 行政区 / 商圈 / 地铁线路）的列表与详情页一次性取计数。
 *
 * 边界说明（重要）：
 * - 原生 SQL 绕过 Payload 的 access control，因此**只允许返回聚合数字**
 *   （COUNT / 去重 COUNT），绝不返回任何行级明细数据（名称、坐标、边界多边形等）。
 * - 每次调用只发固定条数 SQL（不随 ids 长度增长），ids 为空时直接返回空 Map、不打库。
 *
 * 层级约定（与 location-hierarchy.ts 一致）：
 *   城市 city → 行政区 district → 商圈 business_area
 *   城市 city → 地铁线路 metro_line → 地铁站 metro_station
 * 商圈的站点 / 线路计数走 business_area_extensions_rels 关系中间表
 * （parent_id → 扩展记录，locations_id → 站点）。
 */

import type { Payload } from 'payload'
import { sql, type SQL } from 'drizzle-orm'

export type CityCounts = {
  districts: number
  businessAreas: number
  businessAreasMissingBoundary: number
  metroLines: number
  metroStations: number
  buildings: number
}
export type DistrictCounts = {
  businessAreas: number
  buildings: number
}
export type BusinessAreaCounts = {
  buildings: number
  stations: number
  metroLines: number
}
export type MetroLineCounts = {
  stations: number
}

/** 可执行原生 SQL 的最小接口；payload.db.drizzle 满足该结构，测试里可用 mock 替换 */
type Queryable = {
  execute: (query: SQL) => Promise<{ rows: Array<Record<string, unknown>> }>
}

/** SQL 结果行：值可能是 number 或 bigint 字符串 */
type Row = Record<string, number | string | null>

const ZERO_CITY: CityCounts = {
  districts: 0,
  businessAreas: 0,
  businessAreasMissingBoundary: 0,
  metroLines: 0,
  metroStations: 0,
  buildings: 0,
}
const ZERO_DISTRICT: DistrictCounts = { businessAreas: 0, buildings: 0 }
const ZERO_AREA: BusinessAreaCounts = { buildings: 0, stations: 0, metroLines: 0 }
const ZERO_LINE: MetroLineCounts = { stations: 0 }

function toNum(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  return typeof value === 'number' ? value : Number(value)
}

/**
 * 把 ids 序列化为 Postgres 数组字面量（逐个整数消毒），作为**单个**绑定参数配合 `::int[]` 使用，
 * 既避免 SQL 注入，又保证 SQL 条数与参数个数不随 ids 长度增长。
 */
function intArrayLiteral(ids: readonly (number | string)[]): string {
  return `{${ids.map((v) => Math.trunc(toNum(v))).join(',')}}`
}

async function run(db: Queryable, query: SQL): Promise<Row[]> {
  const res = await db.execute(query)
  return res.rows as unknown as Row[]
}

/**
 * 把一到多组 SQL 结果行整形为 Map<locationId, Counts>。
 * 纯函数：ids 中未命中任何行的 id 补零；多组行按 id 合并（后组覆盖前组同名计数键）。
 */
function shapeMap<C extends Record<string, number>>(
  ids: readonly (number | string)[],
  zero: C,
  groups: ReadonlyArray<ReadonlyArray<Row>>,
  pick: (row: Row) => Partial<C>,
): Map<number, C> {
  const out = new Map<number, C>()
  for (const id of ids) out.set(toNum(id), { ...zero })
  for (const group of groups) {
    for (const row of group) {
      const key = toNum(row.id)
      const current = out.get(key) ?? { ...zero }
      out.set(key, { ...current, ...pick(row) })
    }
  }
  return out
}

/** 只取 row 中实际出现的列（列缺省 / 为 NULL 时不覆盖其它组已写入的值） */
function pickKeys<C extends Record<string, number>>(
  row: Row,
  cols: ReadonlyArray<[keyof C, string]>,
): Partial<C> {
  const out: Record<string, number> = {}
  for (const [key, col] of cols) {
    if (row[col] != null) out[key as string] = toNum(row[col])
  }
  return out as Partial<C>
}

export function shapeCityCounts(
  locRows: ReadonlyArray<Row>,
  buildingRows: ReadonlyArray<Row>,
  ids: readonly (number | string)[],
): Map<number, CityCounts> {
  return shapeMap(ids, ZERO_CITY, [locRows, buildingRows], (row) =>
    pickKeys<CityCounts>(row, [
      ['districts', 'districts'],
      ['businessAreas', 'business_areas'],
      ['businessAreasMissingBoundary', 'missing_boundary'],
      ['metroLines', 'metro_lines'],
      ['metroStations', 'metro_stations'],
      ['buildings', 'buildings'],
    ]),
  )
}

export function shapeDistrictCounts(
  areaRows: ReadonlyArray<Row>,
  buildingRows: ReadonlyArray<Row>,
  ids: readonly (number | string)[],
): Map<number, DistrictCounts> {
  return shapeMap(ids, ZERO_DISTRICT, [areaRows, buildingRows], (row) =>
    pickKeys<DistrictCounts>(row, [
      ['businessAreas', 'business_areas'],
      ['buildings', 'buildings'],
    ]),
  )
}

export function shapeBusinessAreaCounts(
  buildingRows: ReadonlyArray<Row>,
  stationRows: ReadonlyArray<Row>,
  ids: readonly (number | string)[],
): Map<number, BusinessAreaCounts> {
  return shapeMap(ids, ZERO_AREA, [buildingRows, stationRows], (row) =>
    pickKeys<BusinessAreaCounts>(row, [
      ['buildings', 'buildings'],
      ['stations', 'stations'],
      ['metroLines', 'metro_lines'],
    ]),
  )
}

export function shapeMetroLineCounts(
  stationRows: ReadonlyArray<Row>,
  ids: readonly (number | string)[],
): Map<number, MetroLineCounts> {
  return shapeMap(ids, ZERO_LINE, [stationRows], (row) =>
    pickKeys<MetroLineCounts>(row, [['stations', 'stations']]),
  )
}

/** 楼盘可见性条件：照搬 src/domain/supply/public-building.ts（published + 启用 + 未删除） */
const BUILDING_VISIBLE = sql`status = 'published' AND operational_status = 'active' AND deleted_at IS NULL`

export async function countForCities(
  payload: Payload,
  ids: readonly (number | string)[],
): Promise<Map<number, CityCounts>> {
  if (ids.length === 0) return new Map()
  const db = payload.db.drizzle as Queryable
  const idParams = intArrayLiteral(ids)

  const locRows = await run(
    db,
    sql`
      SELECT l.city_id AS id,
        (COUNT(*) FILTER (WHERE l.type = 'district'))::int AS districts,
        (COUNT(*) FILTER (WHERE l.type = 'business_area'))::int AS business_areas,
        (COUNT(*) FILTER (WHERE l.type = 'metro_line'))::int AS metro_lines,
        (COUNT(*) FILTER (WHERE l.type = 'metro_station'))::int AS metro_stations,
        (COUNT(*) FILTER (WHERE l.type = 'business_area'
          AND (bae.id IS NULL OR bae.boundary IS NULL OR bae.boundary = '{}'::jsonb)))::int AS missing_boundary
      FROM "locations" l
      LEFT JOIN "business_area_extensions" bae ON bae.business_area_id = l.id
      WHERE l.city_id = ANY(${idParams}::int[])
        AND l.type IN ('district', 'business_area', 'metro_line', 'metro_station')
      GROUP BY l.city_id
    `,
  )
  const buildingRows = await run(
    db,
    sql`
      SELECT city_id AS id, COUNT(*)::int AS buildings
      FROM "buildings"
      WHERE city_id = ANY(${idParams}::int[]) AND ${BUILDING_VISIBLE}
      GROUP BY city_id
    `,
  )
  return shapeCityCounts(locRows, buildingRows, ids)
}

export async function countForDistricts(
  payload: Payload,
  ids: readonly (number | string)[],
): Promise<Map<number, DistrictCounts>> {
  if (ids.length === 0) return new Map()
  const db = payload.db.drizzle as Queryable
  const idParams = intArrayLiteral(ids)

  const areaRows = await run(
    db,
    sql`
      SELECT parent_id AS id, COUNT(*)::int AS business_areas
      FROM "locations"
      WHERE parent_id = ANY(${idParams}::int[]) AND type = 'business_area'
      GROUP BY parent_id
    `,
  )
  const buildingRows = await run(
    db,
    sql`
      SELECT district_id AS id, COUNT(*)::int AS buildings
      FROM "buildings"
      WHERE district_id = ANY(${idParams}::int[]) AND ${BUILDING_VISIBLE}
      GROUP BY district_id
    `,
  )
  return shapeDistrictCounts(areaRows, buildingRows, ids)
}

export async function countForBusinessAreas(
  payload: Payload,
  ids: readonly (number | string)[],
): Promise<Map<number, BusinessAreaCounts>> {
  if (ids.length === 0) return new Map()
  const db = payload.db.drizzle as Queryable
  const idParams = intArrayLiteral(ids)

  const buildingRows = await run(
    db,
    sql`
      SELECT business_district_id AS id, COUNT(*)::int AS buildings
      FROM "buildings"
      WHERE business_district_id = ANY(${idParams}::int[]) AND ${BUILDING_VISIBLE}
      GROUP BY business_district_id
    `,
  )
  const stationRows = await run(
    db,
    sql`
      SELECT bae.business_area_id AS id,
        (COUNT(DISTINCT rels.locations_id))::int AS stations,
        (COUNT(DISTINCT st.parent_id))::int AS metro_lines
      FROM "business_area_extensions" bae
      JOIN "business_area_extensions_rels" rels ON rels.parent_id = bae.id
      JOIN "locations" st ON st.id = rels.locations_id
      WHERE bae.business_area_id = ANY(${idParams}::int[])
      GROUP BY bae.business_area_id
    `,
  )
  return shapeBusinessAreaCounts(buildingRows, stationRows, ids)
}

export async function countForMetroLines(
  payload: Payload,
  ids: readonly (number | string)[],
): Promise<Map<number, MetroLineCounts>> {
  if (ids.length === 0) return new Map()
  const db = payload.db.drizzle as Queryable
  const idParams = intArrayLiteral(ids)

  const stationRows = await run(
    db,
    sql`
      SELECT parent_id AS id, COUNT(*)::int AS stations
      FROM "locations"
      WHERE parent_id = ANY(${idParams}::int[]) AND type = 'metro_station'
      GROUP BY parent_id
    `,
  )
  return shapeMetroLineCounts(stationRows, ids)
}