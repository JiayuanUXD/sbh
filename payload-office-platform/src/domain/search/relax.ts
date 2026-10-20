/**
 * 多词无结果时的放宽候选。
 *
 * 只生成候选，不执行查询：调用方按顺序试，第一个有结果的候选胜出，并把
 * `dropped` 里的词显示成「已忽略『整层』」。**不允许无限放宽**——只有
 * 「去掉最后一个词」和「所有词改成 OR」两种，最多两步，避免把
 * 「陆家嘴」放宽成「陆」这种把结果集放大的假命中。
 */

export type Relaxation = Readonly<{
  terms: readonly string[]
  dropped: readonly string[]
  mode: 'drop-last' | 'or'
}>

export function relaxQuery(terms: readonly string[]): readonly Relaxation[] {
  if (terms.length <= 1) return []

  const last = terms[terms.length - 1]!
  return [
    { terms: terms.slice(0, -1), dropped: [last], mode: 'drop-last' },
    { terms: [...terms], dropped: [], mode: 'or' },
  ]
}
