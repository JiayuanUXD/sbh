/**
 * 资讯搜索的匹配条件。
 *
 * 输入是 `normalizeSearchQuery` 归一化后的词串（词间单个空格）。逐词匹配：
 * 词与词 AND，同一个词在标题 OR 摘要里命中即可。
 *
 * 不能把整串当一个子串去 contains：词间的空格会被原样拿去匹配，「陆家嘴 租金」
 * 只有在标题恰好含这串带空格的文字时才命中，等于多词查询永远搜不到。
 *
 * 词项里没有 `%` / `_` 之类通配符：归一化已把非字母数字汉字的字符全部当分隔符。
 */

/** 与 normalize.ts 的 MAX_TERMS 同口径；调用方传入的串本来就已封顶，这里再兜一次。 */
const MAX_TERMS = 8

export type ArticleSearchClause = {
  or: [{ title: { contains: string } }, { excerpt: { contains: string } }]
}

export function articleSearchClauses(q: string | undefined): ArticleSearchClause[] {
  if (!q) return []
  const terms = Array.from(new Set(q.split(/\s+/).filter((term) => term.length > 0))).slice(0, MAX_TERMS)
  return terms.map((term) => ({
    or: [{ title: { contains: term } }, { excerpt: { contains: term } }],
  }))
}
