/**
 * 词表上的统一模糊匹配：把查询的每个字符对齐到名字的每个「单元」上，按匹配方式打分。
 *
 * 为什么是一个打分器：拼音开头 / 拼音后半截 / 汉字拼音混输 / 错字 / 漏字多字，本质都是同一件事——
 * 「用户打的每个字符，对齐到某个名字的每个字上」，区别只在「相等」怎么算。此前每种打法各写一套规则、
 * 各配一组测试，用户每想出一种新打法就得再加一条。这里只维护一个对齐 + 一张得分表，新打法通常只需要
 * 调权重，并在 tests/fixtures/search-golden.ts（评测集）里加一行。
 *
 * 单元（Unit）：名称里的一个汉字 + 它的拼音音节；连续的非汉字（如 SOHO）算一个单元，音节就是它自己。
 * 查询字符：汉字，或 a–z 字母；含数字 / 其它符号的词项不处理。
 *
 * 一个单元被怎么「吃掉」：
 *   汉字相同                         3 分
 *   音节全打（lu 对 陆）             2.5 分
 *   音节只打开头（j 对 jia）         1 + 已打比例（≥1 分）
 *   同音字（建议模式，算 1 处编辑）   1.5 分
 *   错字 / 漏字 / 多字（建议模式）    扣分，各算 1 处编辑
 * 名字两端没被覆盖的单元按 0.3 分 / 个扣（自动模式：允许只覆盖一段，整名对上的自然排前面）。
 *
 * 两种模式：
 *   - 自动（resolveFuzzyAuto）：编辑数必须为 0，名字允许只覆盖一段，查询里必须有字母（纯汉字词项
 *     仍原样交给 ILIKE，不在这里改写），累计得分 ≥ {@link MIN_AUTO_GAIN}。用来改写查询。
 *   - 建议（suggestFuzzyCorrections）：只处理纯汉字词项，允许 1–2 处编辑，必须对齐整个名字。
 *     只用来出「你是不是想找」，不自动改写——改错了用户看到的是别的结果。
 *
 * 精确档（名称、别名、整词全拼、首字母）仍由 `resolveVocabularyTerm` 的前几档处理，是快速路径；
 * tests/search-fuzzy-golden.test.ts 校验打分器对这些情形与精确档自洽。
 */

import {
  nameKey,
  type SearchVocabulary,
  type VocabularyEntry,
  type VocabularyKind,
} from './vocabulary'

const HAN = /^\p{Script=Han}$/u
const LATIN = /^[a-z]$/

const SCORE_HAN_EXACT = 3
const SCORE_SYLLABLE_FULL = 2.5
const SCORE_HOMOPHONE = 1.5
const PENALTY_SUBSTITUTION = 0.5
const PENALTY_INDEL = 2
const PENALTY_OUTSIDE_PER_UNIT = 0.3

/** 自动模式的最低累计得分：2 个完整音节（5 分）够，一个完整音节（2.5）/ 半个音节不够。 */
export const MIN_AUTO_GAIN = 4.5
/** 建议模式的最低累计得分：至少要有一个汉字真的对上。 */
const MIN_SUGGEST_GAIN = 3

const MIN_SUGGEST_LENGTH = 2
const MAX_SUGGEST_LENGTH = 10
const MAX_SUGGESTIONS = 3

const KIND_ORDER: Readonly<Record<VocabularyKind, number>> = {
  building: 0,
  district: 1,
  businessArea: 2,
  metro: 3,
  city: 4,
}

type Unit = Readonly<{ han: string | null; syl: string }>
type Surface = Readonly<{ text: string; units: readonly Unit[] }>
type EntrySurfaces = Readonly<{ entry: VocabularyEntry; surfaces: readonly Surface[] }>

type Index = Readonly<{
  entries: readonly EntrySurfaces[]
  /** 汉字 → 音节，取自词表名称（用来判断同音字）。 */
  charSyllable: ReadonlyMap<string, string>
}>

const indexCache = new WeakMap<SearchVocabulary, Index>()

