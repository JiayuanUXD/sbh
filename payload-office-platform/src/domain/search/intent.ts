/**
 * 查询里的类目与面积意图。
 *
 * 把「整层」「共享办公」「500平」「300-500平」「500平以上」从查询里抽出来，转成房源已有的筛选
 * （`listingType` / `areaMin` / `areaMax`），剩下的文字继续走关键词流程。
 *
 * 必须在 L1 归一化**之前**解析：归一化会把「-」「㎡」当标点切掉，「300-500平」会变成两个无关
 * 词项，区间信息就丢了。这里自己先做一次 NFKC（全角数字 / 单位、`㎡` → `m2` 都靠它）。
 *
 * 价格（「3万以内」）刻意不做：房源价格必须带单位（元/月、元/㎡/天、元/工位/月不可通约），
 * 「3万」没有单位，硬映射会静默漏掉按其它单位标价的房源。
 *
 * 只认明确的词：「整层」「整层办公」→ full-floor，「共享办公」「联合办公」→ coworking。
 * 「共享」单独出现、「独栋」（和建筑形态 / serviced-office 的含义对不上）、「写字楼」「办公室」
 * （太泛）都不当类型。
 */

export type SearchIntentListingType = 'full-floor' | 'coworking'

export type SearchIntent = Readonly<{
  listingType?: readonly SearchIntentListingType[]
  /** ㎡，含。 */
  areaMin?: number
  /** ㎡，含。 */
  areaMax?: number
  /** 去掉意图片段后的剩余文字（供原有的关键词流程继续用）。 */
  rest: string
  /** 给用户看的「已识别」说明，如「整层办公」「面积 300–500㎡」。 */
  labels: readonly string[]
}>

const UNIT = '(?:平方米|平米|平方|平|m2|sqm)'
const NUM = '(\\d+(?:\\.\\d+)?)'

/** 单值面积的容差：「500平」按 ±20% 取区间，用户要的是「大概这么大」。 */
const APPROX_RATIO = 0.2
const MIN_AREA = 10
const MAX_AREA = 100000

const TYPE_RULES: ReadonlyArray<{
  type: SearchIntentListingType
  label: string
  pattern: RegExp
}> = [
  { type: 'full-floor', label: '整层办公', pattern: /整层办公|整层/g },
  { type: 'coworking', label: '共享办公', pattern: /共享办公|联合办公/g },
]

type AreaMatch = Readonly<{ min?: number; max?: number; label: string }>

const saneArea = (value: number) => Number.isFinite(value) && value >= MIN_AREA && value <= MAX_AREA

/** 按优先级依次尝试：区间 > 带限定词 > 带后缀 > 单值。每种只取第一处。 */
const AREA_RULES: ReadonlyArray<{
  pattern: RegExp
  build: (match: RegExpExecArray) => AreaMatch | null
}> = [
  {
    pattern: new RegExp(`${NUM}\\s*(?:-|~|〜|到|至)\\s*${NUM}\\s*${UNIT}`),
    build: (m) => {
      const a = Number(m[1])
      const b = Number(m[2])
      if (!saneArea(a) || !saneArea(b)) return null
      const [min, max] = a <= b ? [a, b] : [b, a]
      return { min, max, label: `面积 ${min}–${max}㎡` }
    },
  },
  {
    // 「超过」前面不能是「不」：「不超过300平」是上限，由下一条规则处理
    pattern: new RegExp(`(?:(?<!不)(?:大于|超过|至少)|不少于|不低于)\\s*${NUM}\\s*${UNIT}`),
    build: (m) => (saneArea(Number(m[1])) ? { min: Number(m[1]), label: `面积 ≥${Number(m[1])}㎡` } : null),
  },
  {
    pattern: new RegExp(`(?:小于|不超过|最多|不超|低于)\\s*${NUM}\\s*${UNIT}`),
    build: (m) => (saneArea(Number(m[1])) ? { max: Number(m[1]), label: `面积 ≤${Number(m[1])}㎡` } : null),
  },
  {
    pattern: new RegExp(`${NUM}\\s*${UNIT}\\s*(?:及以上|以上|往上|起)`),
    build: (m) => (saneArea(Number(m[1])) ? { min: Number(m[1]), label: `面积 ≥${Number(m[1])}㎡` } : null),
  },
  {
    pattern: new RegExp(`${NUM}\\s*${UNIT}\\s*(?:以下|以内|之内|不到)`),
    build: (m) => (saneArea(Number(m[1])) ? { max: Number(m[1]), label: `面积 ≤${Number(m[1])}㎡` } : null),
  },
  {
    pattern: new RegExp(`${NUM}\\s*${UNIT}`),
    build: (m) => {
      const value = Number(m[1])
      if (!saneArea(value)) return null
      const min = Math.round(value * (1 - APPROX_RATIO))
      const max = Math.round(value * (1 + APPROX_RATIO))
      return { min, max, label: `面积约 ${min}–${max}㎡` }
    },
  },
]

export function extractSearchIntent(raw: string): SearchIntent {
  let text = (raw ?? '').normalize('NFKC').toLowerCase()
  const labels: string[] = []
  let areaMin: number | undefined
  let areaMax: number | undefined
  const listingType: SearchIntentListingType[] = []
  let matched = false

  for (const rule of AREA_RULES) {
    const match = rule.pattern.exec(text)
    if (!match) continue
    const area = rule.build(match)
    if (!area) continue
    areaMin = area.min
    areaMax = area.max
    labels.push(area.label)
    text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
    matched = true
    break
  }

  for (const rule of TYPE_RULES) {
    if (!rule.pattern.test(text)) continue
    rule.pattern.lastIndex = 0
    text = text.replace(rule.pattern, ' ')
    listingType.push(rule.type)
    labels.unshift(rule.label)
    matched = true
  }

  if (!matched) return { rest: (raw ?? '').trim(), labels: [] }

  return {
    ...(listingType.length > 0 ? { listingType } : {}),
    ...(areaMin !== undefined ? { areaMin } : {}),
    ...(areaMax !== undefined ? { areaMax } : {}),
    rest: text.replace(/\s+/g, ' ').trim(),
    labels,
  }
}
