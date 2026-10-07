/**
 * 汇租选址详情页 → 规范化同步行（OPT-104 阶段 3）。全部纯函数，不发请求、不碰库。
 *
 * 页面是服务端直出的固定模板，字段统一渲染成 `<span>标签</span><div><p>值</p></div>`，
 * 所以这里用正则按标签取值，不引入 HTML 解析库。模板一旦改版，`labelValues` 会取不到
 * 关键标签，解析报告里的「缺字段」计数会立刻暴涨——那是该回来改正则的信号，不要静默兜底。
 *
 * 换算口径（与 2026-08 那轮生产数据对齐，见 OPT-104 §5.1）：
 *   - 坐标 BD-09 → GCJ-02（本站前台用高德）；
 *   - 楼层「低区/中区/高区」→「低层/中层/高层」；
 *   - 装修按 DECORATION_MAP；「5A甲级」等模板标签不解析。
 */

import type { HuizuBuildingRow, HuizuListingRow } from '@/domain/supply-sync/huizuxuanzhi-row'
import type { DecorationStatus } from '@/domain/review/listing-fields'

const BASE = 'https://www.huizuxuanzhi.com'

/**
 * 对方区 id → 本站标准行政区名。抄自 scripts/import-business-areas.ts 的 DISTRICTS
 *（那个脚本有顶层副作用，不能 import）。808 不存在于对方站点。
 */
export const SITE_DISTRICTS: Readonly<Record<number, string>> = {
  803: '黄浦区',
  804: '徐汇区',
  805: '长宁区',
  806: '静安区',
  807: '普陀区',
  809: '虹口区',
  810: '杨浦区',
  811: '闵行区',
  812: '宝山区',
  813: '嘉定区',
  814: '浦东新区',
  815: '金山区',
  816: '松江区',
  817: '青浦区',
  818: '奉贤区',
  819: '崇明区',
}

/**
 * 装修原文 → 本站枚举。本站四档：rough 毛坯 / simple 简装 / furnished 精装带家具 / fully_fitted 拎包入住。
 * 「精装修」不带家具语义，但四档里最接近的是 furnished；「豪华装修」同理，不升到「拎包入住」。
 * 2026-08 那轮把「简单装修」也映射成了 furnished，属误映射，本轮对账按此表纠正。
 * 全量（2026-10-08）实测原文分布：精装修 28,707 / 简装修 13,749 / 中等装修 7,272 / 毛坯 4,606 /
 * 豪华装修 3,149 / 简单装修 17。「中等装修」介于简装与精装之间，归简装，不往高了报。
 */
export const DECORATION_MAP: Readonly<Record<string, DecorationStatus>> = {
  毛坯: 'rough',
  毛坯房: 'rough',
  简单装修: 'simple',
  简装修: 'simple',
  简装: 'simple',
  中等装修: 'simple',
  标准装修: 'simple',
  精装修: 'furnished',
  精装: 'furnished',
  豪华装修: 'furnished',
}

const FLOOR_ZONE: Readonly<Record<string, string>> = {
  低区: '低层',
  中区: '中层',
  高区: '高层',
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
  sdot: '⋅',
  middot: '·',
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z#0-9]+);/gi, (m, name: string) => ENTITIES[name] ?? m)
}

/** 去标签、解实体、折叠空白；空串归一为 null。 */
export function cleanText(html: string | undefined | null): string | null {
  if (html == null) return null
  // 块级标签换行：简介是 <h3>小标题</h3><p>正文</p> 结构，直接去标签会把标题和正文粘成一句
  const t = decodeEntities(html.replace(/<br\s*\/?>|<\/(?:p|h\d|div|li)>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t 　]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
  return t === '' ? null : t
}

/** 标签去掉所有空白：「层    高」「停 车 位」「可 注 册」→「层高」「停车位」「可注册」。 */
const normLabel = (s: string) => s.replace(/[\s 　]+/g, '')

/** 取页面里所有 `<span>标签</span><div><p>值</p></div>`；同名标签只取第一次出现。 */
export function labelValues(html: string): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const m of html.matchAll(/<span>([^<]{1,20})<\/span>\s*<div>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g)) {
    const key = normLabel(decodeEntities(m[1]))
    if (!out.has(key)) out.set(key, cleanText(m[2]))
  }
  return out
}

