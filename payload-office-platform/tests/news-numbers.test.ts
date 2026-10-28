import { describe, expect, it } from 'vitest'

import { checkNumbers, extractNumbers, freshnessProblem, parseNumbersFile, tokenMatches } from '../scripts/lib/news-numbers'

const file = (numbers: readonly { key: string; value: number }[]) =>
  parseNumbersFile({ asOf: '2026-10-22T08:50:00.000Z', numbers: numbers.map((n) => ({ ...n, basis: '测试口径' })) }, 'numbers.json')

const one = (text: string) => {
  const tokens = extractNumbers(text, 'body')
  expect(tokens).toHaveLength(1)
  return tokens[0]
}

describe('parseNumbersFile', () => {
  it('合法文件原样返回', () => {
    expect(file([{ key: 'a', value: 1 }]).numbers).toEqual([{ key: 'a', value: 1, basis: '测试口径' }])
  })

  it('缺 asOf、空数组、key 重复、value 非数字、缺口径都拒绝', () => {
    expect(() => parseNumbersFile({ numbers: [] }, 'n.json')).toThrow('asOf')
    expect(() => parseNumbersFile({ asOf: '2026-10-22', numbers: [] }, 'n.json')).toThrow('非空数组')
    expect(() => parseNumbersFile({ asOf: '2026-10-22', numbers: [{ key: 'a', value: 1, basis: 'x' }, { key: 'a', value: 2, basis: 'x' }] }, 'n.json')).toThrow('重复')
    expect(() => parseNumbersFile({ asOf: '2026-10-22', numbers: [{ key: 'a', value: '1', basis: 'x' }] }, 'n.json')).toThrow('value')
    expect(() => parseNumbersFile({ asOf: '2026-10-22', numbers: [{ key: 'a', value: 1 }] }, 'n.json')).toThrow('口径')
  })
})

describe('freshnessProblem', () => {
  it('超过时限、或时间在未来，都报出来', () => {
    const now = new Date('2026-10-22T12:00:00.000Z')
    expect(freshnessProblem('2026-10-22T08:00:00.000Z', now, 36)).toBeNull()
    expect(freshnessProblem('2026-10-20T08:00:00.000Z', now, 36)).toContain('超过 36 小时')
    expect(freshnessProblem('2026-10-23T08:00:00.000Z', now, 36)).toContain('未来')
  })
})

describe('extractNumbers：抽什么、不抽什么', () => {
  it('千分位、小数、百分比、万、多万', () => {
    const tokens = extractNumbers('共 33,721 条，中位数 4.68，贵 12.5%，月租约 2.8 万，一年差 20 多万', 'body')
    expect(tokens.map((t) => [t.raw, t.value, t.decimals, t.unit])).toEqual([
      ['33,721', 33721, 0, null],
      ['4.68', 4.68, 2, null],
      ['12.5', 12.5, 1, '%'],
      ['2.8', 2.8, 1, '万'],
      ['20', 20, 0, '多万'],
    ])
  })

  it('范围两端各算一个数', () => {
    expect(extractNumbers('多数在 3.70–6.38 元，100-200㎡', 'body').map((t) => t.value)).toEqual([3.7, 6.38, 100, 200])
  })

  it('日期、时刻、地铁线、第 N、跟在字母后的数、0–10 的计数都不核对', () => {
    const text = '截至 2026 年 10 月 22 日 14:53，2026-10-22，地铁 14 号线，第 41 位，Q4、P25，3 条建议，5 个面积段'
    expect(extractNumbers(text, 'body')).toEqual([])
    // strict 模式下小整数也要核
    expect(extractNumbers('3 条建议', 'body', { strict: true }).map((t) => t.value)).toEqual([3])
  })

  it('约 / 近 等前缀记为近似', () => {
    expect(one('近 2,900 条').approx).toBe(true)
    expect(one('有 2,900 条').approx).toBe(false)
  })
})

describe('tokenMatches：写法上的正常取整放行，算错的拦下', () => {
  it('小数按写出来的位数取整', () => {
    expect(tokenMatches(one('约 4.7 元'), [4.68])).toBe(true)
    expect(tokenMatches(one('6.80 元'), [6.8])).toBe(true)
    expect(tokenMatches(one('4.6 元'), [4.68])).toBe(false)
  })

  it('整数（条数）必须完全相等，带「近」才按末尾 0 取整', () => {
    expect(tokenMatches(one('共 33,721 条'), [33721])).toBe(true)
    expect(tokenMatches(one('共 33,720 条'), [33721])).toBe(false)
    expect(tokenMatches(one('近 2,900 条'), [2865])).toBe(true)
    expect(tokenMatches(one('有 2,900 条'), [2865])).toBe(false)
  })

  it('百分比：value 或 value×100，整数写法四舍五入', () => {
    expect(tokenMatches(one('贵 12.5%'), [12.5])).toBe(true)
    expect(tokenMatches(one('占 8.5%'), [0.085])).toBe(true)
    expect(tokenMatches(one('贵 13%'), [12.5])).toBe(true)
    // 2026-10-21 那篇的真实错误：3.96 ÷ 3.52 是贵 12.5%，写成了 18%
    expect(tokenMatches(one('贵 18%'), [12.5, 3.96, 3.52])).toBe(false)
  })

  it('万 与 多万', () => {
    expect(tokenMatches(one('约 2.8 万'), [28080])).toBe(true)
    expect(tokenMatches(one('差了 18 万'), [178560])).toBe(true)
    expect(tokenMatches(one('差了 20 万'), [178560])).toBe(false)
    expect(tokenMatches(one('差了 20 多万'), [214000])).toBe(true)
    expect(tokenMatches(one('差了 20 多万'), [178560])).toBe(false)
  })
})

describe('checkNumbers', () => {
  it('返回核对总数与找不到出处的数（带来源与上下文）', () => {
    const result = checkNumbers(
      [
        { source: 'title', text: '13 万条房源拆完' },
        { source: 'body', text: '一共 33,721 条，中位数 4.68' },
      ],
      file([
        { key: 'total', value: 33721 },
        { key: 'median', value: 4.68 },
      ]),
    )
    expect(result.checked).toBe(3)
    expect(result.unmatched.map((t) => [t.source, t.raw, t.context])).toEqual([['title', '13', '13 万条房源拆完']])
  })
})
