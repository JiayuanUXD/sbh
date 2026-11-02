import { describe, expect, it } from 'vitest'

import { classifyMissKind, sanitizeMissTerm } from '@/domain/search/miss-term'

describe('sanitizeMissTerm：保留', () => {
  it('普通中文词保留，存的是归一化后的词而不是原始输入', () => {
    expect(sanitizeMissTerm('  静安，整层 ')).toEqual({ kind: 'keep', term: '静安 整层' })
  })

  it('大小写、全角字母被归一', () => {
    expect(sanitizeMissTerm('ＳＯＨＯ')).toEqual({ kind: 'keep', term: 'soho' })
  })

  it('面积 / 价格数字不受影响', () => {
    expect(sanitizeMissTerm('500平')).toEqual({ kind: 'keep', term: '500平' })
    expect(sanitizeMissTerm('3万')).toEqual({ kind: 'keep', term: '3万' })
    expect(sanitizeMissTerm('陆家嘴 12345')).toEqual({ kind: 'keep', term: '陆家嘴 12345' })
  })

  it('恰好 20 码点保留，21 码点丢弃', () => {
    expect(sanitizeMissTerm('字'.repeat(20))).toEqual({ kind: 'keep', term: '字'.repeat(20) })
    expect(sanitizeMissTerm('字'.repeat(21))).toEqual({ kind: 'drop', reason: 'too_long' })
  })

  it('按码点而不是 UTF-16 单元计长：20 个扩展区汉字保留', () => {
    const rare = '𠮷'.repeat(20)
    expect(rare.length).toBe(40)
    expect(sanitizeMissTerm(rare)).toEqual({ kind: 'keep', term: rare })
    expect(sanitizeMissTerm('𠮷'.repeat(21))).toEqual({ kind: 'drop', reason: 'too_long' })
  })
})

describe('sanitizeMissTerm：不采（skip）', () => {
  it('空串、纯标点、纯空白', () => {
    expect(sanitizeMissTerm('')).toEqual({ kind: 'skip', reason: 'empty' })
    expect(sanitizeMissTerm('   ')).toEqual({ kind: 'skip', reason: 'empty' })
    expect(sanitizeMissTerm('，。！')).toEqual({ kind: 'skip', reason: 'empty' })
  })

  it('单码点不采，两码点采', () => {
    expect(sanitizeMissTerm('静')).toEqual({ kind: 'skip', reason: 'too_short' })
    expect(sanitizeMissTerm('a')).toEqual({ kind: 'skip', reason: 'too_short' })
    expect(sanitizeMissTerm('𠮷')).toEqual({ kind: 'skip', reason: 'too_short' })
    expect(sanitizeMissTerm('静安')).toEqual({ kind: 'keep', term: '静安' })
  })
})

describe('sanitizeMissTerm：丢弃并计原因', () => {
  it.each([
    'a@b.com',
    'foo@bar',
    'ａ＠ｂ',
    'https://x.com',
    'HTTP://X',
    'http静安',
    'www.baidu.com',
    'WWW.foo',
    'baidu.com',
    'baidu。com',
    'baidu．cn',
    'foo.net/bar',
    '联系我 abc.io',
  ])('联系方式 / 网址：%s', (raw) => {
    expect(sanitizeMissTerm(raw)).toEqual({ kind: 'drop', reason: 'contact' })
  })

  it('域名后缀只在是后缀时命中，不误伤普通词', () => {
    expect(sanitizeMissTerm('company')).toEqual({ kind: 'keep', term: 'company' })
    expect(sanitizeMissTerm('a.company')).toEqual({ kind: 'keep', term: 'a company' })
    expect(sanitizeMissTerm('cn大厦')).toEqual({ kind: 'keep', term: 'cn大厦' })
  })

  it('连续数字：5 位保留，6 位丢弃', () => {
    expect(sanitizeMissTerm('12345')).toEqual({ kind: 'keep', term: '12345' })
    expect(sanitizeMissTerm('123456')).toEqual({ kind: 'drop', reason: 'digits' })
    expect(sanitizeMissTerm('13812345678')).toEqual({ kind: 'drop', reason: 'digits' })
  })

  it('全角数字先 NFKC 再判', () => {
    expect(sanitizeMissTerm('１３８１２３４５６７８')).toEqual({ kind: 'drop', reason: 'digits' })
    expect(sanitizeMissTerm('１２３４５')).toEqual({ kind: 'keep', term: '12345' })
  })

  it('夹在中文里的长数字也丢', () => {
    expect(sanitizeMissTerm('找张三 13812345678')).toEqual({ kind: 'drop', reason: 'digits' })
  })

  it('用空格 / 连字符分段的电话号码丢弃（归一化会把连字符变空格，所以必须在原文上判）', () => {
    expect(sanitizeMissTerm('138 1234 5678')).toEqual({ kind: 'drop', reason: 'digits' })
    expect(sanitizeMissTerm('138-1234-5678')).toEqual({ kind: 'drop', reason: 'digits' })
    expect(sanitizeMissTerm('021-12345678')).toEqual({ kind: 'drop', reason: 'digits' })
  })

  it('面积区间这类短分段数字不误伤', () => {
    expect(sanitizeMissTerm('100-200平')).toEqual({ kind: 'keep', term: '100 200平' })
  })

  it('判定优先级：联系方式 > 数字 > 过长', () => {
    expect(sanitizeMissTerm('a@b.com 13812345678')).toEqual({ kind: 'drop', reason: 'contact' })
    expect(sanitizeMissTerm('字'.repeat(30) + '13812345678')).toEqual({ kind: 'drop', reason: 'digits' })
  })

  it('整句粘贴丢弃', () => {
    expect(sanitizeMissTerm('我想在浦东找一个两百平米的办公室预算不超过五万')).toEqual({
      kind: 'drop',
      reason: 'too_long',
    })
  })

  it('丢弃结果里不带任何文本', () => {
    const result = sanitizeMissTerm('a@b.com')
    expect(JSON.stringify(result)).not.toContain('b.com')
  })
})

describe('classifyMissKind', () => {
  const counts = (listings: number, buildings: number, news: number) => ({ listings, buildings, news })

  it('三类结果全 0 → zero', () => {
    expect(classifyMissKind({ counts: counts(0, 0, 0), relaxed: false })).toBe('zero')
  })

  it('楼盘有命中、在租房源为 0 → entity-no-supply（资讯命中不影响）', () => {
    expect(classifyMissKind({ counts: counts(0, 2, 0), relaxed: false })).toBe('entity-no-supply')
    expect(classifyMissKind({ counts: counts(0, 2, 5), relaxed: false })).toBe('entity-no-supply')
  })

  it('放宽后才有房源 → relaxed', () => {
    expect(classifyMissKind({ counts: counts(3, 0, 0), relaxed: true })).toBe('relaxed')
  })

  it('只有资讯命中 → 不是房源 / 楼盘的缺口，不采', () => {
    expect(classifyMissKind({ counts: counts(0, 0, 4), relaxed: false })).toBeNull()
  })

  it('正常命中 → 不采', () => {
    expect(classifyMissKind({ counts: counts(3, 1, 0), relaxed: false })).toBeNull()
  })
})