/** 取字符串里第一个数字（允许千分位与小数）。 */
export function firstNumber(s: string | null | undefined): number | null {
  if (!s) return null
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

function hidden(html: string, attr: 'id' | 'name', key: string): string | null {
  const re = new RegExp(`<input type="hidden" ${attr}="${key.replace(/[[\]]/g, '\\$&')}" value="([^"]*)"`)
  const m = html.match(re)
  return m ? decodeEntities(m[1]).trim() || null : null
}

/** 面包屑里的区 id / 商圈 id / 商圈名：`/loupan/809` 与 `/loupan/809_146`。 */
export function parseLocation(html: string): {
  siteDistrictId: number | null
  businessAreaName: string | null
} {
  const crumbStart = html.indexOf('您当前的位置')
  const crumb = crumbStart >= 0 ? html.slice(crumbStart, crumbStart + 1200) : ''
  const d = crumb.match(/href="\/loupan\/(\d{3})"/)
  const ba = crumb.match(/href="\/loupan\/\d{3}_\d+">([^<]+)<\/a>/)
  const baName = ba ? (cleanText(ba[1])?.replace(/(办公楼|办公室|写字楼)出租$/, '') ?? null) : null
  return { siteDistrictId: d ? Number(d[1]) : null, businessAreaName: baName }
}

// ---------------------------------------------------------------------------
// 坐标
// ---------------------------------------------------------------------------

const X_PI = (Math.PI * 3000) / 180

/** 百度 BD-09 → 高德/国测局 GCJ-02（标准逆变换，误差在米级）。 */
export function bd09ToGcj02(lng: number, lat: number): { lng: number; lat: number } {
  const x = lng - 0.0065
  const y = lat - 0.006
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI)
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI)
  const round = (v: number) => Math.round(v * 1e6) / 1e6
  return { lng: round(z * Math.cos(theta)), lat: round(z * Math.sin(theta)) }
}

// ---------------------------------------------------------------------------
// 字段换算
// ---------------------------------------------------------------------------

/**
 * 「2024年」→ 2024。对方后台有 Excel 导入的痕迹：部分楼盘竣工时间是 Excel 日期序列号
 *（如 `39783` = 2008-12-01，楼盘 6），按 1899-12-30 起算换成年份。
 */
export function parseYear(s: string | null): number | null {
  if (!s) return null
  const serial = s.trim().match(/^(\d{5})(?:\.\d+)?$/)
  if (serial) {
    const days = Number(serial[1])
    if (days < 10000 || days > 80000) return null
    return new Date(Date.UTC(1899, 11, 30) + days * 86_400_000).getUTCFullYear()
  }
  // 外滩一带有 1898 年竣工的老楼（楼盘 928），下限放到 1800
  const m = s.match(/(18|19|20)\d{2}/)
  return m ? Number(m[0]) : null
}

/** 「地上36层，地下3层」→ 36；「36层」→ 36；「地下3层」单独出现不算。 */
export function parseAboveGroundFloors(s: string | null): number | null {
  if (!s) return null
  const above = s.match(/地上\s*(\d+)\s*层/)
  if (above) return Number(above[1])
  // 「33」「66F」
  const bare = s.trim().match(/^(\d{1,3})\s*[Ff]?$/)
  if (bare) return Number(bare[1])
  const plain = s.replace(/地下\s*\d+\s*层/g, '').match(/(\d+)\s*层/)
  return plain ? Number(plain[1]) : null
}

/** 「4.5m，净高3.2m」→ { standard: 4.5, net: 3.2 }；「净高2.8米」只给 net。 */
export function parseHeights(s: string | null): {
  standard: number | null
  net: number | null
} {
  if (!s) return { standard: null, net: null }
  const netM = s.match(/净(?:层)?高\s*(\d+(?:\.\d+)?)/)
  const net = netM ? Number(netM[1]) : null
  const withoutNet = netM ? s.replace(netM[0], '') : s
  const std = withoutNet.match(/(\d+(?:\.\d+)?)\s*(?:m|米|M)?/)
  const standard = std ? Number(std[1]) : null
  return {
    standard: standard !== null && standard > 0 && standard < 20 ? standard : null,
    net: net !== null && net > 0 && net < 20 ? net : null,
  }
}

/** 「客梯19部，…」→ 19。只认「客梯」，不把消防梯 / 货梯算进去。 */
export function parsePassengerElevators(s: string | null): number | null {
  const m = s?.match(/客梯\s*(\d+)\s*部/)
  return m ? Number(m[1]) : null
}

