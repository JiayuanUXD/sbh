/**
 * 批量导入的关系解析层（OPT-041 Task 3）。
 *
 * 把运营手填的中文文本（"浦东"、"环球金融中心"）解析成库里的 Location / Building 记录。
 * **核心原则：绝不模糊自动采用**——匹配不上就报错，`suggestion` / `message` 里的候选
 * 只给人看，任何分支都不把"相似度够高"当作命中。
 *
 * 纯函数 + 一次性预载表：`buildResolveTables` 在预检开始时把地理数据与别名一次性
 * 载入内存，`resolveLocation` / `resolveBuilding` 本身不发查询。
 */

import {
  normalizeAliasText,
  normalizeCityName,
  normalizeDistrictName,
} from '@/domain/supply-import/normalize'

export interface LocationCandidate {
  id: number | string
  name: string
  kind: string
  parentId: number | string | null
}

export interface BuildingCandidate {
  id: number | string
  name: string
  slug: string
  externalId: string | null
  cityId: number | string | null
}

export interface ResolveTables {
  locations: Record<string, readonly LocationCandidate[]>
  aliases: Record<string, ReadonlyMap<string, number | string>>
}

export interface RefLookupPort {
  listLocations(kind: string): Promise<readonly LocationCandidate[]>
  listAliases(kind: string): Promise<ReadonlyArray<{ normalizedAlias: string; locationId: number | string }>>
}

export type ResolveResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; suggestion?: string }

/** Levenshtein 距离。只用于生成"是否指…"的候选建议，不参与任何匹配决策。 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i]
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = curr
  }
  return prev[b.length]
}

/**
 * 相似度上限：编辑距离 / max(text.length, name.length) 超过这个比值就不算"疑似"，
 * 不放进候选建议。取 0.5 是有意选窄的——`suggestClosest` 存在的意义是"宁可不提示，
 * 也不给误导性提示"：例如"黄浦"与"浦东新区"的编辑距离是 4、比值 1.0，两者只有一个
 * 字重合且不在同一位置，把"浦东新区"推荐给正在找"黄浦"的运营只会带偏她，所以要被
 * 过滤掉，而不是"离得稍微近一点就凑活推荐"。别为了让某条期望里的候选更多而调宽这个
 * 阈值——先确认调宽后是否会把这类误导性候选也放行。
 */
const SUGGESTION_MAX_RATIO = 0.5

export function suggestClosest(text: string, names: readonly string[], limit = 3): string[] {
  return names
    .map((name) => ({
      name,
      ratio: levenshtein(text, name) / Math.max(text.length, name.length, 1),
    }))
    .filter((entry) => entry.ratio <= SUGGESTION_MAX_RATIO)
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, limit)
    .map((entry) => entry.name)
}

/** 按 kind 选规范化函数：city / district 各有专门规则，其余走通用别名规范化。 */
function normalizeByKind(kind: string, value: string): string {
  if (kind === 'city') return normalizeCityName(value)
  if (kind === 'district') return normalizeDistrictName(value)
  return normalizeAliasText(value)
}

function formatSuggestion(names: string[]): string | undefined {
  if (names.length === 0) return undefined
  return `是否指：${names.join('、')}？`
}

/**
 * 各类地理对象的上级字段中文名，用于 LOCATION_PARENT_MISMATCH 的可操作文案。
 * 项目地理层级是两条链：city → district → business_area、city → metro_line → metro_station
 * （见 src/domain/geography/location-hierarchy.ts）。错误消息要告诉运营去改哪一列，
 * 指错列比不报错还糟，所以不能对所有 kind 都写死"城市"。
 */
const PARENT_LABEL: Record<string, string> = {
  district: '城市',
  business_area: '行政区',
  metro_station: '地铁线路',
}

/** kind 不在 PARENT_LABEL 里时的中性兜底措辞，不抛错、不输出 undefined。 */
function parentLabel(kind: string): string {
  return PARENT_LABEL[kind] ?? '上级区域'
}

