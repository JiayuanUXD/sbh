/**
 * 楼盘重复检测纯函数（tasks.md M3.2 / design §3.4 buildings / R3, R8）
 *
 * 职责：保存前查重的判定层——
 *   1. 楼盘名称归一化（去空白、全角转半角、小写），用于「同城同名」判据
 *   2. 经纬度 Haversine 距离，用于「100 米内高相似」判据
 *   3. 单对候选比对（matchDuplicate）与候选集过滤（detectDuplicates）
 *
 * 口径（已确认决策）：同城前提下，「归一化同名 OR 100 米内」任一命中即候选。
 * 城市相等由查询层保证（只把同城候选传入本模块），纯函数不判城市。
 *
 * 无 payload / React 依赖，可独立单测。载入同城候选、执行合并迁移等读写副作用
 * 在 building-dedup-service.ts。合并保留目标不可变 ID（R8）。
 */

/** 高相似候选的稳定原因码（前端展示差异说明 / 诊断 / 审计）。 */
export const DUPLICATE_REASONS = {
  /** 同城 + 归一化后名称完全相同 */
  SAME_NAME: 'SAME_NAME',
  /** 同城 + 经纬度距离 ≤ 阈值 */
  PROXIMITY: 'PROXIMITY',
} as const

export type DuplicateReason = (typeof DUPLICATE_REASONS)[keyof typeof DUPLICATE_REASONS]

/** 「高相似」邻近判据的距离阈值（米）。tasks.md M3.2「100 米内」。 */
export const PROXIMITY_THRESHOLD_METERS = 100

/** 地理坐标（十进制度）。 */
export interface GeoPoint {
  lat: number
  lng: number
}

/** 查重输入：待保存楼盘的判据字段。城市相等由查询层保证。 */
export interface DedupInput {
  name: unknown
  latitude: unknown
  longitude: unknown
}

/** 候选楼盘：已存在记录的判据字段 + 不可变 ID。 */
export interface DedupCandidate {
  id: number | string
  name: unknown
  latitude: unknown
  longitude: unknown
}

/** 单条命中结果：候选 ID + 命中原因 + 距离（无坐标时为 null）。 */
export interface DuplicateMatch {
  id: number | string
  reasons: DuplicateReason[]
  /** 两楼盘间距离（米）；任一方缺坐标则为 null */
  distanceMeters: number | null
}

/**
 * 楼盘名称归一化：
 *   - 非字符串 → 空串
 *   - 全角 ASCII（！-～，U+FF01–U+FF5E）→ 半角
 *   - 折叠所有 Unicode 空白（含全角空格）为无
 *   - 英文小写
 * 中文楼宇后缀（大厦/广场/中心…）刻意不剥离：它们能区分同址不同楼，剥离会误合并。
 */
export function normalizeBuildingName(value: unknown): string {
  if (typeof value !== 'string') return ''
  // 全角 ASCII → 半角（U+FF01..U+FF5E 偏移 0xFEE0）
  const halfWidth = value.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  )
  // 折叠所有空白（含普通/全角空格已转半角、制表、换行）
  return halfWidth.replace(/\s+/g, '').toLowerCase()
}

/** 数值坐标解析：仅接受有限数，否则 null。 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

/** DedupInput/Candidate 的坐标 → GeoPoint（任一缺失则 null）。 */
function toGeoPoint(latitude: unknown, longitude: unknown): GeoPoint | null {
  const lat = toFiniteNumber(latitude)
  const lng = toFiniteNumber(longitude)
  if (lat === null || lng === null) return null
  return { lat, lng }
}

/**
 * 两点间大圆距离（米），Haversine 公式。地球半径取 6371008.8m（IUGG 平均半径）。
 * 同点返回 0。
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371008.8
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * 比对待保存楼盘与单个候选：同名或邻近任一命中则返回命中详情，否则 null。
 * 空名（归一化后为空）不作同名判据；任一方缺坐标则不作邻近判据。
 */
export function matchDuplicate(
  input: DedupInput,
  candidate: DedupCandidate,
): DuplicateMatch | null {
  const reasons: DuplicateReason[] = []

  const inputName = normalizeBuildingName(input.name)
  const candidateName = normalizeBuildingName(candidate.name)
  if (inputName !== '' && inputName === candidateName) {
    reasons.push(DUPLICATE_REASONS.SAME_NAME)
  }

  const inputGeo = toGeoPoint(input.latitude, input.longitude)
  const candidateGeo = toGeoPoint(candidate.latitude, candidate.longitude)
  let distanceMeters: number | null = null
  if (inputGeo !== null && candidateGeo !== null) {
    distanceMeters = haversineMeters(inputGeo, candidateGeo)
    if (distanceMeters <= PROXIMITY_THRESHOLD_METERS) {
      reasons.push(DUPLICATE_REASONS.PROXIMITY)
    }
  }

  if (reasons.length === 0) return null
  return { id: candidate.id, reasons, distanceMeters }
}

/**
 * 在同城候选集中筛出全部高相似记录。候选顺序保留，便于稳定展示。
 */
export function detectDuplicates(
  input: DedupInput,
  candidates: DedupCandidate[],
): DuplicateMatch[] {
  const out: DuplicateMatch[] = []
  for (const candidate of candidates) {
    const match = matchDuplicate(input, candidate)
    if (match !== null) out.push(match)
  }
  return out
}
