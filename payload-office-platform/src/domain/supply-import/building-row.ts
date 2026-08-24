/**
 * 楼盘行校验（OPT-041 Task 4）。
 *
 * 把运营填的一行原始表格数据校验成 `ValidBuildingRow`，或收集这一行的全部问题
 * 返回 `RowError[]`——不 early return。城市校验先于其它校验：`errors[0]` 固定是
 * `CITY_OUT_OF_SCOPE`（越权城市判为错误行，不是静默跳过）；`allowedCityIds === 'all'`
 * 时跳过城市校验（管理员无城市上限）。
 */

import { BUILDING_GRADE_LABELS, type BuildingGrade } from '@/components/frontend/building-grade'
import { parseArea, parseFloorNumber, parseUnitPrice } from '@/domain/supply-import/normalize'
import { resolveLocation } from '@/domain/supply-import/resolve-refs'
import { resolveMerchantByName } from '@/domain/supply-import/resolve-merchant'
import type { RawRow, RowContext, RowError } from '@/domain/supply-import/types'

export type { RowContext } from '@/domain/supply-import/types'

/**
 * 楼盘模板列（OPT-041 八列 + OPT-045 新增五列）。
 *
 * 这是**下载模板时输出的完整列**。解析上传文件时只要求
 * `REQUIRED_BUILDING_COLUMNS`（原八列）——见那里的注释。
 *
 * 新增列全部可留空。留空的后果各不相同：「供给商户」留空只是不建关系
 *（房源侧还有平台自营回落兜底）；「等级/竣工年份/最近地铁」留空则该楼盘在对应
 * 筛选维度下不出现（OPT-045 §2.3 的缺口二，症状是「怎么筛不到」而不是 404，
 * 比 404 更难被当成缺陷报上来）。
 */
export const BUILDING_COLUMNS: readonly string[] = [
  '楼盘编号',
  '楼盘名称',
  '城市',
  '行政区',
  '商圈',
  '地址',
  '总楼层',
  '总建筑面积',
  '供给商户',
  '等级',
  '竣工年份',
  '最近地铁',
  '在售单价',
]

/**
 * 解析上传文件时**必需**的列 —— 只有 OPT-041 的原八列。
 *
 * ## 为什么必须与模板列分开
 *
 * `parseWorkbook` 对期望列做的是「一个都不能少」的硬校验（缺任何一列直接
 * `MISSING_COLUMNS` 拒收整个文件）。如果把 OPT-045 新增的五列也算必需，
 * **运营手上所有已有的八列表格会在下一次导入时全部被拒**——而那些表格本身
 * 完全合法，只是生成时还没有这几列。
 *
 * 实测教训：本工作项最初直接往 BUILDING_COLUMNS 加列，e2e 的
 * `bulk-import.spec` 立刻红了（夹具就是一份旧格式表）。当时代码注释、提交信息、
 * 单测里都写着「旧表格原样继续可用」——**那是没验证过的断言**，靠 e2e 才发现。
 *
 * 新列不在这里 = 文件里有就读、没有就当留空，这才是真正的向后兼容。
 */
export const REQUIRED_BUILDING_COLUMNS: readonly string[] = [
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
  /** 供给商户 id；非空时写入层要建一条 building-merchant-relations（effectiveFrom = 导入时点）。 */
  merchantId: number | string | null
  grade: BuildingGrade | null
  /** 竣工时间，落 `buildings.completion_date`；模板填年份，这里归一成该年 1 月 1 日。 */
  completionDate: string | null
  nearestMetroId: number | string | null
  /** 在售单价（元/㎡，D1 单值）。 */
  saleUnitPrice: number | null
}

/** 等级中文标签 → 枚举值，与「装修」列同一套 label→value 口径。 */
const GRADE_BY_LABEL = new Map<string, BuildingGrade>(
  (Object.keys(BUILDING_GRADE_LABELS) as BuildingGrade[]).map((value) => [
    BUILDING_GRADE_LABELS[value],
    value,
  ]),
)

/**
 * 竣工年份：只接受四位年份。
 *
 * 不接受「2010年建成」这类自由文本——`buildings.completion_date` 是 date 列，
 * 猜错年份的代价是竣工年代筛选把楼盘归错档，而这类错误在前台完全没有信号。
 * 上限取「当年 +5」：在建楼盘填未来竣工年是正常业务，但填 2099 多半是手滑。
 */
const COMPLETION_YEAR_MIN = 1900

