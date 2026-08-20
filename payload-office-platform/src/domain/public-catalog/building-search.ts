/**
 * URL → BuildingSearchInput 规范化解析器
 *
 * 楼盘列表页（OPT-036）专用输入解析，风格与 `search-params.ts` 的
 * `parseListingSearchInput` / `buildCanonicalSearchParams` 保持一致：
 *   - 每个字段做白名单/边界校验，非法值静默降级或丢弃，不抛错；
 *   - 多值维度用 `getAll()` 解析，去重去空、保留首次出现顺序，长度上限 `MAX_ARRAY_LEN`；
 *   - canonical 输出时数组排序后写入，默认值不落 URL，
 *     保证同一组条件无论书写顺序如何都产生同一个 canonical 字符串。
 *
 * 面积 min > max 时两者一并丢弃：保留一个不可能满足的区间会让查询层
 * 悄悄返回空结果，比直接丢弃筛选条件更危险。
 */

const DEFAULT_PAGE_SIZE = 24 as const
const MAX_ARRAY_LEN = 20
const MIN_COMPLETED_YEAR = 1900
const MAX_PAGE = 10000

export type BuildingSort = 'stock-desc' | 'area-desc' | 'grade' | 'completion-desc'

/** 白名单顺序即 UI 排序选项的展示顺序。 */
export const BUILDING_SORTS: readonly BuildingSort[] = [
  'stock-desc',
  'area-desc',
  'grade',
  'completion-desc',
]

const BUILDING_SORT_SET = new Set<string>(BUILDING_SORTS)

const DEFAULT_SORT: BuildingSort = 'stock-desc'

export type BuildingSearchInput = Readonly<{
  city?: string
  district?: readonly string[]
  grade?: readonly string[]
  metro?: readonly string[]
  leasableAreaMin?: number
  leasableAreaMax?: number
  /** 竣工年代下限，四位年份，如 2010 */
  completedAfter?: number
  /** true 时只保留 leasableArea > 0 的楼盘 */
  onlyWithStock?: boolean
  sort: BuildingSort
  page: number
  pageSize: 24
}>

/**
 * 解析单个查询参数为字符串数组：去重去空、保留首次出现顺序。
 *
 * 与 `search-params.ts` 的 `parseStringArray` 同一惯例，额外做去重——
 * 楼盘筛选维度（区域/评级/地铁线）在 canonical 比较时要求集合语义，
 * 重复值不该改变结果也不该出现在 canonical 里。
 */
function parseDedupedStringArray(sp: URLSearchParams, key: string): readonly string[] | undefined {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of sp.getAll(key)) {
    if (typeof raw !== 'string' || raw.length === 0) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    out.push(raw)
    if (out.length >= MAX_ARRAY_LEN) break
  }
  return out.length > 0 ? out : undefined
}

function parsePositiveNumber(sp: URLSearchParams, key: string): number | undefined {
  const raw = sp.get(key)
  // 与 search-params.ts 的 parseBuildingSupplyNumber 同一惯例：前后空白一律拒绝，
  // 同一域内的两个数值解析器不该对同一个输入给出不同答案。
  if (raw == null || raw === '' || raw.trim() !== raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

function parseCompletedAfter(sp: URLSearchParams): number | undefined {
  const raw = sp.get('completedAfter')
  if (raw == null || raw === '') return undefined
  // 严格四位年份格式，拒绝 "19"、"2010.5"、"2010abc" 这类噪声输入
  if (!/^\d{4}$/.test(raw)) return undefined
  const year = Number(raw)
  const currentYear = new Date().getFullYear()
  // 上界为当前年份，含边界：今年竣工的楼盘也应能被 completedAfter=今年 筛出。
  if (year < MIN_COMPLETED_YEAR || year > currentYear) return undefined
  return year
}

function parsePage(sp: URLSearchParams): number {
  const raw = sp.get('page')
  if (raw == null || raw === '') return 1
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1
  const i = Math.trunc(n)
  // 与 search-params.ts 的 parseIntInRange(sp, 'page', 1, 10000) 同一口径：
  // 越界（含上界）一律降级为默认页 1，而不是静默钳制到边界值。
  if (i < 1 || i > MAX_PAGE) return 1
  return i
}

function parseSort(sp: URLSearchParams): BuildingSort {
  const raw = sp.get('sort')
  if (raw != null && BUILDING_SORT_SET.has(raw)) return raw as BuildingSort
  return DEFAULT_SORT
}

/**
 * 把 URLSearchParams 解析为安全的 BuildingSearchInput。
 *
 * 非法参数静默丢弃；调用方应通过 buildBuildingCanonicalParams 再生成规范化 URL。
 */
export function parseBuildingSearchInput(sp: URLSearchParams): BuildingSearchInput {
  const city = sp.get('city') || undefined
  const district = parseDedupedStringArray(sp, 'district')
  const grade = parseDedupedStringArray(sp, 'grade')
  const metro = parseDedupedStringArray(sp, 'metro')

  let leasableAreaMin = parsePositiveNumber(sp, 'leasableAreaMin')
  let leasableAreaMax = parsePositiveNumber(sp, 'leasableAreaMax')
  if (leasableAreaMin != null && leasableAreaMax != null && leasableAreaMin > leasableAreaMax) {
    leasableAreaMin = undefined
    leasableAreaMax = undefined
  }

  const completedAfter = parseCompletedAfter(sp)
  const onlyWithStock = sp.get('onlyWithStock') === '1' ? true : undefined
  const sort = parseSort(sp)
  const page = parsePage(sp)

  return {
    ...(city ? { city } : {}),
    ...(district ? { district } : {}),
    ...(grade ? { grade } : {}),
    ...(metro ? { metro } : {}),
    ...(leasableAreaMin != null ? { leasableAreaMin } : {}),
    ...(leasableAreaMax != null ? { leasableAreaMax } : {}),
    ...(completedAfter != null ? { completedAfter } : {}),
    ...(onlyWithStock != null ? { onlyWithStock } : {}),
    sort,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  }
}

/**
 * 把 BuildingSearchInput 反向序列化为规范化 URLSearchParams。
 *
 * 数组字段排序后写入，保证同一组条件无论书写顺序如何都产生同一个
 * canonical 字符串；默认值（sort=stock-desc、page=1、pageSize）不落 URL。
 */
export function buildBuildingCanonicalParams(input: BuildingSearchInput): URLSearchParams {
  const sp = new URLSearchParams()
  if (input.city) sp.set('city', input.city)
  if (input.district) for (const v of [...input.district].sort()) sp.append('district', v)
  if (input.grade) for (const v of [...input.grade].sort()) sp.append('grade', v)
  if (input.metro) for (const v of [...input.metro].sort()) sp.append('metro', v)
  if (input.leasableAreaMin != null) sp.set('leasableAreaMin', String(input.leasableAreaMin))
  if (input.leasableAreaMax != null) sp.set('leasableAreaMax', String(input.leasableAreaMax))
  if (input.completedAfter != null) sp.set('completedAfter', String(input.completedAfter))
  if (input.onlyWithStock) sp.set('onlyWithStock', '1')
  if (input.sort !== DEFAULT_SORT) sp.set('sort', input.sort)
  if (input.page > 1) sp.set('page', String(input.page))
  return sp
}
