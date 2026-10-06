/**
 * 汇租选址同步包的规范化行（OPT-104 §5）。
 *
 * 本地解析器（scripts/import-huizuxuanzhi/parse.ts）产出这两种行，序列化成 NDJSON 上传；
 * 应用内同步任务读回时**一律当 unknown 收口**，经 `parseHuizuSyncRow` 逐行校验后才用。
 * 两端共用这一份定义，字段口径不会在「采集侧」与「入库侧」之间漂移。
 *
 * 行里只放**对方页面上的事实**与确定性换算的结果（坐标已转 GCJ-02、装修已映射到本站枚举），
 * 不放任何本站 id：区 / 商圈 / 楼盘的 id 在生产与本地不同，由同步任务按名称与 externalId 现查。
 */

import { DECORATION_STATUSES, type DecorationStatus } from '@/domain/review/listing-fields'

export const HUIZU_SOURCE = 'huizuxuanzhi' as const

export type HuizuBuildingRow = Readonly<{
  kind: 'building'
  /** 对方楼盘 id（与 2026-08 那轮同口径，如 `5086`） */
  externalId: string
  sourceUrl: string
  /**
   * 新建时用的 slug（本地用 pinyin-pro 生成「名称拼音-站上id」；运行时没有拼音库）。
   * 只在新建时使用，已有楼盘的 slug 一律不动——那是线上 URL。
   */
  slug: string
  /**
   * 人工确认过的「与本站既有楼盘是同一栋」：填本站楼盘 id，任务不新建楼盘，而是给该楼盘
   * 补上 dataSource 并只填空。由 reconcile.ts 出建议、人确认后写入；缺省 null。
   */
  attachToBuildingId: number | null
  name: string
  /** 本站标准行政区名（如「浦东新区」），由对方区 id 经对照表换算；换算不了为 null */
  districtName: string | null
  /** 对方商圈名（如「四川北路」）；同步任务在所属区内按名称解析 */
  businessAreaName: string | null
  address: string | null
  /** 高德 GCJ-02 */
  latitude: number | null
  longitude: number | null
  completionYear: number | null
  totalFloors: number | null
  grossFloorArea: number | null
  standardFloorHeight: number | null
  netCeilingHeight: number | null
  passengerElevators: number | null
  /** 电梯原文（分区说明），能拆出客梯数时同时写 passengerElevators */
  elevatorNote: string | null
  airConditioning: string | null
  network: string | null
  /** 元/㎡/月 */
  propertyFee: number | null
  parkingSpaces: number | null
  parkingFee: string | null
  developer: string | null
  propertyCompany: string | null
  /** 简介纯文本，段落以 \n 分隔 */
  description: string | null
  /** 图集绝对地址，按对方顺序；首张作封面 */
  images: readonly string[]
}>

export type HuizuListingRow = Readonly<{
  kind: 'listing'
  /** 对方房源 x-id（与 2026-08 那轮同口径，如 `63425`） */
  externalId: string
  buildingExternalId: string
  sourceUrl: string
  /** 新建时用的 slug（「标题拼音-huizu-xid」）；已有房源不动 */
  slug: string
  /** 「楼盘名 面积㎡ 装修」（与 2026-08 那轮标题一致） */
  title: string
  area: number
  /** 元/㎡/天 */
  dailyRent: number | null
  decorationStatus: DecorationStatus | null
  /** 对方装修原文，映射不了时留档 */
  decorationRaw: string | null
  registrable: boolean | null
  /** 「低层 / 中层 / 高层」（对方写「低区 / 中区 / 高区」，换成 2026-08 那轮的写法） */
  floor: string | null
  orientation: string | null
  /** 百分数，如 70 */
  efficiencyRate: number | null
  seatMin: number | null
  seatMax: number | null
  isDivisible: boolean | null
  paymentTerms: string | null
  depositMonths: number | null
  minimumLeaseMonths: number | null
  /** 元/㎡/月 */
  propertyFee: number | null
  description: string | null
}>

/**
 * 对方已不存在的旧房源：生产里有、本轮采集确认没有。由 reconcile.ts 对照生产快照生成，
 * **只显式列出才下架**——绝不从「同步包里没出现」推断，否则漏传一个包就会误下架一片。
 */
