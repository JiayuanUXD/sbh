import { describe, expect, it } from 'vitest'

import { relaxQuery } from '@/domain/search/relax'

describe('relaxQuery', () => {
  it('单个词没有放宽空间', () => {
    expect(relaxQuery(['静安'])).toEqual([])
    expect(relaxQuery([])).toEqual([])
  })

  it('先去掉最后一个词，再给 OR 候选', () => {
    expect(relaxQuery(['静安', '整层', '500平'])).toEqual([
      { terms: ['静安', '整层'], dropped: ['500平'], mode: 'drop-last' },
      { terms: ['静安', '整层', '500平'], dropped: [], mode: 'or' },
    ])
  })

  it('两个词时去掉第二个', () => {
    expect(relaxQuery(['陆家嘴', '整层'])).toEqual([
      { terms: ['陆家嘴'], dropped: ['整层'], mode: 'drop-last' },
      { terms: ['陆家嘴', '整层'], dropped: [], mode: 'or' },
    ])
  })

  it('不修改输入数组', () => {
    const terms = ['静安', '整层']
    relaxQuery(terms)
    expect(terms).toEqual(['静安', '整层'])
  })
})
