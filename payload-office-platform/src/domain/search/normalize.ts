/**
 * 站内搜索的 L1 归一化层。
 *
 * 输入是用户在 URL / 输入框里给的任意字符串，输出是「可安全进 SQL 的词项」：
 *   - `NFKC` 把全角字母/数字/空格归一，避免「ＡＢＣ」与「ABC」被当成两个词；
 *   - 非字母/数字/汉字/空白一律当分隔符，而不是删掉——`静安，整层` 必须切成
 *     两个词，删标点会粘成「静安整层」；
 *   - 大小写只影响 ASCII；汉字不受影响；
 *   - 每个词项都带 `escaped`，调用方拼 `ILIKE` 时必须用它，否则用户输入的
 *     `%` / `_` 会被当成通配符（`?q=%` 会变成全表匹配）。
 *
 * 不做中文分词：v1 只按空白与标点切分，中文串整体成项。这是已知边界，
 * 见 spec §6.1；真正的分词留给 L3 或词典。
 */

/** 单个词项：`value` 用于打分与展示，`escaped` 用于 SQL LIKE。 */
export type SearchTerm = Readonly<{ value: string; escaped: string }>

export type NormalizedQuery = Readonly<{
  /** 原始输入，保留给「你是不是想找」与日志（日志不落原文，见 spec §9）。 */
  raw: string
  /** 归一化后的词串，用单个空格连接。 */
  normalized: string
  terms: readonly SearchTerm[]
}>

const MAX_TERMS = 8
const MAX_TERM_LENGTH = 50

/** SQL `LIKE` / `ILIKE` 的通配符转义。反斜杠必须最先处理。 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function normalizeText(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeSearchQuery(raw: string): NormalizedQuery {
  const normalizedText = normalizeText(raw ?? '')
  if (normalizedText.length === 0) {
    return { raw, normalized: '', terms: [] }
  }

  const terms = normalizedText
    .split(' ')
    .filter((term) => term.length > 0)
    .slice(0, MAX_TERMS)
    // 按 Unicode 码点截断，避免把 emoji / 扩展字切成孤立代理项。
    .map((term) => Array.from(term).slice(0, MAX_TERM_LENGTH).join(''))
    .filter((term) => term.length > 0)
    .map((value) => ({ value, escaped: escapeLikePattern(value) }))

  return {
    raw,
    normalized: terms.map((term) => term.value).join(' '),
    terms,
  }
}