/**
 * 「39元/平方米/月」→ 39；「元/㎡/月」（没填）→ null。
 * 取「元」紧前的数字：「1座:28元/平米月；2座:7元/平米月」取第一座的 28，不能取到座号 1。
 *
 * 写成「天」的：全量里 48 个楼盘是「42元/平米/天」「15元/平米/天」这种——物业费每平每天十几、
 * 几十元不可能，是把「月」写成了「天」，数值大于 3 的按月收；≤ 3 的口径说不清，丢弃。
 */
export function parseMonthlyFeePerSqm(s: string | null): number | null {
  if (!s) return null
  // 「租金单价4元/㎡/天,含物业费」说的是租金，不是物业费
  if (/租金/.test(s)) return null
  // 也有不写「元」的：「10.5平方/月」「35㎡/月」「24/㎡/月」
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(?:元|\/|／|㎡|平)/)
  if (!m) return null
  const v = Number(m[1])
  if (/天/.test(s) && !/月/.test(s)) return v > 3 ? v : null
  return v
}

/** 「400㎡，使用率约70%，可容纳工位40~80个」→ 70；全量里多数写成「使用率约80」不带 % */
export function parseEfficiency(s: string | null): number | null {
  const m = s?.match(/使用率约?\s*(\d+(?:\.\d+)?)\s*%?/)
  if (!m) return null
  const v = Number(m[1])
  return v > 0 && v <= 100 ? v : null
}

/** 「40~80」「40-80个工位」→ {40, 80}；单值「50」→ {50, 50}。 */
export function parseSeatRange(s: string | null): {
  min: number | null
  max: number | null
} {
  if (!s) return { min: null, max: null }
  const range = s.match(/(\d+)\s*[~～\-－至到]\s*(\d+)/)
  if (range) return { min: Number(range[1]), max: Number(range[2]) }
  const one = s.match(/(\d+)/)
  return one ? { min: Number(one[1]), max: Number(one[1]) } : { min: null, max: null }
}

/** 「押3付1」→ 3；「押二付三」→ 2。 */
export function parseDepositMonths(s: string | null): number | null {
  const m = s?.match(/押\s*([0-9一二三四五六七八九十]+)/)
  if (!m) return null
  const cn: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  }
  return /^\d+$/.test(m[1]) ? Number(m[1]) : (cn[m[1]] ?? null)
}

/** 「24个月」→ 24；「2年」→ 24；「面议」→ null。 */
export function parseLeaseMonths(s: string | null): number | null {
  if (!s) return null
  const y = s.match(/(\d+(?:\.\d+)?)\s*年/)
  if (y) return Math.round(Number(y[1]) * 12)
  const mo = s.match(/(\d+)\s*个?月/)
  return mo ? Number(mo[1]) : null
}

export function parseYesNo(s: string | null): boolean | null {
  if (!s) return null
  if (/^(是|可以|可)$/.test(s)) return true
  if (/^(否|不可以|不可)$/.test(s)) return false
  return null
}

export function parseDivisible(s: string | null): boolean | null {
  if (!s) return null
  if (/不可(以)?分割/.test(s)) return false
  if (/可(以)?分割/.test(s)) return true
  return null
}

export function mapDecoration(raw: string | null): DecorationStatus | null {
  if (!raw) return null
  return DECORATION_MAP[raw.replace(/\s+/g, '')] ?? null
}

export function mapFloorZone(raw: string | null): string | null {
  if (!raw) return null
  return FLOOR_ZONE[raw] ?? raw
}

// ---------------------------------------------------------------------------
// 页面级解析
// ---------------------------------------------------------------------------

export type ParseIssue = Readonly<{
  kind: 'building' | 'listing'
  id: string
  field: string
  raw: string | null
  note: string
}>

/** 解析器只产出页面事实；slug（要拼音库）与挂靠决定（要人确认）由 build-dataset 补齐。 */
export type ParsedBuilding = Omit<HuizuBuildingRow, 'slug' | 'attachToBuildingId'>
export type ParsedListing = Omit<HuizuListingRow, 'slug'>

export type BuildingExtras = Readonly<{
  /** 对方区 id（对照表换算不了时留档） */
  siteDistrictId: number | null
  /** 页头「N 个在租房源」，用于与枚举数对账 */
  claimedListingCount: number | null
}>

