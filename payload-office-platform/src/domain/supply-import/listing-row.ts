/**
 * 房源行校验（OPT-041 Task 4）。
 *
 * 把运营填的一行原始表格数据校验成 `ValidListingRow`，或收集这一行的全部问题
 * 返回 `RowError[]`——不 early return，运营改一次表要能看到这一行的所有问题（规格）。
 *
 * 城市校验先于其它校验：`errors[0]` 固定是 `CITY_OUT_OF_SCOPE`（越权城市判为错误行，
 * 不是静默跳过）；`allowedCityIds === 'all'` 时跳过城市校验（管理员无城市上限）。
 */

import {
  LISTING_TYPE_LABELS,
  LISTING_TYPES,
  DECORATION_STATUS_LABELS,
  DECORATION_STATUSES,
  PROPERTY_RIGHT_YEARS,
  PROPERTY_RIGHT_YEARS_LABELS,
  type PropertyRightYears,
} from '@/domain/review/listing-fields'
import { parseArea, parseFloorNumber, parseRent, parseSalePrice } from '@/domain/supply-import/normalize'
import type { PricingPeriod, PricingUnit } from '@/domain/shared/money'
import { isBuildingCandidatePublic, resolveBuilding } from '@/domain/supply-import/resolve-refs'
import { resolveBuildingMerchant, resolveMerchantByName } from '@/domain/supply-import/resolve-merchant'
import type { RawRow, RowContext, RowError } from '@/domain/supply-import/types'

export type { RowContext } from '@/domain/supply-import/types'

/**
 * 房源模板列（OPT-041 九列 + OPT-045 新增六列）。
 *
 * 新列一律**追加在末尾**，理由同楼盘模板：旧表格按位置对应列头，中间插一列会让
 * 所有旧表格静默错位。
 *
 * **租金与售价至少填一个**——这是本次唯一改变的既有语义。OPT-041 时租金是硬必填，
 * 出售房源没有月租、改不出来，等于压根导不进（§2.4 的缺口三）。
 */
export const LISTING_COLUMNS: readonly string[] = [
  '房源编号',
  '房源标题',
  '房源类型',
  '楼盘编号或标识',
  '面积',
  '租金',
  '楼层',
  '装修',
  '可租日期',
  '供给商户',
  '售价',
  '产权年限',
  '满五唯一',
  '车位',
  '税费承担',
]

export interface ValidListingRow {
  externalId: string
  title: string
  listingType: string
  buildingId: number | string
  cityId: number | string | null
  area: number
  /**
   * 旧版租金字段。**只有租赁行有值**：出售行没有月租，这两个字段留 null。
   * 保留它们是因为 `rentUnit` 仍是 C 端价格单位筛选的查询路径
   *（`supply-adapter.ts` 的 `where.rentUnit`），且楼盘聚合的 rentRanges 还在消费。
   */
  rentAmount: number | null
  rentUnit: string | null
  /**
   * 结构化价格四件套里的三件（currency 固定 CNY，由写入层补）。
   * 租赁行与出售行都有值——这是前台价格展示、排序、筛选的真实来源。
   *
   * `period` / `unit` 用字面量联合而不是 string：这两个取值域与
   * `Listings.price` 的枚举一一对应，写宽了会让「拼错一个单位」直到落库才炸。
   */
  price: { amount: number; period: PricingPeriod; unit: PricingUnit }
  /** 'lease' | 'sale'，由填的是租金还是售价推出。 */
  businessType: 'lease' | 'sale'
  floor: number | null
  decorationStatus: string | null
  availableFrom: string | null
  /** 模板「供给商户」列解析出的 id；留空则走「楼盘关系 → 平台自营回落」。 */
  merchantId: number | string | null
  saleTerms: {
    propertyRightYears: PropertyRightYears | null
    saleTaxBearer: SaleTaxBearer | null
    saleFiveYearsUnique: boolean | null
    saleParkingSpaces: number | null
  } | null
}

/**
 * 租赁单位 → 结构化价格的 period / unit。
 *
 * 依据 `public-catalog/mappers.ts` 的 `LEGACY_PRICE` 表：
 *   `rmb-sqm-day` → (day, sqm)、`rmb-month` → (month, total)、
 *   `rmb-seat-month` → (month, seat)
 * 其中 basis `total` 对应 `PricingUnit` 的 `suite`（同文件 `'suite' ? 'total'` 映射）。
 * 这张表必须与那边保持一致，漂了会让同一条房源在列表页与详情页显示不同单位。
 */