/** 名称 → 单元。音节缺失 / 数量对不上时音节置空（仍可做汉字匹配，只是不能做拼音匹配）。 */
function unitsOfName(name: string, syllables: readonly string[] | undefined): readonly Unit[] {
  const chars = Array.from(name)
  const units: Unit[] = []
  let syllableIndex = 0
  for (let i = 0; i < chars.length; ) {
    const char = chars[i]!
    if (HAN.test(char)) {
      units.push({ han: char, syl: syllables?.[syllableIndex] ?? '' })
      syllableIndex += 1
      i += 1
      continue
    }
    let run = ''
    while (i < chars.length && !HAN.test(chars[i]!)) {
      run += chars[i]
      i += 1
    }
    units.push({ han: null, syl: (syllables?.[syllableIndex] ?? run).toLowerCase() })
    syllableIndex += 1
  }
  const consistent = syllables !== undefined && syllableIndex === syllables.length
  return consistent ? units : units.map((unit) => ({ han: unit.han, syl: unit.han === null ? unit.syl : '' }))
}

/** 别名只有文字没有音节：汉字单元音节置空，只能做汉字匹配。 */
function unitsOfAlias(alias: string): readonly Unit[] {
  const units: Unit[] = []
  const chars = Array.from(alias)
  for (let i = 0; i < chars.length; ) {
    const char = chars[i]!
    if (HAN.test(char)) {
      units.push({ han: char, syl: '' })
      i += 1
      continue
    }
    let run = ''
    while (i < chars.length && !HAN.test(chars[i]!)) {
      run += chars[i]
      i += 1
    }
    units.push({ han: null, syl: run.toLowerCase() })
  }
  return units
}

function indexOf(vocab: SearchVocabulary): Index {
  const cached = indexCache.get(vocab)
  if (cached) return cached
  const charSyllable = new Map<string, string>()
  const entries: EntrySurfaces[] = []
  for (const entry of vocab.entries) {
    // 当前城市不进匹配：在 /shanghai 下把别的词纠成「上海（城市）」是噪音。
    if (entry.kind === 'city' && entry.slug === vocab.city) continue
    const nameUnits = unitsOfName(entry.name, entry.syllables)
    for (const unit of nameUnits) {
      if (unit.han !== null && unit.syl !== '' && !charSyllable.has(unit.han)) charSyllable.set(unit.han, unit.syl)
    }
    const surfaces: Surface[] = [{ text: nameKey(entry.name), units: nameUnits }]
    for (const alias of entry.aliases) {
      const key = nameKey(alias)
      if (!Array.from(key).some((char) => HAN.test(char))) continue // 纯 ASCII 别名走精确档
      surfaces.push({ text: key, units: unitsOfAlias(key) })
    }
    entries.push({ entry, surfaces })
  }
  const built = { entries, charSyllable }
  indexCache.set(vocab, built)
  return built
}

type Token = Readonly<{ han: string } | { latin: string }>

/** 查询 → 字符记号；含数字 / 其它符号返回 null。 */
function tokenize(term: string): readonly Token[] | null {
  const tokens: Token[] = []
  for (const char of Array.from(nameKey(term))) {
    if (HAN.test(char)) tokens.push({ han: char })
    else if (LATIN.test(char)) tokens.push({ latin: char })
    else return null
  }
  return tokens.length > 0 ? tokens : null
}

/** 一个单元被「合上」时的得分：音节全打 2.5，只打一部分按比例（首字母约 1.3）。 */
function closeGain(offset: number, length: number): number {
  return offset >= length ? SCORE_SYLLABLE_FULL : 1 + offset / length
}

type Alignment = Readonly<{ score: number; edits: number; gain: number }>

/**
 * 在一个名字（单元序列）上对齐查询。允许编辑（建议模式）时：替换 / 同音 / 漏字 / 多字各算 1 处。
 * 返回得分最高（同分取编辑少）的对齐，没有对上返回 null。
 */
