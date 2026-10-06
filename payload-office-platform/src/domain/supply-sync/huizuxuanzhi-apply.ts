/**
 * 汇租选址同步行 → Payload 写入数据（OPT-104 §5.2）。全部纯函数：不查库、不读时钟（时刻由调用方传入）。
 *
 * 写入规则一句话：**新建一律草稿；房源覆盖采集字段；楼盘只填空；状态 / 商户 / 媒体 / slug 在更新时一律不碰。**
 *
 * 与 OPT-041 `import-task.ts` 的「留空即清空」刻意不同：那边的表格是运营手里的唯一真相，
 * 这边的楼盘可能被运营在后台精修过，采集值只能补空，不能盖掉人的修改。房源则相反——
 * 价格 / 面积天天变，采集值就是最新事实，所以覆盖。
 */

import type { HuizuBuildingRow, HuizuListingRow } from './huizuxuanzhi-row'
import { HUIZU_SOURCE } from './huizuxuanzhi-row'

// ---------------------------------------------------------------------------
// 富文本
// ---------------------------------------------------------------------------

type LexicalText = {
  type: 'text'
  text: string
  mode: 'normal'
  style: ''
  detail: 0
  format: 0
  version: 1
}
type LexicalParagraph = {
  type: 'paragraph'
  format: ''
  indent: 0
  version: 1
  direction: 'ltr'
  textFormat: 0
  children: LexicalText[]
}
export type LexicalDoc = {
  root: {
    type: 'root'
    format: ''
    indent: 0
    version: 1
    direction: 'ltr'
    children: LexicalParagraph[]
  }
}

/** 纯文本按行切成段落；空文本返回 null（与 2026-08 那轮生产数据同结构）。 */
export function textToLexical(text: string | null): LexicalDoc | null {
  const lines = (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return null
  return {
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      direction: 'ltr',
      children: lines.map((line) => ({
        type: 'paragraph',
        format: '',
        indent: 0,
        version: 1,
        direction: 'ltr',
        textFormat: 0,
        children: [
          {
            type: 'text',
            text: line,
            mode: 'normal',
            style: '',
            detail: 0,
            format: 0,
            version: 1,
          },
        ],
      })),
    },
  }
}

/** 富文本里有没有任何非空文字（运营清空过的编辑器会留下空段落，算「空」）。 */
export function lexicalHasText(value: unknown): boolean {
  const walk = (node: unknown): boolean => {
    if (typeof node !== 'object' || node === null) return false
    const n = node as { text?: unknown; children?: unknown; root?: unknown }
    if (typeof n.text === 'string' && n.text.trim() !== '') return true
    if (n.root) return walk(n.root)
    return Array.isArray(n.children) && n.children.some(walk)
  }
  return walk(value)
}

// ---------------------------------------------------------------------------
// 楼盘
// ---------------------------------------------------------------------------

export type BuildingRefs = Readonly<{
  cityId: number
  districtId: number
  businessDistrictId: number | null
}>

const yearToDate = (year: number | null) => (year === null ? null : new Date(Date.UTC(year, 0, 1)).toISOString())

/** 采集事实对应的楼盘字段（不含 slug / 状态 / dataSource / 媒体）。 */
export function buildingFactFields(row: HuizuBuildingRow, refs: BuildingRefs) {
  return {
    name: row.name,
    city: refs.cityId,
    district: refs.districtId,
    businessDistrict: refs.businessDistrictId,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    completionDate: yearToDate(row.completionYear),
    totalFloors: row.totalFloors,
    propertyCompany: row.propertyCompany,
    propertyFee: row.propertyFee,
    parkingSpaces: row.parkingSpaces,
    developerAndScale: {
      developer: row.developer,
      grossFloorArea: row.grossFloorArea,
      standardFloorHeight: row.standardFloorHeight,
      netCeilingHeight: row.netCeilingHeight,
    },
    verticalTransport: {
      passengerElevators: row.passengerElevators,
      zoningNote: row.elevatorNote,
    },
    buildingServices: {
      airConditioning: row.airConditioning,
      network: row.network,
      parkingFee: row.parkingFee,
    },
    description: textToLexical(row.description),
  }
}

