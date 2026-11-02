/**
 * 中文长句分词：用词表最长匹配把已知实体（楼盘 / 商圈 / 地铁 / 行政区及其别名）
 * 从没有空格的长串里切出来，剩下的片段去掉口水词后作为普通词项。
 *
 * 背景：Umami 近 30 天零结果的查询全是 7–8 字的长串，放宽逻辑对单个词项无从下手。
 * 不引入通用分词库——只用词表，成本低、可控，没有命中实体就原样放行。
 */

import { describe, expect, it } from 'vitest'

import { segmentSearchTerms } from '@/domain/search/segment'

import { testVocabulary } from './search-fixtures'

const seg = (terms: string[]) => segmentSearchTerms(terms, testVocabulary)

describe('segmentSearchTerms', () => {
  it('长句里切出实体，剩余片段保留为词项', () => {
    const result = seg(['陆家嘴整层办公室'])
    expect(result.terms).toEqual(['陆家嘴', '整层'])
    expect(result.entityTerms).toEqual(['陆家嘴'])
    expect(result.entries.map((entry) => entry.name)).toEqual(['陆家嘴'])
  })

  it('最长匹配优先：静安站不会被切成静安 + 站', () => {
    expect(seg(['静安站附近的写字楼']).terms).toEqual(['静安站'])
  })

  it('中文别名换成规范名，与拼音别名的处理一致', () => {
    const result = seg(['国金中心整层'])
    expect(result.terms).toEqual(['上海国金中心', '整层'])
    expect(result.entityTerms).toEqual(['上海国金中心'])
  })

  it('整词就是别名时也归一到规范名', () => {
    expect(seg(['上海中心大厦']).terms).toEqual(['上海中心'])
  })

  it('实体在中间或有多个实体时按出现顺序输出', () => {
    expect(seg(['整层陆家嘴办公室']).terms).toEqual(['整层', '陆家嘴'])
    const two = seg(['陆家嘴和静安'])
    expect(two.terms).toEqual(['陆家嘴', '静安'])
    expect(two.entityTerms).toEqual(['陆家嘴', '静安'])
  })

  it('剩余片段去掉口水词，单字片段丢弃', () => {
    expect(seg(['陆家嘴办公室']).terms).toEqual(['陆家嘴'])
    expect(seg(['陆家嘴的']).terms).toEqual(['陆家嘴'])
    expect(seg(['陆家嘴楼']).terms).toEqual(['陆家嘴'])
    expect(seg(['我想找陆家嘴出租的写字楼']).terms).toEqual(['陆家嘴'])
  })

  it('口水词只按整词删，不会误伤「租金」', () => {
    expect(seg(['陆家嘴租金']).terms).toEqual(['陆家嘴', '租金'])
  })

  it('没有命中任何实体就原样放行，不剥口水词', () => {
    expect(seg(['整层办公室']).terms).toEqual(['整层办公室'])
    expect(seg(['整层办公室']).entityTerms).toEqual([])
  })

  it('不足 4 个字的词项不切分（2–3 字本身就是名称）', () => {
    expect(seg(['陆家嘴']).terms).toEqual(['陆家嘴'])
    expect(seg(['长宁']).terms).toEqual(['长宁'])
  })

  it('含拉丁字母 / 数字的词项不动', () => {
    expect(seg(['ifc整层']).terms).toEqual(['ifc整层'])
    expect(seg(['lujiazui']).terms).toEqual(['lujiazui'])
    expect(seg(['500平']).terms).toEqual(['500平'])
  })

  it('多个词项逐个处理，整体去重', () => {
    expect(seg(['陆家嘴整层办公室', '租金']).terms).toEqual(['陆家嘴', '整层', '租金'])
    expect(seg(['陆家嘴', '陆家嘴整层']).terms).toEqual(['陆家嘴', '整层'])
  })

  it('不修改输入数组', () => {
    const terms = ['陆家嘴整层办公室']
    seg(terms)
    expect(terms).toEqual(['陆家嘴整层办公室'])
  })
})