export type HuizuRetireRow = Readonly<{
  kind: 'retire'
  externalId: string
  /** gone = 详情页已 500；not-enumerated = 两遍枚举都没出现 */
  reason: 'gone' | 'not-enumerated'
}>

export type HuizuSyncRow = HuizuBuildingRow | HuizuListingRow | HuizuRetireRow

export type RowParseResult =
  { readonly ok: true; readonly row: HuizuSyncRow } | { readonly ok: false; readonly errors: readonly string[] }

// ---------------------------------------------------------------------------
// unknown 收口
// ---------------------------------------------------------------------------

type Reader = {
  str(key: string, opts?: { required?: boolean; max?: number }): string | null
  num(key: string, opts?: { required?: boolean; min?: number; max?: number }): number | null
  bool(key: string): boolean | null
}

function reader(obj: Record<string, unknown>, errors: string[]): Reader {
  return {
    str(key, opts = {}) {
      const v = obj[key]
      if (v === null || v === undefined || v === '') {
        if (opts.required) errors.push(`${key} 必填`)
        return null
      }
      if (typeof v !== 'string') {
        errors.push(`${key} 应为字符串`)
        return null
      }
      const max = opts.max ?? 5000
      if (v.length > max) {
        errors.push(`${key} 超过 ${max} 字`)
        return null
      }
      return v
    },
    num(key, opts = {}) {
      const v = obj[key]
      if (v === null || v === undefined) {
        if (opts.required) errors.push(`${key} 必填`)
        return null
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push(`${key} 应为有限数值`)
        return null
      }
      if (opts.min !== undefined && v < opts.min) {
        errors.push(`${key} 不得小于 ${opts.min}`)
        return null
      }
      if (opts.max !== undefined && v > opts.max) {
        errors.push(`${key} 不得大于 ${opts.max}`)
        return null
      }
      return v
    },
    bool(key) {
      const v = obj[key]
      if (v === null || v === undefined) return null
      if (typeof v !== 'boolean') {
        errors.push(`${key} 应为布尔值`)
        return null
      }
      return v
    },
  }
}

/**
 * 图片只允许来自对方的两个图床（https）。同步任务会在服务端逐个拉取这些地址，
 * 不收窄主机就等于让上传者指挥服务器去请求任意地址（含内网，SSRF）。
 */
const IMAGE_HOSTS = new Set(['huizutec.oss-cn-shanghai.aliyuncs.com', 'www.huizuxuanzhi.com'])
export function isHuizuImageUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && IMAGE_HOSTS.has(u.host)
  } catch {
    return false
  }
}

const EXTERNAL_ID = /^\d{1,10}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SOURCE_URL = /^https:\/\/www\.huizuxuanzhi\.com\/loupan\/l\d+(-x\d+\.html)?$/

/**
 * 校验并收窄一行。任何字段类型不符都整行拒收（不做猜测性修补——修补归解析器）。
 */
