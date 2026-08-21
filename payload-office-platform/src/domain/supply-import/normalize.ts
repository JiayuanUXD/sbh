/**
 * 批量导入的文本规范化层（OPT-041 规格 §4.2）
 *
 * 全部纯函数，不依赖 payload / React。规范化的目标是把"人填的写法"收敛成
 * "可等值匹配的值"，**不做任何猜测性替换**——猜测归 resolve-refs 的候选建议。
 */

import { normalizeBuildingName } from '@/domain/supply/building-dedup'

/** 全角 ASCII（U+FF01–U+FF5E）→ 半角；全角空格 U+3000 单独处理。 */
function toHalfWidth(value: string): string {
  return value
    .replace(/　/g, ' ')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
}

/**
 * 通用别名规范化：与 normalizeBuildingName 同口径（全半角 + 折叠空白 + 小写）。
 * 直接复用既有实现，避免两份规范化规则漂移。
 */
export function normalizeAliasText(value: unknown): string {
  return normalizeBuildingName(value)
}

/** 城市名：规范化后剥离末尾的"市"（长度 > 1 才剥，"市"本身保留）。 */
export function normalizeCityName(value: unknown): string {
  const base = normalizeAliasText(value)
  if (base.length > 1 && base.endsWith('市')) return base.slice(0, -1)
  return base
}

/**
 * 行政区名：规范化后剥离城市前缀（"上海市黄浦区" → "黄浦区"）。
 * **不剥"区"后缀**——"浦东新区"剥成"浦东新"会匹配不到任何东西。
 */
export function normalizeDistrictName(value: unknown): string {
  const base = normalizeAliasText(value)
  // lookahead 保证后面还有内容才剥，避免把"上海市"本身剥成空串
  return base.replace(/^[一-龥]{2,4}市(?=.+)/, '')
}

/** 抽取字符串里的第一个数值（容忍千分位）。 */
function extractNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = toHalfWidth(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

/** 面积：必须为正数，单位（㎡ / 平米 / 平方米）可有可无。 */
export function parseArea(value: unknown): number | null {
  const num = extractNumber(value)
  if (num === null || num <= 0) return null
  return num
}

/**
 * 租金：**单位必须能识别**，识别不了返回 null。
 * 不给默认单位——"4.5"到底是元/㎡/天还是万元/月，猜错的代价是前台价格错一个数量级。
 * 取值域与 SUBMISSION_PRICE_UNITS 一致。
 */
export function parseRent(value: unknown): { amount: number; unit: string } | null {
  if (typeof value !== 'string') return null
  const text = toHalfWidth(value).replace(/\s/g, '')
  const num = extractNumber(text)
  if (num === null || num < 0) return null

  // 拦截：含"万"但不是纯总价写法时返回 null（避免 1.5万/月 被识成 1.5元/月）
  if (text.includes('万')) {
    const withoutComma = text.replace(/,/g, '')
    if (!/^-?\d+(\.\d+)?万元?$/.test(withoutComma)) {
      return null
    }
  }

  if (/\/㎡\/天|\/平米\/天|元\/平\/天/.test(text)) return { amount: num, unit: 'rmb-sqm-day' }
  if (/\/工位\/月|\/人\/月/.test(text)) return { amount: num, unit: 'rmb-seat-month' }
  if (/万$|万元$/.test(text)) return { amount: num * 10000, unit: 'rmb-total' }
  if (/\/月$/.test(text)) return { amount: num, unit: 'rmb-month' }
  return null
}

/** 楼层：`12层` / `12F` → 12；`B2` / `负2层` → -2；识别不了返回 null。 */
export function parseFloorNumber(value: unknown): number | null {
  if (typeof value !== 'string') return extractNumber(value)
  const text = toHalfWidth(value).replace(/\s/g, '').toUpperCase()
  const basement = text.match(/^B(\d+)/) ?? text.match(/^负(\d+)/)
  if (basement) return -Number(basement[1])
  if (!/^\d+(层|F|楼)?$/.test(text)) return null
  return extractNumber(text)
}