const LEASE_PRICE_BY_UNIT: Record<string, { period: PricingPeriod; unit: PricingUnit }> = {
  'rmb-sqm-day': { period: 'day', unit: 'sqm' },
  'rmb-month': { period: 'month', unit: 'suite' },
  'rmb-seat-month': { period: 'month', unit: 'seat' },
}

/** 税费承担方枚举，与 Listings.saleTerms.saleTaxBearer 的取值域一一对应。 */
export type SaleTaxBearer = 'buyer' | 'seller' | 'split' | 'negotiable'

/** 税费承担方中文标签 → 枚举。 */
const SALE_TAX_BEARER_BY_LABEL = new Map<string, SaleTaxBearer>([
  ['买方承担', 'buyer'],
  ['卖方承担', 'seller'],
  ['双方各半', 'split'],
  ['面议', 'negotiable'],
])

/** 是/否 → boolean；识别不了返回 undefined（判错误行，不默认成 false）。 */
function parseYesNo(text: string): boolean | undefined {
  if (/^(是|y|yes|true|1)$/i.test(text)) return true
  if (/^(否|n|no|false|0)$/i.test(text)) return false
  return undefined
}

export type ValidateListingRowResult =
  | { ok: true; value: ValidListingRow }
  | { ok: false; errors: RowError[] }

/** label → value 映射，建一次即可复用；不在导入层重开一份取值域。 */
function buildLabelToValue(values: readonly string[], labels: Record<string, string>): Map<string, string> {
  return new Map(values.map((value) => [labels[value], value]))
}

const LISTING_TYPE_BY_LABEL = buildLabelToValue(LISTING_TYPES, LISTING_TYPE_LABELS)
const DECORATION_STATUS_BY_LABEL = buildLabelToValue(DECORATION_STATUSES, DECORATION_STATUS_LABELS)

function enumUnknownMessage(fieldLabel: string, rawValue: string, validLabels: readonly string[]): string {
  return `${fieldLabel}「${rawValue}」不是合法取值，合法取值为：${validLabels.join('、')}`
}