export function resolveLocation(
  input: { kind: string; text: string; parentId?: number | string | null },
  tables: ResolveTables,
): ResolveResult<LocationCandidate> {
  const { kind, text, parentId } = input
  const normalized = normalizeByKind(kind, text)
  const candidates = tables.locations[kind] ?? []

  // 1. 名称精确匹配（候选名称同样规范化后比较）
  let hit = candidates.find((c) => normalizeByKind(kind, c.name) === normalized)

  // 2. 别名表
  if (!hit) {
    const aliasId = tables.aliases[kind]?.get(normalized)
    if (aliasId !== undefined) {
      hit = candidates.find((c) => c.id === aliasId)
    }
  }

  // 3. 都不中 → 报错 + 候选建议
  if (!hit) {
    const suggestion = formatSuggestion(suggestClosest(normalized, candidates.map((c) => c.name)))
    return {
      ok: false,
      code: 'LOCATION_NOT_FOUND',
      message: `未找到「${text}」对应的${kind}`,
      ...(suggestion !== undefined ? { suggestion } : {}),
    }
  }

  // 4. 命中后校验父级：调用方传了 parentId 且候选的 parentId 不相等 → 报错
  if (parentId !== undefined && parentId !== null && hit.parentId !== parentId) {
    return {
      ok: false,
      code: 'LOCATION_PARENT_MISMATCH',
      message: `「${hit.name}」不属于所填的${parentLabel(kind)}`,
    }
  }

  return { ok: true, value: hit }
}

export function resolveBuilding(
  text: string,
  buildings: readonly BuildingCandidate[],
): ResolveResult<BuildingCandidate> {
  const trimmed = text.trim()

  // 1. externalId 精确匹配（区分大小写）
  const byExternalId = buildings.find((b) => b.externalId !== null && b.externalId === trimmed)
  if (byExternalId) return { ok: true, value: byExternalId }

  // 2. slug 精确匹配
  const bySlug = buildings.find((b) => b.slug === trimmed)
  if (bySlug) return { ok: true, value: bySlug }

  // 3. 规范化后名称匹配，恰好 1 条才算成功
  const normalized = normalizeAliasText(text)
  const byName = buildings.filter((b) => normalizeAliasText(b.name) === normalized)

  if (byName.length === 1) {
    return { ok: true, value: byName[0] }
  }

  // 4. 名称命中 > 1 条 → 报错要求消歧
  if (byName.length > 1) {
    const list = byName.map((b) => `${b.name}(${b.slug})`).join('、')
    return {
      ok: false,
      code: 'BUILDING_AMBIGUOUS',
      message: `「${text}」匹配到多条同名楼盘，请改填 slug 消歧：${list}`,
    }
  }

  // 5. 一条都不中 → 报错 + 候选建议
  const suggestion = formatSuggestion(suggestClosest(normalized, buildings.map((b) => b.name)))
  return {
    ok: false,
    code: 'BUILDING_NOT_FOUND',
    message: `未找到「${text}」对应的楼盘`,
    ...(suggestion !== undefined ? { suggestion } : {}),
  }
}

const LOCATION_KINDS = ['city', 'district', 'business_area', 'metro_station'] as const

export async function buildResolveTables(port: RefLookupPort): Promise<ResolveTables> {
  const locations: Record<string, readonly LocationCandidate[]> = {}
  const aliases: Record<string, ReadonlyMap<string, number | string>> = {}

  for (const kind of LOCATION_KINDS) {
    const [kindLocations, kindAliases] = await Promise.all([
      port.listLocations(kind),
      port.listAliases(kind),
    ])
    locations[kind] = kindLocations
    aliases[kind] = new Map(kindAliases.map((a) => [a.normalizedAlias, a.locationId]))
  }

  return { locations, aliases }
}
