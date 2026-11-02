/**
 * 运营维护的搜索别名：录入规则。
 *
 * 别名只影响「词项 → 实体」的解析；规则的目的是挡住会把检索搞坏的录入——
 * 单字别名（命中一大片）、与规范名相同（无意义）、纯标点 / 空白。
 */

import { describe, expect, it } from 'vitest'

import { ALIAS_MAX_LENGTH, ALIAS_MIN_LENGTH, validateSearchAlias } from '@/domain/search/alias-rules'

describe('validateSearchAlias', () => {
  it('合法别名通过', () => {
    expect(validateSearchAlias('上海国金中心', '国金')).toBe(true)
    expect(validateSearchAlias('上海国金中心', 'IFC')).toBe(true)
    expect(validateSearchAlias('陆家嘴', '小陆')).toBe(true)
  })

  it('空白与纯标点不行', () => {
    expect(validateSearchAlias('陆家嘴', '')).not.toBe(true)
    expect(validateSearchAlias('陆家嘴', '   ')).not.toBe(true)
    expect(validateSearchAlias('陆家嘴', '——')).not.toBe(true)
  })

  it(`短于 ${ALIAS_MIN_LENGTH} 个字不行（单字会命中一大片）`, () => {
    expect(validateSearchAlias('陆家嘴', '陆')).not.toBe(true)
    expect(validateSearchAlias('上海国金中心', 'i')).not.toBe(true)
  })

  it(`长于 ${ALIAS_MAX_LENGTH} 个字不行（别名是简称，不是句子）`, () => {
    expect(validateSearchAlias('陆家嘴', '陆'.repeat(ALIAS_MAX_LENGTH + 1))).not.toBe(true)
    expect(validateSearchAlias('陆家嘴', '陆家'.repeat(ALIAS_MAX_LENGTH / 2))).toBe(true)
  })

  it('与规范名相同不行（比较键：NFKC、小写、去空白）', () => {
    expect(validateSearchAlias('上海国金中心', '上海国金中心')).not.toBe(true)
    expect(validateSearchAlias('上海国金中心', '上海 国金 中心')).not.toBe(true)
    expect(validateSearchAlias('IFC Tower', 'ifctower')).not.toBe(true)
  })

  it('返回的是可直接展示给运营的中文原因', () => {
    expect(validateSearchAlias('陆家嘴', '陆')).toMatch(/至少/)
    expect(validateSearchAlias('陆家嘴', '陆家嘴')).toMatch(/相同/)
  })
})
