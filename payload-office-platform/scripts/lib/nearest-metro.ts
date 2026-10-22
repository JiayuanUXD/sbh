/**
 * 楼盘「最近地铁」按坐标回填（OPT-125）：纯函数，联库与写库在 scripts/backfill-nearest-metro.ts。
 *
 * - 坐标系：楼盘（汇租同步时已转高德 GCJ-02，见 huizuxuanzhi-row.ts）与地铁站（collect-geography.ts 用高德 POI 采集）
 *   都是 GCJ-02，直接算球面距离，不做坐标转换。
 * - 距离是**直线距离**（haversine），不是步行距离；步行一般比直线长 20%–40%，阈值要按直线来定。
 * - 只在同城站点里找（楼盘 city = 站点 city），避免跨城边界误配。
 * - 已经填了最近地铁的楼不动（多是运营手工维护的），只在报告里列出与计算结果不一致的。
 * - 坐标缺失、越界、落在国境外、或像是经纬度写反了的，进人工处理清单，不猜。
 */

export type StationPoint = Readonly<{
  id: number
  name: string
  slug: string
  lineId: number | null
  cityId: number | null
  lat: number
  lng: number
}>

export type BuildingPoint = Readonly<{
  id: number
  slug: string
  name: string
  status: string | null
  cityId: number | null
  lat: number | null
  lng: number | null
  nearestMetroId: number | null
}>

export type Proposal = Readonly<{
  buildingId: number
  buildingSlug: string
  buildingName: string
  status: string | null
  lat: number
  lng: number
  stationId: number
  stationName: string
  lineId: number | null
  distanceMeters: number
}>

export type InvalidCoordinate = Readonly<{ buildingId: number; buildingSlug: string; buildingName: string; lat: number | null; lng: number | null; reason: string }>

export type AlreadySet = Readonly<{
  buildingId: number
  buildingSlug: string
  buildingName: string
  currentStationId: number
  /** 有坐标时的计算结果，用来发现手工值与坐标不一致；没坐标为 null */
  computed: Readonly<{ stationId: number; stationName: string; distanceMeters: number }> | null
}>

export type NearestMetroPlan = Readonly<{
  maxDistanceMeters: number
  counts: Readonly<{
    buildings: number
    alreadySet: number
    noCoordinates: number
    invalidCoordinates: number
    noCity: number
    noStationInCity: number
    proposals: number
    tooFar: number
  }>
  /** 参与计算的楼盘（有效坐标、未填、同城有站）到最近站的直线距离分布 */
  distribution: Readonly<{ count: number; p10: number | null; p25: number | null; median: number | null; p75: number | null; p90: number | null; max: number | null; within: Readonly<Record<string, number>> }>
  proposals: readonly Proposal[]
  tooFar: readonly Proposal[]
  invalid: readonly InvalidCoordinate[]
  alreadySet: readonly AlreadySet[]
}>

const EARTH_RADIUS_M = 6_371_008.8
/** 分布表里统计的距离档（米） */
export const DISTANCE_BUCKETS = [300, 500, 800, 1000, 1500, 2000] as const

/** 球面直线距离（米），haversine。 */
export function haversineMeters(a: Readonly<{ lat: number; lng: number }>, b: Readonly<{ lat: number; lng: number }>): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 坐标能不能用；不能用时给出原因（进人工清单）。范围取中国大陆的粗略外框。 */
export function coordinateProblem(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null) return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '坐标不是有限数字'
  if (lat === 0 && lng === 0) return '坐标是 (0, 0)'
  const inChina = (y: number, x: number) => y >= 18 && y <= 54 && x >= 73 && x <= 135
  if (inChina(lat, lng)) return null
  if (inChina(lng, lat)) return '经纬度疑似写反'
  return '坐标不在国内范围'
}

function nearestOf(point: Readonly<{ lat: number; lng: number }>, stations: readonly StationPoint[]): { station: StationPoint; distance: number } | null {
  let best: { station: StationPoint; distance: number } | null = null
  for (const s of stations) {
    const d = haversineMeters(point, s)
    // 距离相同取 id 小的，保证结果稳定
    if (best === null || d < best.distance || (d === best.distance && s.id < best.station.id)) best = { station: s, distance: d }
  }
  return best
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null
  const h = (sorted.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return Math.round(sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]))
}

