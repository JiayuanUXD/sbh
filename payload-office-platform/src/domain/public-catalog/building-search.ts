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

import type { BuildingSummaryViewModel } from './contracts'

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

// ---------------------------------------------------------------------------
// 筛选 / 排序 / 分组纯函数（OPT-036 Task 2）
// ---------------------------------------------------------------------------

/**
 * 楼盘等级排序序位：刻意的产品排序（好在前），不是任何既有声明顺序的复制。
 *
 * `src/components/frontend/building-grade.ts` 的 `BUILDING_GRADE_LABELS` 只是
 * 「枚举值 → 中文标签」的查表映射，键的声明顺序是随手写的，不代表任何等级
 * 高低——所以这里**不跟随**它。用户点「按等级」排序时期待的是好楼优先：
 * 超甲级 > 甲级 > 创意园区 > 独栋办公。（domain 层也不能导入那个文件，
 * 它是组件层模块，跨层导入会违反层次边界；这个顾虑与上面的产品判断无关，
 * 只是恰好都指向「必须在这里独立声明」这个结论。）
 *
 * 说明这个顺序里不严谨的部分：「超甲级/甲级」是楼宇质量评级，「创意园区/
 * 独栋办公」是楼宇类型，两组概念共用同一个 `grade` 枚举字段，本不是同一把尺子
 * 上的刻度。它们排在质量评级之后只是一个约定（"标准写字楼评级 > 其它业态"），
 * 不是可辩护的序数关系。以后这个枚举增删值时必须重新审视这个常量，
 * 而不是假设它会自动跟着枚举定义顺序变。
 */
const BUILDING_GRADE_ORDER: readonly string[] = [
  'super-grade-a',
  'grade-a',
  'creative-park',
  'serviced-office',
]

/** 未识别的 grade 值排到末尾（既不在白名单里，也不能当作最高优先级）。 */
const UNKNOWN_GRADE_RANK = BUILDING_GRADE_ORDER.length

function gradeRank(grade: string | null | undefined): number {
  if (grade == null) return UNKNOWN_GRADE_RANK
  const idx = BUILDING_GRADE_ORDER.indexOf(grade)
  return idx === -1 ? UNKNOWN_GRADE_RANK : idx
}

/** 提取竣工年份；`completionDate` 缺失或非法日期返回 undefined（不当 0）。 */
function completionYearOf(doc: BuildingSummaryViewModel): number | undefined {
  const raw = doc.completionDate
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return undefined
  return new Date(t).getFullYear()
}

/**
 * 逐维度 AND、维度内多值 OR 的楼盘筛选。
 *
 * `leasableArea` 缺失（undefined）在任何面积条件（min/max/onlyWithStock）下
 * 都视为不命中——绝不能当 0 处理：0 是「确认无在租」，undefined 是「未知」，
 * 两者混淆会让「面积≥1000」筛选把未知楼盘错误地当作 0 排除（这一点恰好与预期
 * 结果一致，但语义上必须显式判断，不能依赖 `0 >= 1000` 恰好为 false 的巧合）。
 *
 * `completedAfter` 比较 `completionDate` 的年份；该字段缺失或非法同样视为不命中。
 */
export function applyBuildingFilters(
  docs: readonly BuildingSummaryViewModel[],
  input: BuildingSearchInput,
): readonly BuildingSummaryViewModel[] {
  const districtSet = input.district ? new Set(input.district) : null
  const gradeSet = input.grade ? new Set(input.grade) : null
  const metroSet = input.metro ? new Set(input.metro) : null

  return docs.filter((doc) => {
    if (districtSet && (!doc.district || !districtSet.has(doc.district.slug))) return false
    if (gradeSet && (!doc.grade || !gradeSet.has(doc.grade))) return false
    if (metroSet && (!doc.nearestMetro || !metroSet.has(doc.nearestMetro.slug))) return false

    if (input.onlyWithStock) {
      if (doc.leasableArea == null || doc.leasableArea <= 0) return false
    }

    if (input.leasableAreaMin != null) {
      if (doc.leasableArea == null || doc.leasableArea < input.leasableAreaMin) return false
    }
    if (input.leasableAreaMax != null) {
      if (doc.leasableArea == null || doc.leasableArea > input.leasableAreaMax) return false
    }

    if (input.completedAfter != null) {
      const year = completionYearOf(doc)
      if (year == null || year < input.completedAfter) return false
    }

    return true
  })
}

/**
 * 稳定排序楼盘列表；一律以 `slug.localeCompare` 收束，保证同权重时
 * 重复请求不会重新洗牌（相同输入必须产出相同顺序）。
 *
 * `leasableArea` / `completionDate` 缺失恒排到末尾，不当 0——否则一个
 * 缺失面积的楼盘会在 area-desc 里排到「0㎡」楼盘前面，语义反了。
 */
export function sortBuildings(
  docs: readonly BuildingSummaryViewModel[],
  sort: BuildingSort,
): readonly BuildingSummaryViewModel[] {
  const arr = docs.slice()
  arr.sort((a, b) => {
    switch (sort) {
      case 'stock-desc':
      case 'area-desc': {
        const av = a.leasableArea
        const bv = b.leasableArea
        if (av == null && bv == null) break
        if (av == null) return 1
        if (bv == null) return -1
        if (av !== bv) return bv - av
        break
      }
      case 'grade': {
        const ar = gradeRank(a.grade)
        const br = gradeRank(b.grade)
        if (ar !== br) return ar - br
        break
      }
      case 'completion-desc': {
        const ay = completionYearOf(a)
        const by = completionYearOf(b)
        if (ay == null && by == null) break
        if (ay == null) return 1
        if (by == null) return -1
        if (ay !== by) return by - ay
        break
      }
    }
    return a.slug.localeCompare(b.slug)
  })
  return arr
}

/**
 * 分组：有在租面积（>0）的楼盘在前，暂无在租的降权到后面（楼盘列表方案 A）。
 *
 * 组内保持入参相对顺序（不重新排序），只做稳定分区。缺失面积与 0 都归入
 * withoutStock——两者对用户而言都是「现在看不到在租房源」。
 */
export function partitionByStock(
  docs: readonly BuildingSummaryViewModel[],
): Readonly<{ withStock: readonly BuildingSummaryViewModel[]; withoutStock: readonly BuildingSummaryViewModel[] }> {
  const withStock: BuildingSummaryViewModel[] = []
  const withoutStock: BuildingSummaryViewModel[] = []
  for (const doc of docs) {
    if (doc.leasableArea != null && doc.leasableArea > 0) {
      withStock.push(doc)
    } else {
      withoutStock.push(doc)
    }
  }
  return { withStock, withoutStock }
}
