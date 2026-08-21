/**
 * 楼盘行校验（OPT-041 Task 4）。
 *
 * 把运营填的一行原始表格数据校验成 `ValidBuildingRow`，或收集这一行的全部问题
 * 返回 `RowError[]`——不 early return。城市校验先于其它校验：`errors[0]` 固定是
 * `CITY_OUT_OF_SCOPE`（越权城市判为错误行，不是静默跳过）；`allowedCityIds === 'all'`
 * 时跳过城市校验（管理员无城市上限）。
 */

import { parseArea, parseFloorNumber } from '@/domain/supply-import/normalize'
import { resolveLocation } from '@/domain/supply-import/resolve-refs'
import type { RawRow, RowContext, RowError } from '@/domain/supply-import/types'

export type { RowContext } from '@/domain/supply-import/types'

export const BUILDING_COLUMNS: readonly string[] = [
  '楼盘编号',
  '楼盘名称',
  '城市',
  '行政区',
  '商圈',
  '地址',
  '总楼层',
  '总建筑面积',
]

export interface ValidBuildingRow {
  externalId: string
  name: string
  cityId: number | string
  districtId: number | string
  businessAreaId: number | string | null
  address: string | null
  totalFloors: number | null
  grossFloorArea: number | null
}

export type ValidateBuildingRowResult =
  | { ok: true; value: ValidBuildingRow }
  | { ok: false; errors: RowError[] }

export function validateBuildingRow(row: RawRow, rowNumber: number, ctx: RowContext): ValidateBuildingRowResult {
  const errors: RowError[] = []

  // --- 城市校验（必须最先做，越权城市要成为 errors[0]） ---
  const cityText = String(row['城市'] ?? '').trim()
  let cityId: number | string | null = null

  if (cityText === '') {
    errors.push({
      rowNumber,
      column: '城市',
      rawValue: cityText,
      code: 'REQUIRED',
      message: '城市不能为空',
    })
  } else {
    const resolved = resolveLocation({ kind: 'city', text: cityText }, ctx.tables)
    if (!resolved.ok) {
      errors.push({
        rowNumber,
        column: '城市',
        rawValue: cityText,
        code: resolved.code,
        message: resolved.message,
        ...(resolved.suggestion !== undefined ? { suggestion: resolved.suggestion } : {}),
      })
    } else {
      cityId = resolved.value.id
      if (ctx.allowedCityIds !== 'all' && !ctx.allowedCityIds.has(cityId)) {
        errors.push({
          rowNumber,
          column: '城市',
          rawValue: cityText,
          code: 'CITY_OUT_OF_SCOPE',
          message: `城市「${resolved.value.name}」不在你的可导入范围内`,
        })
      }
    }
  }

  // --- 编号 ---
  const externalId = String(row['楼盘编号'] ?? '').trim()
  if (externalId === '') {
    errors.push({
      rowNumber,
      column: '楼盘编号',
      rawValue: String(row['楼盘编号'] ?? ''),
      code: 'REQUIRED',
      message: '楼盘编号不能为空',
    })
  }

  // --- 名称 ---
  const name = String(row['楼盘名称'] ?? '').trim()
  if (name === '') {
    errors.push({
      rowNumber,
      column: '楼盘名称',
      rawValue: String(row['楼盘名称'] ?? ''),
      code: 'REQUIRED',
      message: '楼盘名称不能为空',
    })
  }

  // --- 行政区（依赖城市已解析出的 cityId 做父级校验） ---
  const districtText = String(row['行政区'] ?? '').trim()
  let districtId: number | string | null = null
  if (districtText === '') {
    errors.push({
      rowNumber,
      column: '行政区',
      rawValue: districtText,
      code: 'REQUIRED',
      message: '行政区不能为空',
    })
  } else {
    const resolved = resolveLocation({ kind: 'district', text: districtText, parentId: cityId }, ctx.tables)
    if (!resolved.ok) {
      errors.push({
        rowNumber,
        column: '行政区',
        rawValue: districtText,
        code: resolved.code,
        message: resolved.message,
        ...(resolved.suggestion !== undefined ? { suggestion: resolved.suggestion } : {}),
      })
    } else {
      districtId = resolved.value.id
    }
  }

  // --- 商圈（留空合法，依赖 districtId 做父级校验） ---
  const businessAreaText = String(row['商圈'] ?? '').trim()
  let businessAreaId: number | string | null = null
  if (businessAreaText !== '') {
    const resolved = resolveLocation(
      { kind: 'business_area', text: businessAreaText, parentId: districtId },
      ctx.tables,
    )
    if (!resolved.ok) {
      errors.push({
        rowNumber,
        column: '商圈',
        rawValue: businessAreaText,
        code: resolved.code,
        message: resolved.message,
        ...(resolved.suggestion !== undefined ? { suggestion: resolved.suggestion } : {}),
      })
    } else {
      businessAreaId = resolved.value.id
    }
  }

  // --- 地址（留空合法，纯文本不校验格式） ---
  const addressText = String(row['地址'] ?? '').trim()
  const address = addressText === '' ? null : addressText

  // --- 总楼层（留空合法；复用 parseFloorNumber 识别"35层/35F"写法，负数视为无效） ---
  const totalFloorsRaw = String(row['总楼层'] ?? '').trim()
  let totalFloors: number | null = null
  if (totalFloorsRaw !== '') {
    const parsed = parseFloorNumber(totalFloorsRaw)
    if (parsed === null || parsed <= 0) {
      errors.push({
        rowNumber,
        column: '总楼层',
        rawValue: totalFloorsRaw,
        code: 'TOTAL_FLOORS_INVALID',
        message: '总楼层必须是大于 0 的整数，例如「35层」',
      })
    } else {
      totalFloors = parsed
    }
  }

  // --- 总建筑面积（留空合法；复用 parseArea） ---
  const grossFloorAreaRaw = String(row['总建筑面积'] ?? '').trim()
  let grossFloorArea: number | null = null
  if (grossFloorAreaRaw !== '') {
    const parsed = parseArea(grossFloorAreaRaw)
    if (parsed === null) {
      errors.push({
        rowNumber,
        column: '总建筑面积',
        rawValue: grossFloorAreaRaw,
        code: 'AREA_INVALID',
        message: '总建筑面积必须是大于 0 的数值',
      })
    } else {
      grossFloorArea = parsed
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      externalId,
      name,
      cityId: cityId as number | string,
      districtId: districtId as number | string,
      businessAreaId,
      address,
      totalFloors,
      grossFloorArea,
    },
  }
}