function parseCompletionYear(text: string, now: Date): number | null {
  if (!/^\d{4}$/.test(text)) return null
  const year = Number(text)
  if (year < COMPLETION_YEAR_MIN || year > now.getUTCFullYear() + 5) return null
  return year
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
      // 最终评审 Critical 2：§7 要求城市 status=active，导入的楼盘挂在已停用城市下
      // 会造成"楼盘 published 但前台按 §7 过滤后 404"——判定必须在预检层拦住，
      // 不能等房源导入时才发现。
      if (resolved.value.status !== 'active') {
        errors.push({
          rowNumber,
          column: '城市',
          rawValue: cityText,
          code: 'CITY_NOT_ACTIVE',
          message: `城市「${resolved.value.name}」已停用，其下楼盘不会出现在前台，请先启用该城市或改选其它城市`,
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
      // 最终评审 Critical 2：§7 要求行政区 status=active，同城市校验同一理由。
      if (resolved.value.status !== 'active') {
        errors.push({
          rowNumber,
          column: '行政区',
          rawValue: districtText,
          code: 'DISTRICT_NOT_ACTIVE',
          message: `行政区「${resolved.value.name}」已停用，其下楼盘不会出现在前台，请先启用该行政区或改选其它行政区`,
        })
      }
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

  // --- 供给商户（留空合法；填了就按名称解析并做 §9/§10 判定，OPT-045）---
  //
  // 留空不是错误：房源侧还有「楼盘关系 → 平台自营回落」两级兜底。这一列存在的
  // 意义是让运营在导入时就把楼盘挂到指定商户下，省掉事后一楼盘一条手工补关系
  //（实测三个楼盘约 18 次点击，且那个集合当时还不在导航里）。
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

  // --- 等级（留空合法；中文标签 → 枚举，与「装修」同一套口径）---
  const gradeText = String(row['等级'] ?? '').trim()
  let grade: BuildingGrade | null = null
  if (gradeText !== '') {
    const mapped = GRADE_BY_LABEL.get(gradeText)
    if (mapped === undefined) {
      errors.push({
        rowNumber,
        column: '等级',
        rawValue: gradeText,
        code: 'ENUM_UNKNOWN',
        message: `等级「${gradeText}」不是合法取值，合法取值为：${[...GRADE_BY_LABEL.keys()].join('、')}`,
      })
    } else {
      grade = mapped
    }
  }

  // --- 竣工年份（留空合法；只接受四位年份，落库归一成该年 1 月 1 日）---
  const completionText = String(row['竣工年份'] ?? '').trim()
  let completionDate: string | null = null
  if (completionText !== '') {
    const year = parseCompletionYear(completionText, ctx.now)
    if (year === null) {
      errors.push({
        rowNumber,
        column: '竣工年份',
        rawValue: completionText,
        code: 'COMPLETION_YEAR_INVALID',
        message: `竣工年份必须是 ${COMPLETION_YEAR_MIN} 至 ${ctx.now.getUTCFullYear() + 5} 之间的四位年份，例如「2010」`,
      })
    } else {
      // 用 UTC 构造，避免本地时区把 1 月 1 日推到上一年 12 月 31 日——
      // 竣工年代筛选按年份分档，差一天就可能归错档。
      completionDate = new Date(Date.UTC(year, 0, 1)).toISOString()
    }
  }

  // --- 最近地铁（留空合法；走 resolveLocation 的 metro_station 解析）---
  const metroText = String(row['最近地铁'] ?? '').trim()
  let nearestMetroId: number | string | null = null
  if (metroText !== '') {
    const resolved = resolveLocation({ kind: 'metro_station', text: metroText }, ctx.tables)
    if (!resolved.ok) {
      errors.push({
        rowNumber,
        column: '最近地铁',
        rawValue: metroText,
        code: resolved.code,
        message: resolved.message,
        ...(resolved.suggestion !== undefined ? { suggestion: resolved.suggestion } : {}),
      })
    } else {
      nearestMetroId = resolved.value.id
    }
  }

  // --- 在售单价（留空合法；D1 单值，元/㎡）---
  const saleUnitPriceRaw = String(row['在售单价'] ?? '').trim()
  let saleUnitPrice: number | null = null
  if (saleUnitPriceRaw !== '') {
    const parsed = parseUnitPrice(saleUnitPriceRaw)
    if (parsed === null) {
      errors.push({
        rowNumber,
        column: '在售单价',
        rawValue: saleUnitPriceRaw,
        code: 'SALE_UNIT_PRICE_INVALID',
        message: '在售单价必须是大于 0 的数值，单位元/㎡，例如「52000」或「5.2万」',
      })
    } else {
      saleUnitPrice = parsed
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
      merchantId,
      grade,
      completionDate,
      nearestMetroId,
      saleUnitPrice,
    },
  }
}