/** 楼盘页 require 配置里内嵌的图集 JSON。 */
export function parseBuildingPics(html: string): string[] {
  const m = html.match(/"buildingPicImages":(\[[\s\S]*?\])\s*[,}]/)
  if (!m) return []
  let arr: unknown
  try {
    arr = JSON.parse(m[1])
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: string[] = []
  for (const pic of arr) {
    const raw = typeof pic === 'object' && pic !== null ? (pic as { pic_url?: unknown }).pic_url : null
    const url = typeof raw === 'string' ? raw.trim() : ''
    const abs = /^https?:\/\//.test(url)
      ? url
      : url.startsWith('//')
        ? `https:${url}`
        : url.startsWith('/')
          ? `${BASE}${url}`
          : null
    if (abs && !out.includes(abs)) out.push(abs)
  }
  return out
}

export function parseBuildingPage(
  html: string,
  id: string,
): { row: ParsedBuilding; extras: BuildingExtras; issues: ParseIssue[] } {
  const issues: ParseIssue[] = []
  const issue = (field: string, raw: string | null, note: string) =>
    issues.push({ kind: 'building', id, field, raw, note })
  const kv = labelValues(html)
  const get = (label: string) => kv.get(label) ?? null

  const name = get('大厦名称') ?? hidden(html, 'id', 'loupan1')
  if (!name) issue('name', null, '缺大厦名称')

  const { siteDistrictId, businessAreaName } = parseLocation(html)
  const districtName = siteDistrictId !== null ? (SITE_DISTRICTS[siteDistrictId] ?? null) : null
  if (districtName === null)
    issue('district', siteDistrictId === null ? null : String(siteDistrictId), '区 id 换算不了')

  const lngRaw = hidden(html, 'name', 'map_lng')
  const latRaw = hidden(html, 'name', 'map_lat')
  let latitude: number | null = null
  let longitude: number | null = null
  const lng = lngRaw ? Number(lngRaw) : NaN
  const lat = latRaw ? Number(latRaw) : NaN
  // 上海大致范围；对方未填坐标时常给 0 或北京中心点
  if (Number.isFinite(lng) && Number.isFinite(lat) && lng > 120.8 && lng < 122.2 && lat > 30.6 && lat < 31.9) {
    const g = bd09ToGcj02(lng, lat)
    longitude = g.lng
    latitude = g.lat
  } else issue('coordinates', `${lngRaw},${latRaw}`, '坐标缺失或不在上海范围')

  const heightsRaw = get('层高')
  const heights = parseHeights(heightsRaw)
  const elevatorRaw = get('电梯数量')
  const acType = get('空调类型')
  const acHours = get('空调开放时间')
  const airConditioning = [acType, acHours ? `开放时间：${acHours}` : null].filter(Boolean).join('；') || null

  const introM = html.match(/<span class="text1 hide-more">([\s\S]*?)<\/span>/)
  const description = introM ? cleanText(introM[1]) : null

  const countM = html.match(/<i class="num">(\d+)<\/i>\s*个\s*<\/dt>\s*<dd>在租房源/)

  const completionRaw = get('竣工时间')
  const completionYear = parseYear(completionRaw)
  if (completionRaw && completionYear === null) issue('completionYear', completionRaw, '竣工时间解析不了')
  const floorsRaw = get('楼层层数')
  const totalFloors = parseAboveGroundFloors(floorsRaw)
  if (floorsRaw && totalFloors === null) issue('totalFloors', floorsRaw, '楼层层数解析不了')
  const feeRaw = get('物业费')
  const propertyFee = parseMonthlyFeePerSqm(feeRaw)
  if (feeRaw && firstNumber(feeRaw) !== null && propertyFee === null)
    issue('propertyFee', feeRaw, '物业费口径不是元/㎡/月')
  else if (feeRaw && propertyFee !== null && /天/.test(feeRaw) && !/月/.test(feeRaw))
    issue('propertyFee', feeRaw, '物业费写成「天」，按月计')

  const row: ParsedBuilding = {
    kind: 'building',
    externalId: id,
    sourceUrl: `${BASE}/loupan/l${id}`,
    name: name ?? '',
    districtName,
    businessAreaName,
    address: get('大厦地址') ?? hidden(html, 'name', 'map_address'),
    latitude,
    longitude,
    completionYear,
    totalFloors,
    grossFloorArea: firstNumber(get('建筑面积')),
    standardFloorHeight: heights.standard,
    netCeilingHeight: heights.net,
    passengerElevators: parsePassengerElevators(elevatorRaw),
    elevatorNote: elevatorRaw,
    airConditioning,
    network: get('网络'),
    propertyFee,
    parkingSpaces: firstNumber(get('停车位')),
    parkingFee: get('停车费'),
    // 对方不少楼盘把楼盘名填进了开发商，那不是开发商
    developer: get('开发商') !== name ? get('开发商') : null,
    propertyCompany: get('物业公司'),
    description,
    images: parseBuildingPics(html),
  }
  return {
    row,
    extras: {
      siteDistrictId,
      claimedListingCount: countM ? Number(countM[1]) : null,
    },
    issues,
  }
}