const AVAILABLE_FROM_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function validateListingRow(row: RawRow, rowNumber: number, ctx: RowContext): ValidateListingRowResult {
  const errors: RowError[] = []

  // --- 楼盘 + 城市校验（必须最先做，越权城市要成为 errors[0]） ---
  const buildingText = String(row['楼盘编号或标识'] ?? '').trim()
  let buildingId: number | string | null = null
  let cityId: number | string | null = null

  if (buildingText === '') {
    errors.push({
      rowNumber,
      column: '楼盘编号或标识',
      rawValue: buildingText,
      code: 'REQUIRED',
      message: '楼盘编号或标识不能为空',
    })
  } else {
    const resolved = resolveBuilding(buildingText, ctx.buildings)
    if (!resolved.ok) {
      errors.push({
        rowNumber,
        column: '楼盘编号或标识',
        rawValue: buildingText,
        code: resolved.code,
        message: resolved.message,
        ...(resolved.suggestion !== undefined ? { suggestion: resolved.suggestion } : {}),
      })
    } else {
      buildingId = resolved.value.id
      cityId = resolved.value.cityId
      if (ctx.allowedCityIds !== 'all' && (cityId === null || !ctx.allowedCityIds.has(cityId))) {
        errors.push({
          rowNumber,
          column: '楼盘编号或标识',
          rawValue: buildingText,
          code: 'CITY_OUT_OF_SCOPE',
          message: `楼盘「${resolved.value.name}」所属城市不在你的可导入范围内`,
        })
      }

      // 最终评审 Critical 2：§7 有效供给要求楼盘 status=published、operationalStatus=active、
      // 未软删，且所属城市/行政区都是 active（domain/supply/public-building.ts）。导入链路此前
      // 一条都没查，会命中草稿/已归档/已停用/回收站中的楼盘或所属区域已停用的楼盘——房源随后
      // published，但前台按 §7 过滤后 404。判定复用 isBuildingCandidatePublic（= 复用
      // isPublicBuildingLike，不在导入层重写第 6 份 §7）。message 要指明是楼盘/区域不可见，
      // 不是房源本身的问题——口径对齐下面 D10 商户校验的写法。
      if (!isBuildingCandidatePublic(resolved.value)) {
        errors.push({
          rowNumber,
          column: '楼盘编号或标识',
          rawValue: buildingText,
          code: 'BUILDING_NOT_VISIBLE',
          message: `楼盘「${resolved.value.name}」当前不是有效供给（已下架/停用/回收站中，或所属城市、行政区已停用），不是房源本身的问题；请先在楼盘管理中恢复其可见状态后再导入`,
        })
      }

      // D10：房源模板没有商户列，供给商户唯一来源是楼盘当前生效的商户关系。
      // 校验前移到预检层——楼盘没有生效商户、或商户不合格，这里就判错误行，
      // 不等写入层才失败（否则同批其它行都上架了才发现这行不行，是最坏的失败时机）。
      // OPT-045：三级解析的后两级。第一级（模板「供给商户」列）在下面单独处理——
      // 那一列填了就直接用，压根不查楼盘关系。这里只在它留空时才需要判定，
      // 但校验必须无条件跑：留空是常态，报错要在预检阶段出现，不能等写入层。
      const fallbackId = ctx.platformDefaultMerchantByCity?.get(String(resolved.value.cityId))
      const merchantResolution = resolveBuildingMerchant(
        resolved.value.name,
        resolved.value.id,
        resolved.value.cityId,
        ctx.buildingMerchantRelations,
        ctx.now,
        ctx.platformDefaultMerchantByCity === undefined
          ? undefined
          : { merchantId: fallbackId ?? null, cityLabel: null },
      )
      // 模板填了商户列时，楼盘关系的解析结果不影响这一行——那一列优先级最高。
      // 判定仍然跑了一遍（上面），但只在留空时才把错误计入。
      const merchantColumnFilled = String(row['供给商户'] ?? '').trim() !== ''
      if (!merchantColumnFilled && !merchantResolution.ok) {
        errors.push({
          rowNumber,
          column: '楼盘编号或标识',
          rawValue: buildingText,
          code: merchantResolution.code,
          message: merchantResolution.message,
        })
      }
    }
  }

  // --- 编号 ---
  const externalId = String(row['房源编号'] ?? '').trim()
  if (externalId === '') {
    errors.push({
      rowNumber,
      column: '房源编号',
      rawValue: String(row['房源编号'] ?? ''),
      code: 'REQUIRED',
      message: '房源编号不能为空',
    })
  }

  // --- 标题 ---
  const title = String(row['房源标题'] ?? '').trim()
  if (title === '') {
    errors.push({
      rowNumber,
      column: '房源标题',
      rawValue: String(row['房源标题'] ?? ''),
      code: 'REQUIRED',
      message: '房源标题不能为空',
    })
  }

  // --- 房源类型 ---
  const listingTypeRaw = String(row['房源类型'] ?? '').trim()
  let listingType: string | null = null
  if (listingTypeRaw === '') {
    errors.push({
      rowNumber,
      column: '房源类型',
      rawValue: listingTypeRaw,
      code: 'REQUIRED',
      message: '房源类型不能为空',
    })
  } else {
    const mapped = LISTING_TYPE_BY_LABEL.get(listingTypeRaw)
    if (mapped === undefined) {
      errors.push({
        rowNumber,
        column: '房源类型',
        rawValue: listingTypeRaw,
        code: 'ENUM_UNKNOWN',
        message: enumUnknownMessage('房源类型', listingTypeRaw, LISTING_TYPES.map((v) => LISTING_TYPE_LABELS[v])),
      })
    } else {
      listingType = mapped
    }
  }

  // --- 面积 ---
  const areaRaw = String(row['面积'] ?? '')
  const area = parseArea(areaRaw)
  if (area === null) {
    errors.push({
      rowNumber,
      column: '面积',
      rawValue: areaRaw,
      code: 'AREA_INVALID',
      message: '面积必须是大于 0 的数值',
    })
  }

  // --- 租金 ---
  // parseRent 还会识别「80万」这类总价写法，产出 unit:'rmb-total'——但 Listings
  // 集合落库的旧版 rentUnit 字段只有元/㎡/天、元/月、元/工位/月三个取值（真实取值域
  // 见 domain/supply-import/import-task.ts 的 isLegacyRentUnit），rmb-total 传下去
  // 必炸。评审 Task 7 第 1 轮 Important 3：这类行必须在预检层就判为错误行，不能让
  // 运营点了执行、同批其它行都上架了才在写入层爆——那是最坏的失败时机。
  const rentRaw = String(row['租金'] ?? '').trim()
  const salePriceRaw = String(row['售价'] ?? '').trim()

  let rentAmount: number | null = null
  let rentUnit: string | null = null
  let price: { amount: number; period: PricingPeriod; unit: PricingUnit } | null = null
  let businessType: 'lease' | 'sale' = 'lease'

  if (rentRaw === '' && salePriceRaw === '') {
    // OPT-045：租金不再是硬必填，但两列不能都空——没有价格的房源无法定价展示。
    errors.push({
      rowNumber,
      column: '租金',
      rawValue: '',
      code: 'PRICE_REQUIRED',
      message: '租金与售价至少填一个：出租房源填「租金」（如「4.5元/㎡/天」），出售房源填「售价」（如「800万」或「5.2万元/㎡」）',
    })
  } else if (rentRaw !== '' && salePriceRaw !== '') {
    // 两列都填 → 判错误行而不是挑一个。listings.businessType 是单值，
    // 一条房源要么租要么售；静默挑一个会让另一半价格凭空消失，且完全没有信号。
    errors.push({
      rowNumber,
      column: '售价',
      rawValue: salePriceRaw,
      code: 'PRICE_AMBIGUOUS',
      message: '租金与售价只能填一个——一条房源要么出租要么出售。既租又售请拆成两行（房源编号也要不同）',
    })
  } else if (rentRaw !== '') {
    const rent = parseRent(rentRaw)
    if (rent === null) {
      errors.push({
        rowNumber,
        column: '租金',
        rawValue: rentRaw,
        code: 'RENT_UNIT_UNKNOWN',
        message: '租金单位无法识别，请填写如「4.5元/㎡/天」「8000元/月」「1500元/工位/月」这类带单位的写法',
      })
    } else if (rent.unit === 'rmb-total') {
      // 总价写法进了租金列：现在有出路了，指向「售价」列而不是让运营改写法。
      errors.push({
        rowNumber,
        column: '租金',
        rawValue: rentRaw,
        code: 'RENT_UNIT_UNSUPPORTED',
        message: '租金列不支持总价写法（如「80万」）。出售房源请把总价填到「售价」列；出租房源请改用元/㎡/天、元/月或元/工位/月',
      })
    } else {
      const mapped = LEASE_PRICE_BY_UNIT[rent.unit]
      if (mapped === undefined) {
        errors.push({
          rowNumber,
          column: '租金',
          rawValue: rentRaw,
          code: 'RENT_UNIT_UNSUPPORTED',
          message: `租金单位「${rent.unit}」暂不支持导入`,
        })
      } else {
        rentAmount = rent.amount
        rentUnit = rent.unit
        price = { amount: rent.amount, period: mapped.period, unit: mapped.unit }
        businessType = 'lease'
      }
    }
  } else {
    const sale = parseSalePrice(salePriceRaw)
    if (sale === null) {
      errors.push({
        rowNumber,
        column: '售价',
        rawValue: salePriceRaw,
        code: 'SALE_PRICE_INVALID',
        message: '售价无法识别。总价写「800万」或「8000000」，单价写「5.2万元/㎡」或「52000元/㎡」；不接受区间写法',
      })
    } else {
      price = sale
      businessType = 'sale'
    }
  }

  // --- 楼层（可留空） ---
  const floorRaw = String(row['楼层'] ?? '').trim()
  let floor: number | null = null
  if (floorRaw !== '') {
    floor = parseFloorNumber(floorRaw)
    if (floor === null) {
      errors.push({
        rowNumber,
        column: '楼层',
        rawValue: floorRaw,
        code: 'FLOOR_INVALID',
        message: '楼层格式无法识别，支持如「12层」「12F」「B2」「负2层」',
      })
    }
  }

  // --- 装修（可留空） ---
  const decorationRaw = String(row['装修'] ?? '').trim()
  let decorationStatus: string | null = null
  if (decorationRaw !== '') {
    const mapped = DECORATION_STATUS_BY_LABEL.get(decorationRaw)
    if (mapped === undefined) {
      errors.push({
        rowNumber,
        column: '装修',
        rawValue: decorationRaw,
        code: 'ENUM_UNKNOWN',
        message: enumUnknownMessage(
          '装修',
          decorationRaw,
          DECORATION_STATUSES.map((v) => DECORATION_STATUS_LABELS[v]),
        ),
      })
    } else {
      decorationStatus = mapped
    }
  }

  // --- 可租日期（可留空，只接受 YYYY-MM-DD） ---
  const availableFromRaw = String(row['可租日期'] ?? '').trim()
  let availableFrom: string | null = null
  if (availableFromRaw !== '') {
    if (!AVAILABLE_FROM_PATTERN.test(availableFromRaw)) {
      errors.push({
        rowNumber,
        column: '可租日期',
        rawValue: availableFromRaw,
        code: 'DATE_INVALID',
        message: '可租日期格式必须是 YYYY-MM-DD，例如 2026-09-01',
      })
    } else {
      availableFrom = availableFromRaw
    }
  }

  // --- 供给商户（留空合法：留空走「楼盘关系 → 平台自营回落」两级自动解析）---
  const merchantText = String(row['供给商户'] ?? '').trim()
  let merchantId: number | string | null = null
  if (merchantText !== '') {
    const resolved = resolveMerchantByName(merchantText, ctx.merchants, cityId, ctx.now)
    if (!resolved.ok) {
      errors.push({
        rowNumber,
        column: '供给商户',
        rawValue: merchantText,
        code: resolved.code,
        message: resolved.message,
      })
    } else {
      merchantId = resolved.merchantId
    }
  }

  // --- 出售条款四项（D5）：全部可留空，且**只在出售行有意义** ---
  //
  // 填在租赁行上判错误行而不是静默忽略：`saleTerms` 在后台表单上受
  // `businessType === 'sale'` 的 condition 控制，租赁行填了也永远看不到，
  // 静默吞掉会让运营以为填进去了。
  const propertyRightYearsRaw = String(row['产权年限'] ?? '').trim()
  const saleTaxBearerRaw = String(row['税费承担'] ?? '').trim()
  const fiveYearsRaw = String(row['满五唯一'] ?? '').trim()
  const parkingRaw = String(row['车位'] ?? '').trim()
  const anySaleTerm =
    propertyRightYearsRaw !== '' ||
    saleTaxBearerRaw !== '' ||
    fiveYearsRaw !== '' ||
    parkingRaw !== ''

  let saleTerms: ValidListingRow['saleTerms'] = null
  if (anySaleTerm && businessType !== 'sale') {
    errors.push({
      rowNumber,
      column: '产权年限',
      rawValue: propertyRightYearsRaw,
      code: 'SALE_TERMS_ON_LEASE_ROW',
      message: '产权年限 / 满五唯一 / 车位 / 税费承担只对出售房源有效，请先在「售价」列填写售价，或清空这几列',
    })
  } else if (anySaleTerm) {
    let propertyRightYears: PropertyRightYears | null = null
    if (propertyRightYearsRaw !== '') {
      const normalized = propertyRightYearsRaw.replace(/\s|年/g, '')
      if (!(PROPERTY_RIGHT_YEARS as readonly string[]).includes(normalized)) {
        errors.push({
          rowNumber,
          column: '产权年限',
          rawValue: propertyRightYearsRaw,
          code: 'ENUM_UNKNOWN',
          message: enumUnknownMessage(
            '产权年限',
            propertyRightYearsRaw,
            PROPERTY_RIGHT_YEARS.map((v) => PROPERTY_RIGHT_YEARS_LABELS[v]),
          ),
        })
      } else {
        propertyRightYears = normalized as PropertyRightYears
      }
    }

    let saleTaxBearer: SaleTaxBearer | null = null
    if (saleTaxBearerRaw !== '') {
      const mapped = SALE_TAX_BEARER_BY_LABEL.get(saleTaxBearerRaw)
      if (mapped === undefined) {
        errors.push({
          rowNumber,
          column: '税费承担',
          rawValue: saleTaxBearerRaw,
          code: 'ENUM_UNKNOWN',
          message: enumUnknownMessage('税费承担', saleTaxBearerRaw, [...SALE_TAX_BEARER_BY_LABEL.keys()]),
        })
      } else {
        saleTaxBearer = mapped
      }
    }

    let saleFiveYearsUnique: boolean | null = null
    if (fiveYearsRaw !== '') {
      const parsed = parseYesNo(fiveYearsRaw)
      if (parsed === undefined) {
        errors.push({
          rowNumber,
          column: '满五唯一',
          rawValue: fiveYearsRaw,
          code: 'BOOLEAN_INVALID',
          message: '满五唯一请填「是」或「否」',
        })
      } else {
        saleFiveYearsUnique = parsed
      }
    }

    let saleParkingSpaces: number | null = null
    if (parkingRaw !== '') {
      const parsed = Number(parkingRaw.replace(/[^\d.-]/g, ''))
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        errors.push({
          rowNumber,
          column: '车位',
          rawValue: parkingRaw,
          code: 'PARKING_INVALID',
          message: '车位必须是 0 或正整数',
        })
      } else {
        saleParkingSpaces = parsed
      }
    }

    saleTerms = { propertyRightYears, saleTaxBearer, saleFiveYearsUnique, saleParkingSpaces }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      externalId,
      title,
      // 到这里 listingType / buildingId / area / price 均已通过校验，非空断言由上面的
      // errors.length === 0 保证
      listingType: listingType as string,
      buildingId: buildingId as number | string,
      cityId,
      area: area as number,
      rentAmount,
      rentUnit,
      price: price as { amount: number; period: PricingPeriod; unit: PricingUnit },
      businessType,
      floor,
      decorationStatus,
      availableFrom,
      merchantId,
      saleTerms,
    },
  }
}