function align(
  tokens: readonly Token[],
  units: readonly Unit[],
  mode: 'auto' | 'suggest',
  charSyllable: ReadonlyMap<string, string>,
): Alignment | null {
  const m = tokens.length
  const n = units.length
  let maxOffset = 0
  for (const unit of units) maxOffset = Math.max(maxOffset, unit.syl.length)
  const stride = maxOffset + 1
  const size = (m + 1) * (n + 1) * stride
  const score = new Float64Array(size).fill(Number.NEGATIVE_INFINITY)
  const edits = new Int16Array(size)
  const gain = new Float64Array(size)
  const at = (i: number, j: number, offset: number) => (i * (n + 1) + j) * stride + offset

  const relax = (index: number, s: number, e: number, g: number) => {
    if (s > score[index]! || (s === score[index]! && e < edits[index]!)) {
      score[index] = s
      edits[index] = e
      gain[index] = g
    }
  }

  if (mode === 'auto') {
    for (let start = 0; start <= n; start += 1) relax(at(0, start, 0), -PENALTY_OUTSIDE_PER_UNIT * start, 0, 0)
  } else {
    relax(at(0, 0, 0), 0, 0, 0)
  }

  for (let i = 0; i <= m; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      for (let offset = 0; offset < stride; offset += 1) {
        const here = at(i, j, offset)
        const s = score[here]!
        if (s === Number.NEGATIVE_INFINITY) continue
        const e = edits[here]!
        const g = gain[here]!
        const unit = j < n ? units[j]! : null
        const token = i < m ? tokens[i]! : null

        // 合上已经打了一部分的单元
        if (unit && offset > 0) {
          const closed = closeGain(offset, unit.syl.length)
          relax(at(i, j + 1, 0), s + closed, e, g + closed)
        }
        // 继续吃字母：当前单元的音节从 offset 起要与下一个查询字母相同
        if (unit && token && 'latin' in token && offset < unit.syl.length && unit.syl[offset] === token.latin) {
          relax(at(i + 1, j, offset + 1), s, e, g)
        }
        if (offset > 0) continue // 打了一半的单元只能继续吃字母或合上

        if (unit && mode === 'suggest') {
          // 漏字：名字里多出的单元
          relax(at(i, j + 1, 0), s - PENALTY_INDEL, e + 1, g)
        }

        if (!token) continue
        if ('han' in token) {
          if (unit) {
            if (unit.han === token.han) {
              relax(at(i + 1, j + 1, 0), s + SCORE_HAN_EXACT, e, g + SCORE_HAN_EXACT)
            } else if (mode === 'suggest') {
              const sameSound = unit.syl !== '' && charSyllable.get(token.han) === unit.syl
              relax(
                at(i + 1, j + 1, 0),
                s + (sameSound ? SCORE_HOMOPHONE : -PENALTY_SUBSTITUTION),
                e + 1,
                g,
              )
            }
          }
          // 多字：查询里多出的字
          if (mode === 'suggest') relax(at(i + 1, j, 0), s - PENALTY_INDEL, e + 1, g)
        }
      }
    }
  }

  return finish(tokens, units, mode, score, edits, gain, at, stride)
}

function finish(
  tokens: readonly Token[],
  units: readonly Unit[],
  mode: 'auto' | 'suggest',
  score: Float64Array,
  edits: Int16Array,
  gain: Float64Array,
  at: (i: number, j: number, offset: number) => number,
  stride: number,
): Alignment | null {
  const m = tokens.length
  const n = units.length
  let best: Alignment | null = null
  for (let j = 0; j <= n; j += 1) {
    for (let offset = 0; offset < stride; offset += 1) {
      const index = at(m, j, offset)
      let s = score[index]!
      if (s === Number.NEGATIVE_INFINITY) continue
      let g = gain[index]!
      let end = j
      if (offset > 0) {
        const unit = units[j]
        if (!unit) continue
        const closed = closeGain(offset, unit.syl.length)
        s += closed
        g += closed
        end = j + 1
      }
      if (mode === 'suggest' && end !== n) continue
      if (mode === 'auto') s -= PENALTY_OUTSIDE_PER_UNIT * (n - end)
      const candidate = { score: s, edits: edits[index]!, gain: g }
      if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.edits < best.edits)) {
        best = candidate
      }
    }
  }
  return best
}

export type FuzzyMatch = Readonly<{ entry: VocabularyEntry; score: number; edits: number }>

