/**
 * 资讯数字核对（OPT-124）：标题、摘要、SEO 字段、正文里出现的每个数，都要能在本篇的 numbers.json 里找到。
 *
 * 为什么要有这道闸：2026-10-21 上线的两篇里，一篇把「带家具比毛坯贵 12.5%」写成 18%，一篇的样本数在标题、
 * 正文、SEO 描述里是三个不同的数。人工通读很难逐个核，脚本可以：数字只能从取数脚本算出来，正文只是转述。
 *
 * numbers.json 格式（由本篇的分析脚本生成）：
 *
 *   { "asOf": "2026-10-22T08:50:00.000Z",
 *     "numbers": [ { "key": "huangpu.median", "value": 5.36, "basis": "黄浦区 元/㎡/天 挂牌价中位数", "sample": 6730 } ] }
 *
 * 匹配规则（宁严勿松，写法上的正常取整放行）：
 * - 带小数的数：按它写出来的位数四舍五入后相等即可（4.7 ↔ 4.68）。
 * - 整数：必须完全相等；前面有「约 / 近 / 超过……」时，按末尾的 0 取整（近 2,900 ↔ 2,865）。
 * - X 万：按 万 换算后同上（2.8 万 ↔ 28,080）；X 多万：落在 [X, X+10^(位数-1)) 万之间（20 多万 ↔ 21.4 万）。
 * - X%：与 value 或 value×100（value ≤ 1 时）按位数比较。
 * 不核对：年月日与时刻、地铁「N 号线」、「第 N」、紧跟在字母后的数（Q4、P25），以及不带单位的 0–10 小整数
 *（「3 条建议」「5 个面积段」这类计数；`strict` 模式下也要核）。
 */
import { roundLikePg } from './news-supply'

export type NumberEntry = Readonly<{ key: string; value: number; basis: string; sample?: number }>
export type NumbersFile = Readonly<{ asOf: string; numbers: readonly NumberEntry[] }>