export function parseListingPage(
  html: string,
  id: string,
  buildingIdFromEnum: string,
): { row: ParsedListing; issues: ParseIssue[] } {
  const issues: ParseIssue[] = []
  const issue = (field: string, raw: string | null, note: string) =>
    issues.push({ kind: 'listing', id, field, raw, note })
  const kv = labelValues(html)
  const get = (label: string) => kv.get(label) ?? null

  // 页面里的所属楼盘以 hidden input 为准；与枚举不一致时记一笔（对方可能把房源挪过楼盘）
  const buildingExternalId = hidden(html, 'id', 'loupan') ?? buildingIdFromEnum
  if (buildingExternalId !== buildingIdFromEnum)
    issue('buildingExternalId', buildingExternalId, `与枚举的楼盘 ${buildingIdFromEnum} 不一致，以页面为准`)

  const areaM = html.match(/<i class="num">([\d.]+)㎡<\/i><\/dt>\s*<dd>建筑面积/)
  const areaInfo = get('面积信息')
  const area = areaM ? Number(areaM[1]) : firstNumber(areaInfo)
  if (!area) issue('area', areaInfo, '缺面积')

  const dailyRaw = get('日租金')
  const unitPriceM = html.match(/单价：\s*([\d.]+)\s*元/)
  const dailyRent = firstNumber(dailyRaw) ?? (unitPriceM ? Number(unitPriceM[1]) : null)
  if (dailyRent === null) issue('dailyRent', dailyRaw, '缺日租金')

  const seatHeadM = html.match(/<i class="num">([^<]+)<\/i>\s*个工位/)
  const seats = parseSeatRange(seatHeadM ? seatHeadM[1] : (areaInfo?.match(/工位([^个]+)个/)?.[1] ?? null))

  const decorationRaw = get('装修情况')
  const decorationStatus = mapDecoration(decorationRaw)
  if (decorationRaw && decorationStatus === null) issue('decorationStatus', decorationRaw, '装修原文不在对照表')

  const descM = html.match(/<span class="text1">([\s\S]*?)<\/span>/)
  // 对方标题写法不一（「X 400㎡ 精装修」「X 141平米办公室出租，精装修」），统一成 2026-08 那轮的
  //「楼盘名 面积㎡ 装修」；缺楼盘名时退回页面标题
  const buildingName = hidden(html, 'id', 'loupan1')
  const title =
    buildingName && area
      ? [buildingName, `${Math.round(area * 10) / 10}㎡`, decorationRaw].filter(Boolean).join(' ')
      : hidden(html, 'name', 'row[title]')
  if (!title) issue('title', null, '缺标题')

  const orientation = get('朝向')
  const row: ParsedListing = {
    kind: 'listing',
    externalId: id,
    buildingExternalId,
    sourceUrl: `${BASE}/loupan/l${buildingExternalId}-x${id}.html`,
    title: title ?? '',
    area: area ? Math.round(area * 10) / 10 : 0,
    dailyRent,
    decorationStatus,
    decorationRaw,
    registrable: parseYesNo(get('可注册')),
    floor: mapFloorZone(get('所在楼层')),
    orientation: orientation && orientation !== '暂无' ? orientation : null,
    efficiencyRate: parseEfficiency(areaInfo),
    seatMin: seats.min,
    seatMax: seats.max,
    isDivisible: parseDivisible(get('是否可分割')),
    paymentTerms: get('付款方式'),
    depositMonths: parseDepositMonths(get('付款方式')),
    minimumLeaseMonths: parseLeaseMonths(get('最短租期')),
    propertyFee: parseMonthlyFeePerSqm(get('物业费')),
    description: descM ? cleanText(descM[1]) : null,
  }
  return { row, issues }
}