export function parseHuizuSyncRow(value: unknown): RowParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['行不是对象'] }
  }
  const obj = value as Record<string, unknown>
  const errors: string[] = []
  const r = reader(obj, errors)

  const externalId = r.str('externalId', { required: true, max: 10 })
  if (externalId !== null && !EXTERNAL_ID.test(externalId)) errors.push('externalId 应为数字串')

  if (obj.kind === 'retire') {
    const reason = obj.reason
    if (reason !== 'gone' && reason !== 'not-enumerated') errors.push('reason 应为 gone 或 not-enumerated')
    const row: HuizuRetireRow = {
      kind: 'retire',
      externalId: externalId ?? '',
      reason: reason as HuizuRetireRow['reason'],
    }
    return errors.length ? { ok: false, errors } : { ok: true, row }
  }

  const sourceUrl = r.str('sourceUrl', { required: true, max: 200 })
  if (sourceUrl !== null && !SOURCE_URL.test(sourceUrl)) errors.push('sourceUrl 不是汇租选址详情页地址')
  const slug = r.str('slug', { required: true, max: 120 })
  if (slug !== null && !SLUG.test(slug)) errors.push('slug 只能是小写字母、数字与连字符')

  if (obj.kind === 'building') {
    const attach = obj.attachToBuildingId
    if (
      attach !== null &&
      attach !== undefined &&
      !(typeof attach === 'number' && Number.isSafeInteger(attach) && attach > 0)
    ) {
      errors.push('attachToBuildingId 应为正整数或 null')
    }
    const images = obj.images
    const imageList: string[] = []
    if (!Array.isArray(images)) errors.push('images 应为数组')
    else
      for (const img of images) {
        if (typeof img !== 'string' || img.length > 500 || !isHuizuImageUrl(img)) errors.push('images 含非法地址')
        else imageList.push(img)
      }
    const row: HuizuBuildingRow = {
      kind: 'building',
      externalId: externalId ?? '',
      sourceUrl: sourceUrl ?? '',
      slug: slug ?? '',
      attachToBuildingId: typeof attach === 'number' ? attach : null,
      name: r.str('name', { required: true, max: 100 }) ?? '',
      districtName: r.str('districtName', { max: 20 }),
      businessAreaName: r.str('businessAreaName', { max: 40 }),
      address: r.str('address', { max: 200 }),
      latitude: r.num('latitude', { min: 30, max: 32 }),
      longitude: r.num('longitude', { min: 120, max: 123 }),
      completionYear: r.num('completionYear', { min: 1900, max: 2100 }),
      totalFloors: r.num('totalFloors', { min: 1, max: 200 }),
      grossFloorArea: r.num('grossFloorArea', { min: 0 }),
      standardFloorHeight: r.num('standardFloorHeight', { min: 0, max: 20 }),
      netCeilingHeight: r.num('netCeilingHeight', { min: 0, max: 20 }),
      passengerElevators: r.num('passengerElevators', { min: 0, max: 500 }),
      elevatorNote: r.str('elevatorNote', { max: 500 }),
      airConditioning: r.str('airConditioning', { max: 300 }),
      network: r.str('network', { max: 200 }),
      propertyFee: r.num('propertyFee', { min: 0, max: 1000 }),
      parkingSpaces: r.num('parkingSpaces', { min: 0, max: 100000 }),
      parkingFee: r.str('parkingFee', { max: 200 }),
      developer: r.str('developer', { max: 100 }),
      propertyCompany: r.str('propertyCompany', { max: 100 }),
      description: r.str('description', { max: 20000 }),
      images: imageList,
    }
    return errors.length ? { ok: false, errors } : { ok: true, row }
  }

  if (obj.kind === 'listing') {
    const buildingExternalId = r.str('buildingExternalId', {
      required: true,
      max: 10,
    })
    if (buildingExternalId !== null && !EXTERNAL_ID.test(buildingExternalId))
      errors.push('buildingExternalId 应为数字串')
    const decorationStatus = r.str('decorationStatus', { max: 20 })
    if (decorationStatus !== null && !(DECORATION_STATUSES as readonly string[]).includes(decorationStatus)) {
      errors.push(`decorationStatus 非法：${decorationStatus}`)
    }
    const row: HuizuListingRow = {
      kind: 'listing',
      externalId: externalId ?? '',
      buildingExternalId: buildingExternalId ?? '',
      sourceUrl: sourceUrl ?? '',
      slug: slug ?? '',
      title: r.str('title', { required: true, max: 200 }) ?? '',
      area: r.num('area', { required: true, min: 1, max: 1_000_000 }) ?? 0,
      dailyRent: r.num('dailyRent', { min: 0, max: 1000 }),
      decorationStatus: decorationStatus as DecorationStatus | null,
      decorationRaw: r.str('decorationRaw', { max: 40 }),
      registrable: r.bool('registrable'),
      floor: r.str('floor', { max: 40 }),
      orientation: r.str('orientation', { max: 40 }),
      efficiencyRate: r.num('efficiencyRate', { min: 1, max: 100 }),
      seatMin: r.num('seatMin', { min: 0, max: 100000 }),
      seatMax: r.num('seatMax', { min: 0, max: 100000 }),
      isDivisible: r.bool('isDivisible'),
      paymentTerms: r.str('paymentTerms', { max: 100 }),
      depositMonths: r.num('depositMonths', { min: 0, max: 24 }),
      minimumLeaseMonths: r.num('minimumLeaseMonths', { min: 0, max: 240 }),
      propertyFee: r.num('propertyFee', { min: 0, max: 1000 }),
      description: r.str('description', { max: 20000 }),
    }
    return errors.length ? { ok: false, errors } : { ok: true, row }
  }

  return { ok: false, errors: ['kind 应为 building、listing 或 retire'] }
}