/** 校验 numbers.json 的结构；任何一处不对就整份拒绝，报出第几条哪个字段。 */
export function parseNumbersFile(raw: unknown, file: string): NumbersFile {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${file}: 不是 JSON 对象`)
  const r = raw as { asOf?: unknown; numbers?: unknown }
  if (typeof r.asOf !== 'string' || Number.isNaN(Date.parse(r.asOf))) throw new Error(`${file}: asOf 必须是合法时间（取数时刻）`)
  if (!Array.isArray(r.numbers) || r.numbers.length === 0) throw new Error(`${file}: numbers 必须是非空数组`)
  const keys = new Set<string>()
  const numbers = r.numbers.map((item: unknown, i: number): NumberEntry => {
    const e = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    const where = `${file}: numbers[${i}]`
    if (typeof e.key !== 'string' || e.key.trim() === '') throw new Error(`${where}.key 必须是非空字符串`)
    if (keys.has(e.key)) throw new Error(`${where}.key 重复：${e.key}`)
    keys.add(e.key)
    if (typeof e.value !== 'number' || !Number.isFinite(e.value)) throw new Error(`${where}.value 必须是有限数字（${e.key}）`)
    if (typeof e.basis !== 'string' || e.basis.trim() === '') throw new Error(`${where}.basis 必须写口径（${e.key}）`)
    if (e.sample !== undefined && (typeof e.sample !== 'number' || !Number.isSafeInteger(e.sample) || e.sample < 0)) {
      throw new Error(`${where}.sample 必须是非负整数（${e.key}）`)
    }
    return { key: e.key, value: e.value, basis: e.basis, ...(typeof e.sample === 'number' ? { sample: e.sample } : {}) }
  })
  return { asOf: r.asOf, numbers }
}

/** 取数距今超过 maxHours 小时返回问题描述：供给一天内就会大变（静安区半天少过一半）。 */
export function freshnessProblem(asOf: string, now: Date, maxHours: number): string | null {
  const hours = (now.getTime() - Date.parse(asOf)) / 3_600_000
  if (hours < 0) return `numbers.json 的 asOf（${asOf}）在未来`
  return hours > maxHours ? `numbers.json 是 ${hours.toFixed(1)} 小时前取的数，超过 ${maxHours} 小时，重跑 news:data` : null
}

export type NumberToken = Readonly<{
  raw: string
  value: number
  decimals: number
  unit: '%' | '万' | '多万' | null
  approx: boolean
  source: string
  context: string
}>

/** 不核对的片段：先用等长空白盖掉，保证上下文位置不变。 */
const IGNORED_SPANS: readonly RegExp[] = [
  /\d{4}\s*-\s*\d{1,2}\s*-\s*\d{1,2}/g, // 2026-10-22
  /\d{4}\s*年(\s*\d{1,2}\s*月)?(\s*\d{1,2}\s*[日号])?/g, // 2026 年 10 月 22 日
  /\d{1,2}\s*月(\s*\d{1,2}\s*[日号])?/g, // 10 月、12 月 2 日
  /\d{1,2}\s*[日号](?!线)/g, // 22 日
  /\d{1,2}\s*:\s*\d{2}/g, // 14:53
  /\d+\s*号线/g, // 2 号线
  /第\s*\d+/g, // 第 41 位
]
const APPROX_BEFORE = /(约|大约|大概|近|将近|接近|超过|逾|上|不到|不足|差不多)\s*$/
const NUMBER = /(?<![A-Za-z0-9.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/g

export function extractNumbers(text: string, source: string, options: Readonly<{ strict?: boolean }> = {}): NumberToken[] {
  let masked = text
  for (const re of IGNORED_SPANS) masked = masked.replace(re, (m) => ' '.repeat(m.length))
  const tokens: NumberToken[] = []
  for (const m of masked.matchAll(NUMBER)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    const after = masked.slice(end).replace(/^\s+/, '')
    const unit: NumberToken['unit'] = /^[%％]/.test(after) ? '%' : after.startsWith('多万') ? '多万' : after.startsWith('万') ? '万' : null
    const decimals = m[2] ? m[2].length - 1 : 0
    const value = Number(m[0].replace(/,/g, ''))
    const approx = APPROX_BEFORE.test(masked.slice(Math.max(0, start - 4), start))
    if (!options.strict && unit === null && decimals === 0 && !approx && value <= 10) continue
    tokens.push({
      raw: m[0],
      value,
      decimals,
      unit,
      approx,
      source,
      context: text.slice(Math.max(0, start - 12), Math.min(text.length, end + 12)).replace(/\s+/g, ' '),
    })
  }
  return tokens
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

/**
 * 按写出来的精度比较。`roundIntegers`：整数写法允许四舍五入到个位（百分比、万），否则整数必须完全相等
 *（条数、套数一个都不能差）；带「约 / 近」时再放宽到末尾 0 的位数（近 2,900）。
 */
function matchesAtPrecision(candidate: number, token: NumberToken, roundIntegers = false): boolean {
  if (token.decimals > 0) return close(roundLikePg(candidate, token.decimals), token.value)
  if (close(candidate, token.value)) return true
  if (roundIntegers && close(roundLikePg(candidate, 0), token.value)) return true
  if (!token.approx) return false
  const zeros = /0*$/.exec(String(token.value))?.[0].length ?? 0
  const step = 10 ** zeros
  return close(roundLikePg(candidate / step, 0) * step, token.value)
}

/** 该数能否由 numbers.json 里的某个值按上面的规则写出来。 */
export function tokenMatches(token: NumberToken, values: readonly number[]): boolean {
  return values.some((v) => {
    switch (token.unit) {
      case '%':
        return matchesAtPrecision(v, token, true) || (Math.abs(v) <= 1 && matchesAtPrecision(v * 100, token, true))
      case '万':
        return matchesAtPrecision(v / 10_000, token, true) || matchesAtPrecision(v, token, true)
      case '多万': {
        const step = 10 ** Math.max(0, String(Math.trunc(token.value)).length - 1)
        return [v / 10_000, v].some((c) => c >= token.value && c < token.value + step)
      }
      default:
        return matchesAtPrecision(v, token)
    }
  })
}

/** 逐个核对；返回核对过的个数与找不到出处的数字（带来源字段和上下文）。 */
export function checkNumbers(
  texts: readonly Readonly<{ source: string; text: string }>[],
  numbers: NumbersFile,
  options: Readonly<{ strict?: boolean }> = {},
): { checked: number; unmatched: NumberToken[] } {
  const values = numbers.numbers.map((n) => n.value)
  const tokens = texts.flatMap((t) => extractNumbers(t.text, t.source, options))
  return { checked: tokens.length, unmatched: tokens.filter((t) => !tokenMatches(t, values)) }
}