function compareMatches(a: FuzzyMatch, b: FuzzyMatch): number {
  return (
    a.edits - b.edits
    || b.score - a.score
    || KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind]
    || a.entry.name.length - b.entry.name.length
    || a.entry.name.localeCompare(b.entry.name, 'zh-CN')
  )
}

/**
 * 自动改写：字母（拼音）参与的词项，对齐到名字的某一段，编辑数为 0。
 * 覆盖：拼音后半截 / 中间一段 / 最后一个音节只打一部分 / 汉字与拼音混输。
 */
export function resolveFuzzyAuto(vocab: SearchVocabulary, term: string): readonly VocabularyEntry[] {
  const tokens = tokenize(term)
  if (!tokens || !tokens.some((token) => 'latin' in token)) return []
  const { entries, charSyllable } = indexOf(vocab)

  // 廉价前置过滤：字母必须是名字拼音的子序列、汉字必须依次出现在名字里
  const letters = tokens.flatMap((token) => ('latin' in token ? [token.latin] : []))
  const hans = tokens.flatMap((token) => ('han' in token ? [token.han] : []))

  const matches: FuzzyMatch[] = []
  for (const { entry, surfaces } of entries) {
    let best: Alignment | null = null
    for (const surface of surfaces) {
      if (!passesPrefilter(surface.units, letters, hans)) continue
      const alignment = align(tokens, surface.units, 'auto', charSyllable)
      if (alignment && (!best || alignment.score > best.score)) best = alignment
    }
    if (best && best.edits === 0 && best.gain >= MIN_AUTO_GAIN) {
      matches.push({ entry, score: best.score, edits: 0 })
    }
  }
  return matches.sort(compareMatches).map((match) => match.entry)
}

function passesPrefilter(units: readonly Unit[], letters: readonly string[], hans: readonly string[]): boolean {
  if (letters.length > 0) {
    const joined = units.map((unit) => unit.syl).join('')
    let cursor = 0
    for (const letter of letters) {
      cursor = joined.indexOf(letter, cursor)
      if (cursor < 0) return false
      cursor += 1
    }
  }
  let position = 0
  for (const han of hans) {
    let found = false
    while (position < units.length) {
      if (units[position]!.han === han) {
        found = true
        position += 1
        break
      }
      position += 1
    }
    if (!found) return false
  }
  return true
}

function toleranceFor(length: number): number {
  return length >= 6 ? 2 : 1
}

/**
 * 建议：纯汉字词项，整名对齐，允许 1–2 处编辑（错字 / 同音字 / 漏字 / 多字）。
 * 已经是名称或别名的不算错字。结果按 编辑数、得分、楼盘 > 行政区 > 商圈 > 地铁 排序，最多 3 条。
 */
export function suggestFuzzyCorrections(
  vocab: SearchVocabulary,
  terms: readonly string[],
): readonly VocabularyEntry[] {
  const { entries, charSyllable } = indexOf(vocab)
  const best = new Map<string, FuzzyMatch>()

  for (const term of terms) {
    const tokens = tokenize(term)
    if (!tokens || tokens.some((token) => 'latin' in token)) continue
    if (tokens.length < MIN_SUGGEST_LENGTH || tokens.length > MAX_SUGGEST_LENGTH) continue
    const key = nameKey(term)
    if (entries.some(({ surfaces }) => surfaces.some((surface) => surface.text === key))) continue

    const tolerance = toleranceFor(tokens.length)
    for (const { entry, surfaces } of entries) {
      for (const surface of surfaces) {
        if (Math.abs(surface.units.length - tokens.length) > tolerance) continue
        const alignment = align(tokens, surface.units, 'suggest', charSyllable)
        if (!alignment || alignment.edits < 1 || alignment.edits > tolerance || alignment.gain < MIN_SUGGEST_GAIN) continue
        const id = `${entry.kind}:${String(entry.id)}`
        const candidate: FuzzyMatch = { entry, score: alignment.score, edits: alignment.edits }
        const known = best.get(id)
        if (!known || compareMatches(candidate, known) < 0) best.set(id, candidate)
      }
    }
  }

  return [...best.values()]
    .sort(compareMatches)
    .slice(0, MAX_SUGGESTIONS)
    .map((match) => match.entry)
}
