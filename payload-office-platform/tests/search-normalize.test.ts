import { describe, expect, it } from 'vitest'

import { escapeLikePattern, normalizeSearchQuery } from '@/domain/search/normalize'

const termsOf = (raw: string) => normalizeSearchQuery(raw).terms.map((term) => term.value)

describe('normalizeSearchQuery', () => {
  it('折叠全角空格与连续空白', () => {
    expect(termsOf('　静安　整层 ')).toEqual(['静安', '整层'])
    expect(normalizeSearchQuery('　静安　整层 ').normalized).toBe('静安 整层')
  })

  it('中文标点当分隔符，不把两个词粘在一起', () => {
    expect(termsOf('静安，整层。')).toEqual(['静安', '整层'])
  })

  it('全角字母转半角并转小写', () => {
    expect(termsOf('ＡＢＣ　写字楼')).toEqual(['abc', '写字楼'])
  })

  it('全角数字转半角', () => {
    expect(termsOf('１２３')).toEqual(['123'])
  })

  it('纯空白与控制字符返回空词表', () => {
    expect(termsOf('   ')).toEqual([])
    expect(termsOf('\u0000')).toEqual([])
  })

  it('单项最多 50 字', () => {
    expect(termsOf('a'.repeat(120))).toEqual(['a'.repeat(50)])
  })

  it('最多保留 8 个词项', () => {
    const raw = Array.from({ length: 10 }, (_, index) => `t${index}`).join(' ')
    expect(termsOf(raw)).toHaveLength(8)
  })

  it('escapeLikePattern 转义 LIKE 通配符', () => {
    expect(escapeLikePattern('50%_\\')).toBe('50\\%\\_\\\\')
    expect(escapeLikePattern('普通词')).toBe('普通词')
  })
})