export function huizuDataSource(row: { externalId: string; sourceUrl: string }, syncedAt: string) {
  return {
    source: HUIZU_SOURCE,
    externalId: row.externalId,
    sourceUrl: row.sourceUrl,
    syncedAt,
  }
}

/** 新建楼盘：草稿 + 启用（启停是另一条轴，草稿已保证前台不可见）。 */
export function buildingCreateData(row: HuizuBuildingRow, refs: BuildingRefs, syncedAt: string) {
  return {
    ...buildingFactFields(row, refs),
    slug: row.slug,
    status: 'draft' as const,
    operationalStatus: 'active' as const,
    dataSource: huizuDataSource(row, syncedAt),
  }
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

/**
 * 已有楼盘的「只填空」补丁：只给库里为空的字段赋采集值；name / city / district 永不改。
 * 组字段带上库里原值整组提交——补丁只改空的子字段，其余子字段原样回写。
 *
 * 返回 `filled` 列出实际补上的字段路径，供批次统计与审计；为空说明这栋楼没什么可补。
 */
export function buildingFillPatch(
  existing: Readonly<Record<string, unknown>>,
  row: HuizuBuildingRow,
  refs: BuildingRefs,
): { patch: Record<string, unknown>; filled: string[] } {
  const facts = buildingFactFields(row, refs)
  const patch: Record<string, unknown> = {}
  const filled: string[] = []
  const NEVER = new Set(['name', 'city', 'district'])

  for (const [key, value] of Object.entries(facts)) {
    if (NEVER.has(key) || isEmpty(value)) continue
    if (key === 'description') {
      if (!lexicalHasText(existing.description)) {
        patch.description = value
        filled.push('description')
      }
      continue
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const current = (existing[key] ?? {}) as Record<string, unknown>
      const group: Record<string, unknown> = { ...current }
      let touched = false
      for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
        if (!isEmpty(subValue) && isEmpty(current[sub])) {
          group[sub] = subValue
          filled.push(`${key}.${sub}`)
          touched = true
        }
      }
      if (touched) patch[key] = group
      continue
    }
    if (isEmpty(existing[key])) {
      patch[key] = value
      filled.push(key)
    }
  }
  return { patch, filled }
}

// ---------------------------------------------------------------------------
// 房源
// ---------------------------------------------------------------------------

const registrationStatus = (v: boolean | null) =>
  v === true ? ('available' as const) : v === false ? ('unavailable' as const) : null

/** 采集事实对应的房源字段（不含 slug / 状态 / 商户 / 媒体 / dataSource）。 */
export function listingFactFields(row: HuizuListingRow, buildingId: number) {
  return {
    title: row.title,
    listingType: 'traditional-office' as const,
    businessType: 'lease' as const,
    building: buildingId,
    area: row.area,
    // 旧两列仍是 C 端价格单位筛选与楼盘聚合的查询路径，结构化四件套才是展示 / 排序真相（同 OPT-045）
    rent: row.dailyRent,
    rentUnit: row.dailyRent === null ? null : ('rmb-sqm-day' as const),
    price: {
      amount: row.dailyRent,
      currency: 'CNY' as const,
      period: 'day' as const,
      unit: 'sqm' as const,
    },
    decorationStatus: row.decorationStatus,
    registrationStatus: registrationStatus(row.registrable),
    floor: row.floor,
    minimumLeaseMonths: row.minimumLeaseMonths,
    paymentTerms: row.paymentTerms,
    seats: row.seatMax,
    spaceDetails: {
      efficiencyRate: row.efficiencyRate,
      seatMin: row.seatMin,
      seatMax: row.seatMax,
      orientation: row.orientation,
      isDivisible: row.isDivisible,
    },
    costTerms: {
      depositMonths: row.depositMonths,
      propertyFeeAmount: row.propertyFee,
    },
    description: textToLexical(row.description),
  }
}

/** 新建房源：草稿 / 未提交 / 正常——一律不上架（拍板 ⑤）。 */
export function listingCreateData(row: HuizuListingRow, buildingId: number, merchantId: number, syncedAt: string) {
  return {
    ...listingFactFields(row, buildingId),
    slug: row.slug,
    merchant: merchantId,
    publicationStatus: 'draft' as const,
    reviewStatus: 'not_submitted' as const,
    supplyVisibilityHold: 'normal' as const,
    dataSource: huizuDataSource(row, syncedAt),
  }
}

