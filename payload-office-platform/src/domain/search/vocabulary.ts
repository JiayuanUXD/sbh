/**
 * L2 词表：公开实体名 + 别名 + 全拼 + 首字母。
 *
 * 只做「词项 → 实体」的解析，不查库、不生成词表（生成见 Batch 2）。
 * 解析按层级短路：名称全等 > 别名全等 > 全拼全等 > 首字母全等 > 名称前缀
 * > 全拼前缀。命中某一层就把该层全部返回，交给调用方决定「查询取第一个、
 * 建议列表展示全部」——不在这一层静默替用户选。
 *
 * 首字母/前缀要求词项至少 2 个字符：单字 `s` 会命中一大片拼音，属于噪音。
 */

export type VocabularyKind = 'building' | 'district' | 'businessArea' | 'metro' | 'city'

export type VocabularyEntry = Readonly<{
  kind: VocabularyKind
  id: number | string
  slug: string
  name: string
  parentName?: string
  aliases: readonly string[]
  /** 无声调全拼，例：`shanghaizhongxin`。 */
  pinyin: string
  /** 首字母，例：`shzx`。 */
  initials: string
  /**
   * 无声调拼音的音节序列，例：`['shang', 'hai', 'zhong', 'xin']`。构建词表时算一次，
   * 供「窗口」匹配（用户只打名字中间 / 后半段的拼音）用；缺省（旧缓存 / 夹具）则不参与窗口匹配。
   */
  syllables?: readonly string[]
}>

export type SearchVocabulary = Readonly<{
  city: string
  entries: readonly VocabularyEntry[]
}>

const KIND_ORDER: Readonly<Record<VocabularyKind, number>> = {
  building: 0,
  district: 1,
  businessArea: 2,
  metro: 3,
  city: 4,
}

/** 名称/别名的比较键：NFKC、小写、去空白，保留汉字。 */
export function nameKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

/** 拼音/首字母的比较键：只留 ASCII 字母数字。 */
export function latinKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function compareEntries(a: VocabularyEntry, b: VocabularyEntry): number {
  const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  if (kind !== 0) return kind
  const length = a.name.length - b.name.length
  if (length !== 0) return length
  return a.name.localeCompare(b.name, 'zh-CN')
}

/** 窗口匹配的最少字母数：再短（xin / zh）会命中一大片，只是噪音。 */
const MIN_WINDOW_LENGTH = 4

/**
 * 拼音窗口：`latin` 是否能从某个音节的开头起，连续覆盖若干个音节（最后一个音节允许只打一部分）。
 * `zhongxin` 命中 [shang, hai, zhong, xin]（从 zhong 起），`zhongx` 也行；`hongxin` 不行——
 * 不能从音节中间开始，否则任何子串都能命中。
 */
function hasSyllableWindow(syllables: readonly string[] | undefined, latin: string): boolean {
  if (!syllables || latin.length < MIN_WINDOW_LENGTH) return false
  for (let start = 0; start < syllables.length; start += 1) {
    let joined = ''
    for (let index = start; index < syllables.length; index += 1) {
      joined += syllables[index]
      if (joined.startsWith(latin)) return true
      if (!latin.startsWith(joined)) break
    }
  }
  return false
}

export function resolveVocabularyTerm(
  vocab: SearchVocabulary,
  term: string,
): readonly VocabularyEntry[] {
  const name = nameKey(term)
  const latin = latinKey(term)
  if (name.length === 0 && latin.length === 0) return []

  const tiers: readonly ((entry: VocabularyEntry) => boolean)[] = [
    (entry) => nameKey(entry.name) === name,
    (entry) => entry.aliases.some((alias) => nameKey(alias) === name),
    (entry) => latin.length > 0 && latinKey(entry.pinyin) === latin,
    (entry) => latin.length >= 2 && latinKey(entry.initials) === latin,
    (entry) => name.length >= 2 && nameKey(entry.name).startsWith(name),
    (entry) => latin.length >= 2 && latinKey(entry.pinyin).startsWith(latin),
    // 最低优先级：只打名字中间 / 后半段的拼音（「上海 zhongxin」里的 zhongxin）
    (entry) => hasSyllableWindow(entry.syllables, latin),
  ]

  for (const matches of tiers) {
    const found = vocab.entries.filter(matches).sort(compareEntries)
    if (found.length > 0) return found
  }
  return []
}
