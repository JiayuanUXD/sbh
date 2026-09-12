/**
 * 顶栏客服电话（OPT-094）：展示写法与 `tel:` 链接从同一个字符串派生。
 *
 * 运营在后台填的是给人看的写法（`400-820-1234`、`021 6888 8888`、`+86 21 …`），
 * 拨号链接只认数字与前导 `+`。校验故意宽松：只拦「明显不是电话」的串
 * （字母、其它符号、少于 7 位数字），不猜运营会用哪种格式。
 *
 * 纯函数、无依赖：后台字段 `validate` 与 C 端渲染共用，两侧口径不会漂。
 */

export type ServicePhone = Readonly<{
  /** 原样（去首尾空白）给人看的写法 */
  display: string
  /** `tel:` 链接：`+` 只保留开头一个，其余只留数字 */
  href: string
}>

/** 允许的字符：数字、`+`、横线、空格、括号 */
const ALLOWED = /^[0-9+\-\s()]+$/
/** 至少 7 位数字才像个电话：最短的本地号（`6888888`）也有 7 位 */
const MIN_DIGITS = 7

export function normalizeServicePhone(raw: unknown): ServicePhone | null {
  if (typeof raw !== 'string') return null
  const display = raw.trim()
  if (display === '' || !ALLOWED.test(display)) return null
  const digits = display.replace(/[^0-9]/g, '')
  if (digits.length < MIN_DIGITS) return null
  const plus = display.startsWith('+') ? '+' : ''
  return { display, href: `tel:${plus}${digits}` }
}

/** 后台字段校验用：留空合法，填了就必须能归一化。 */
export function isValidServicePhone(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true
  if (typeof raw === 'string' && raw.trim() === '') return true
  return normalizeServicePhone(raw) !== null
}