/**
 * 把嵌套对象摊平成 `a.b` → 叶子值，用于比对与快照。
 * 富文本（带 root）与读回的关系文档（带 id）当叶子，不往里钻——组字段在 Payload 里没有 id。
 */
function flatten(value: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && !('root' in value) && !('id' in value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      flatten(v, prefix ? `${prefix}.${k}` : k, out)
  } else out[prefix] = value
  return out
}

/** 富文本里的纯文字，段落以换行连接——比对只看文字，不看节点属性与键序。 */
function lexicalPlainText(value: unknown): string {
  const lines: string[] = []
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return
    const n = node as { type?: unknown; text?: unknown; children?: unknown; root?: unknown }
    if (n.root) return walk(n.root)
    if (typeof n.text === 'string') lines.push(n.text)
    if (Array.isArray(n.children)) n.children.forEach(walk)
    if (n.type === 'paragraph') lines.push('\n')
  }
  walk(value)
  return lines.join('').trim()
}

const normalizeLeaf = (v: unknown): unknown => {
  if (v === undefined || v === '') return null
  // 富文本读回后键序与写入时不同（2026-10-06 真库实测），按 JSON 比会把没变的描述判成「变了」
  if (typeof v === 'object' && v !== null && 'root' in v) return lexicalPlainText(v) || null
  if (typeof v === 'object' && v !== null && 'id' in v) return (v as { id: unknown }).id // depth>0 读回的关系
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) && /^-?\d+(\.\d+)?$/.test(v))
    return Number(v) // numeric 列
  if (typeof v === 'object' && v !== null) return JSON.stringify(v)
  return v
}

/**
 * 已有房源的覆盖补丁：采集字段整组覆盖，外加刷新 dataSource（保留库里的 source / externalId）。
 *
 * `before` 是被改动叶子的原值（扁平路径），回滚时据此还原；`changed` 为空说明采集值与库里一致，
 * 这次写入只刷新 syncedAt。
 */
export function listingUpdatePatch(
  existing: Readonly<Record<string, unknown>>,
  row: HuizuListingRow,
  buildingId: number,
  syncedAt: string,
): {
  patch: Record<string, unknown>
  before: Record<string, unknown>
  changed: string[]
} {
  const facts = listingFactFields(row, buildingId)
  const next = flatten(facts)
  const prev = flatten(
    Object.fromEntries(Object.keys(facts).map((k) => [k, (existing as Record<string, unknown>)[k]])) as Record<
      string,
      unknown
    >,
  )
  const changed: string[] = []
  const before: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(next)) {
    const old = prev[path]
    if (normalizeLeaf(old) !== normalizeLeaf(value)) {
      changed.push(path)
      before[path] = old === undefined ? null : old
    }
  }
  return {
    patch: { ...facts, dataSource: huizuDataSource(row, syncedAt) },
    before,
    changed,
  }
}

/** 把 `before` 快照还原成 Payload update 用的嵌套补丁。 */
export function unflattenSnapshot(before: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [path, value] of Object.entries(before)) {
    const keys = path.split('.')
    let node = out
    keys.slice(0, -1).forEach((k) => {
      if (typeof node[k] !== 'object' || node[k] === null) node[k] = {}
      node = node[k] as Record<string, unknown>
    })
    node[keys[keys.length - 1]] = value
  }
  return out
}

export type RetireDecision = 'retire' | 'skip-deleted' | 'skip-not-published'

/**
 * 对方已消失的旧房源怎么处理：只把**已上架**的改成已下架；草稿 / 已下架 / 已租 / 已售 / 软删的不动
 *（已租已售是成交终态，比「下架」信息更多，不能被覆盖）。与 batch-rollback.ts 同口径。
 */
export function retireDecision(
  existing: Readonly<{ publicationStatus?: unknown; deletedAt?: unknown }>,
): RetireDecision {
  if (existing.deletedAt) return 'skip-deleted'
  return existing.publicationStatus === 'published' ? 'retire' : 'skip-not-published'
}
