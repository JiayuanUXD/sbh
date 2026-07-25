/**
 * 中国大陆手机号规范化与脱敏工具
 *
 * 业务不变量（AGENTS.md §5.6, §6）：
 *   - 手机号先规范化再查重；客户历史查询与 30 天重复线索窗口不得混为一谈
 *   - 手机号默认返回脱敏值；完整手机号使用独立字段权限
 */

const CN_MOBILE_RE = /^1[3-9]\d{9}$/

/** 去除空格/横线/括号/前缀 +86；不做合法性校验，只做归一化 */
export function normalizePhone(raw: string): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\s\-().]+/g, '').replace(/^(?:\+?86)+/, '')
}

/** 是否为合法中国大陆 11 位手机号 */
export function isValidCnMobile(raw: string): boolean {
  return CN_MOBILE_RE.test(normalizePhone(raw))
}

/** 138****1111 格式脱敏（中间 4 位用 * 替换）。非法手机号原样返回，便于排查。 */
export function maskPhone(raw: string): string {
  const n = normalizePhone(raw)
  if (!CN_MOBILE_RE.test(n)) return n
  return `${n.slice(0, 3)}****${n.slice(7)}`
}

/** 仅返回尾 4 位（用于重复手机号列表展示） */
export function phoneLast4(raw: string): string {
  const n = normalizePhone(raw)
  if (!CN_MOBILE_RE.test(n)) return n.slice(-4)
  return n.slice(-4)
}
