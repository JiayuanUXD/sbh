/**
 * 错字纠错：对封闭词表做模糊匹配，只用于零结果时的「你是不是想找」。
 *
 * 不自动改写查询——改错了用户看到的是别的结果，而建议只是多一个可点的选项。
 * 实现已并入统一的模糊匹配器（fuzzy.ts 的建议模式）：错字 / 同音字 / 漏字 / 多字各算 1 处编辑，
 * 整个名字对齐，≤5 字容 1 处、≥6 字容 2 处，最多 3 条。
 *
 * 为什么不用 pg_trgm：TencentDB 是否允许装扩展没有闭环；词表是封闭的、量级小，内存里做完全够用。
 */

import { suggestFuzzyCorrections } from './fuzzy'
import type { SearchVocabulary, VocabularyEntry } from './vocabulary'

export function suggestTypoCorrections(
  terms: readonly string[],
  vocab: SearchVocabulary,
): readonly VocabularyEntry[] {
  return suggestFuzzyCorrections(vocab, terms)
}