export function buildNearestMetroPlan(input: Readonly<{
  buildings: readonly BuildingPoint[]
  stations: readonly StationPoint[]
  maxDistanceMeters: number
}>): NearestMetroPlan {
  const stationsByCity = new Map<number, StationPoint[]>()
  for (const s of input.stations) {
    if (s.cityId === null) continue
    const list = stationsByCity.get(s.cityId) ?? []
    list.push(s)
    stationsByCity.set(s.cityId, list)
  }
  const proposals: Proposal[] = []
  const tooFar: Proposal[] = []
  const invalid: InvalidCoordinate[] = []
  const alreadySet: AlreadySet[] = []
  const distances: number[] = []
  let noCoordinates = 0
  let noCity = 0
  let noStationInCity = 0

  for (const b of input.buildings) {
    const problem = coordinateProblem(b.lat, b.lng)
    const usable = b.lat !== null && b.lng !== null && problem === null
    const candidates = b.cityId === null ? [] : (stationsByCity.get(b.cityId) ?? [])
    const nearest = usable && candidates.length > 0 ? nearestOf({ lat: b.lat as number, lng: b.lng as number }, candidates) : null

    if (b.nearestMetroId !== null) {
      alreadySet.push({
        buildingId: b.id,
        buildingSlug: b.slug,
        buildingName: b.name,
        currentStationId: b.nearestMetroId,
        computed: nearest ? { stationId: nearest.station.id, stationName: nearest.station.name, distanceMeters: Math.round(nearest.distance) } : null,
      })
      continue
    }
    if (b.lat === null || b.lng === null) {
      noCoordinates += 1
      continue
    }
    if (problem !== null) {
      invalid.push({ buildingId: b.id, buildingSlug: b.slug, buildingName: b.name, lat: b.lat, lng: b.lng, reason: problem })
      continue
    }
    if (b.cityId === null) {
      noCity += 1
      continue
    }
    if (!nearest) {
      noStationInCity += 1
      continue
    }
    const proposal: Proposal = {
      buildingId: b.id,
      buildingSlug: b.slug,
      buildingName: b.name,
      status: b.status,
      lat: b.lat,
      lng: b.lng,
      stationId: nearest.station.id,
      stationName: nearest.station.name,
      lineId: nearest.station.lineId,
      distanceMeters: Math.round(nearest.distance),
    }
    distances.push(proposal.distanceMeters)
    if (proposal.distanceMeters <= input.maxDistanceMeters) proposals.push(proposal)
    else tooFar.push(proposal)
  }

  const sorted = [...distances].sort((x, y) => x - y)
  const within: Record<string, number> = {}
  for (const bucket of DISTANCE_BUCKETS) within[String(bucket)] = sorted.filter((d) => d <= bucket).length
  return {
    maxDistanceMeters: input.maxDistanceMeters,
    counts: {
      buildings: input.buildings.length,
      alreadySet: alreadySet.length,
      noCoordinates,
      invalidCoordinates: invalid.length,
      noCity,
      noStationInCity,
      proposals: proposals.length,
      tooFar: tooFar.length,
    },
    distribution: {
      count: sorted.length,
      p10: quantile(sorted, 0.1),
      p25: quantile(sorted, 0.25),
      median: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      p90: quantile(sorted, 0.9),
      max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
      within,
    },
    proposals,
    tooFar,
    invalid,
    alreadySet,
  }
}

/** 执行阶段可以比计划更严：只取距离不超过 maxDistanceMeters 的建议。 */
export function selectProposals(plan: Pick<NearestMetroPlan, 'proposals' | 'maxDistanceMeters'>, maxDistanceMeters: number): Proposal[] {
  if (maxDistanceMeters > plan.maxDistanceMeters) {
    throw new Error(`执行阈值 ${maxDistanceMeters}m 比计划阈值 ${plan.maxDistanceMeters}m 宽：超出部分没人看过，请按新阈值重新出计划`)
  }
  return plan.proposals.filter((p) => p.distanceMeters <= maxDistanceMeters)
}

/** 每条线路（站点的上级）覆盖的楼盘数；换乘站在库里只挂首开线路，所以换乘多的线路会被低估。 */
export function lineCoverage(proposals: readonly Proposal[], lineNames: ReadonlyMap<number, string>): Array<{ lineId: number | null; lineName: string; buildings: number }> {
  const counts = new Map<number | null, number>()
  for (const p of proposals) counts.set(p.lineId, (counts.get(p.lineId) ?? 0) + 1)
  return [...counts.entries()]
    .map(([lineId, buildings]) => ({ lineId, lineName: lineId === null ? '（无上级线路）' : (lineNames.get(lineId) ?? `#${lineId}`), buildings }))
    .sort((a, b) => b.buildings - a.buildings)
}
