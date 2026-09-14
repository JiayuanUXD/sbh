/**
 * 页脚 ICP 备案号（OPT-097）。
 *
 * 备案编号必须展示在网站底部并链接到工信部备案管理系统，所以这里不只是一段文案：
 * 后台字段 `validate` 与 C 端 `toView` 映射共用本函数，填错格式的号在保存时就被拒，
 * 不会挂到线上。校验故意宽松——只认「省份简称 + ICP备/证 + 数字 + 号（-序号）」这个骨架，
 * 不猜数字位数（老号 8 位、新号 10 位都见过）。
 *
 * 纯函数、零依赖：本文件会被 'use client' 组件间接引用，不能 import payload。
 */

/** 工信部备案管理系统首页。备案编号展示要求链接到这里，没有第二个合理值。 */
export const ICP_RECORD_URL = 'https://beian.miit.gov.cn/'

/**
 * 「沪ICP备2026037944号」「京ICP证030173号」「粤ICP备12345678号-1」都过；
 * 省份简称 1–3 个汉字，数字 6–12 位，可选 `-序号`。
 */
const ICP_RECORD_PATTERN = /^[\u4e00-\u9fa5]{1,3}ICP(备|证)\d{6,12}号(-\d{1,3})?$/

export function normalizeIcpRecordNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return ICP_RECORD_PATTERN.test(value) ? value : null
}

/** 后台字段校验用：留空合法，填了就必须能归一化。 */
export function isValidIcpRecordNumber(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true
  if (typeof raw === 'string' && raw.trim() === '') return true
  return normalizeIcpRecordNumber(raw) !== null
}
