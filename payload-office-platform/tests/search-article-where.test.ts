/**
 * 资讯搜索的匹配条件：多词查询逐词匹配（词与词 AND，词内标题 OR 摘要）。
 *
 * 此前把归一化后的整串（词间是空格）当一个子串去 contains，导致「陆家嘴 租金」
 * 这类多词查询只有在标题恰好含这串带空格的文字时才命中，等于永远搜不到。
 */

import { describe, expect, it } from 'vitest'

import { articleSearchClauses } from '@/domain/search/article-where'

describe('articleSearchClauses', () => {
  it('空查询没有条件', () => {
    expect(articleSearchClauses(undefined)).toEqual([])
    expect(articleSearchClauses('')).toEqual([])
    expect(articleSearchClauses('   ')).toEqual([])
  })

  it('单词：一个条件，标题 OR 摘要', () => {
    expect(articleSearchClauses('陆家嘴')).toEqual([
      { or: [{ title: { contains: '陆家嘴' } }, { excerpt: { contains: '陆家嘴' } }] },
    ])
  })

  it('多词：每个词各一个条件（词间 AND），不再把整串带空格匹配', () => {
    const clauses = articleSearchClauses('陆家嘴 租金')
    expect(clauses).toHaveLength(2)
    expect(clauses[0]).toEqual({ or: [{ title: { contains: '陆家嘴' } }, { excerpt: { contains: '陆家嘴' } }] })
    expect(clauses[1]).toEqual({ or: [{ title: { contains: '租金' } }, { excerpt: { contains: '租金' } }] })
    expect(JSON.stringify(clauses)).not.toContain('陆家嘴 租金')
  })

  it('多余空白与重复词被折叠', () => {
    expect(articleSearchClauses('  租金   租金  ')).toHaveLength(1)
  })

  it('词数封顶 8，与站内搜索归一化口径一致', () => {
    const q = Array.from({ length: 12 }, (_, i) => `词${i}`).join(' ')
    expect(articleSearchClauses(q)).toHaveLength(8)
  })
})
