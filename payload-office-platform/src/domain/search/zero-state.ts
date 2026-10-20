/**
 * 零结果分类。
 *
 * 只回答「该给哪一种兜底」，不负责取数、不负责渲染。优先级刻意写成
 * 实体 > 城市 > 改写 > 策展：
 *   - 楼盘真实存在但没在租房源，是最容易被误判成「没有」的一类；
 *   - 关键词指向别的城市时，先给城市切换，不要返回外地房源；
 *   - 有改写候选时给「你是不是想找」；
 *   - 都没有才进热门内容 + 留资。
 */

export type ZeroResultKind = 'entity' | 'city' | 'suggestion' | 'curated'

export type ZeroResultEntity = Readonly<{
  kind: 'building' | 'district' | 'metro'
  name: string
}>

export type ZeroResultCity = Readonly<{ slug: string; name: string }>

export function classifyZeroResult(input: Readonly<{
  exactEntity: ZeroResultEntity | null
  cityMatch: ZeroResultCity | null
  suggestions: readonly string[]
}>): ZeroResultKind {
  if (input.exactEntity) return 'entity'
  if (input.cityMatch) return 'city'
  if (input.suggestions.length > 0) return 'suggestion'
  return 'curated'
}
