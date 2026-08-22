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
} from '@/domain/review/listing-fields'
import { parseArea, parseFloorNumber, parseRent } from '@/domain/supply-import/normalize'
import { resolveBuilding } from '@/domain/supply-import/resolve-refs'
import type { RawRow, RowContext, RowError } from '@/domain/supply-import/types'

export type { RowContext } from '@/domain/supply-import/types'

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
]

export interface ValidListingRow {
  externalId: string
  title: string
  listingType: string
  buildingId: number | string
  cityId: number | string | null
  area: number
  rentAmount: number
  rentUnit: string
  floor: number | null
  decorationStatus: string | null
  availableFrom: string | null
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
  const rentRaw = String(row['租金'] ?? '')
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
    errors.push({
      rowNumber,
      column: '租金',
      rawValue: rentRaw,
      code: 'RENT_UNIT_UNSUPPORTED',
      message: '租金列不支持总价写法（如"80万"），请改用元/㎡/天、元/月或元/工位/月这三种单价写法',
    })
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

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      externalId,
      title,
      // 到这里 listingType / buildingId / area / rent 均已通过校验，非空断言由上面的
      // errors.length === 0 保证
      listingType: listingType as string,
      buildingId: buildingId as number | string,
      cityId,
      area: area as number,
      rentAmount: (rent as { amount: number; unit: string }).amount,
      rentUnit: (rent as { amount: number; unit: string }).unit,
      floor,
      decorationStatus,
      availableFrom,
    },
  }
}
