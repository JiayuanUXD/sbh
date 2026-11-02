/**
 * 类目与面积意图：把「整层」「共享办公」「500平」「300-500平」「500平以上」这类词
 * 从查询里抽出来，转成房源已有的筛选（listingType / areaMin / areaMax），剩下的文字
 * 继续走原来的关键词流程。
 *
 * 必须在 L1 归一化**之前**解析：归一化会把「-」「㎡」当标点切掉，「300-500平」会变成
 * 两个无关词项，区间信息就丢了。
 *
 * 价格（「3万以内」）刻意不做：房源价格必须带单位（元/月、元/㎡/天、元/工位/月不可通约），
 * 「3万」没有单位，硬映射会静默漏掉按其它单位标价的房源。
 */

import { describe, expect, it } from 'vitest'

import { extractSearchIntent } from '@/domain/search/intent'

describe('extractSearchIntent', () => {
  it('没有意图词：原样返回，rest 即原文', () => {
    const result = extractSearchIntent('陆家嘴 办公室')
    expect(result).toEqual({ rest: '陆家嘴 办公室', labels: [] })
  })

  it('类型：整层 / 整层办公 → full-floor', () => {
    expect(extractSearchIntent('陆家嘴整层')).toEqual({
      listingType: ['full-floor'],
      rest: '陆家嘴',
      labels: ['整层办公'],
    })
    expect(extractSearchIntent('整层办公 陆家嘴').listingType).toEqual(['full-floor'])
  })

  it('类型：共享办公 / 联合办公 → coworking', () => {
    expect(extractSearchIntent('静安寺共享办公').listingType).toEqual(['coworking'])
    expect(extractSearchIntent('联合办公').listingType).toEqual(['coworking'])
    expect(extractSearchIntent('静安寺共享办公').rest).toBe('静安寺')
  })

  it('「共享」单独出现不算类型（太泛）', () => {
    expect(extractSearchIntent('共享单车').listingType).toBeUndefined()
  })

  it('面积：单值按 ±20% 取区间', () => {
    const result = extractSearchIntent('陆家嘴 500平')
    expect(result.areaMin).toBe(400)
    expect(result.areaMax).toBe(600)
    expect(result.rest).toBe('陆家嘴')
    expect(result.labels).toEqual(['面积约 400–600㎡'])
  })

  it.each(['500平', '500平米', '500平方米', '500㎡', '500m²', '500 平'])('单位写法 %j 都认', (raw) => {
    const result = extractSearchIntent(raw)
    expect(result.areaMin).toBe(400)
    expect(result.areaMax).toBe(600)
    expect(result.rest).toBe('')
  })

  it('面积：以上 / 以下 / 以内', () => {
    expect(extractSearchIntent('500平以上')).toMatchObject({ areaMin: 500, rest: '' })
    expect(extractSearchIntent('500平以上').areaMax).toBeUndefined()
    expect(extractSearchIntent('300平以内')).toMatchObject({ areaMax: 300, rest: '' })
    expect(extractSearchIntent('300平以内').areaMin).toBeUndefined()
    expect(extractSearchIntent('300平以下').areaMax).toBe(300)
  })

  it('面积：大于 / 超过 / 至少；小于 / 不超过 / 最多', () => {
    expect(extractSearchIntent('超过500平').areaMin).toBe(500)
    expect(extractSearchIntent('至少500平').areaMin).toBe(500)
    expect(extractSearchIntent('不超过300平').areaMax).toBe(300)
    expect(extractSearchIntent('最多300平').areaMax).toBe(300)
    expect(extractSearchIntent('超过500平').rest).toBe('')
  })

  it('面积：区间，分隔符 - ~ 到 至 都认，单位在第二个数后面', () => {
    for (const raw of ['300-500平', '300~500平', '300到500平', '300至500平', '300－500㎡']) {
      const result = extractSearchIntent(raw)
      expect(result.areaMin).toBe(300)
      expect(result.areaMax).toBe(500)
      expect(result.rest).toBe('')
    }
    expect(extractSearchIntent('300-500平').labels).toEqual(['面积 300–500㎡'])
  })

  it('区间两端颠倒时自动排好', () => {
    const result = extractSearchIntent('500-300平')
    expect(result.areaMin).toBe(300)
    expect(result.areaMax).toBe(500)
  })

  it('类型与面积可以同时出现，剩余文字保留', () => {
    const result = extractSearchIntent('陆家嘴整层 500平以上')
    expect(result.listingType).toEqual(['full-floor'])
    expect(result.areaMin).toBe(500)
    expect(result.rest).toBe('陆家嘴')
  })

  it('不带面积单位的数字不是面积（2号线、500 单独出现）', () => {
    expect(extractSearchIntent('2号线 办公室').areaMin).toBeUndefined()
    expect(extractSearchIntent('500').areaMin).toBeUndefined()
    expect(extractSearchIntent('2号线 办公室').rest).toBe('2号线 办公室')
  })

  it('不合理的数值不当面积：过小 / 过大', () => {
    expect(extractSearchIntent('3平').areaMin).toBeUndefined()
    expect(extractSearchIntent('3平').rest).toBe('3平')
    expect(extractSearchIntent('999999平').areaMin).toBeUndefined()
  })

  it('全角数字与单位先 NFKC 再解析', () => {
    const result = extractSearchIntent('５００平')
    expect(result.areaMin).toBe(400)
    expect(result.areaMax).toBe(600)
  })

  it('只有意图词时 rest 为空串', () => {
    expect(extractSearchIntent('整层').rest).toBe('')
    expect(extractSearchIntent('整层 500平').rest).toBe('')
  })

  it('价格不解析：「3万以内」原样留在 rest', () => {
    const result = extractSearchIntent('陆家嘴 3万以内')
    expect(result.rest).toBe('陆家嘴 3万以内')
    expect(result.labels).toEqual([])
  })

  it('「整层办公室」「共享办公室」整体消费，不留下「室」当关键词', () => {
    expect(extractSearchIntent('整层办公室')).toMatchObject({ listingType: ['full-floor'], rest: '' })
    expect(extractSearchIntent('陆家嘴整层办公室').rest).toBe('陆家嘴')
    expect(extractSearchIntent('共享办公室')).toMatchObject({ listingType: ['coworking'], rest: '' })
    expect(extractSearchIntent('联合办公室').listingType).toEqual(['coworking'])
    expect(extractSearchIntent('静安寺共享办公室').rest).toBe('静安寺')
  })

  it('否定前缀：不小于 / 不低于 / 不少于 是下限，不大于 是上限，且不残留「不」', () => {
    for (const raw of ['不小于500平', '不低于500平', '不少于500平']) {
      const result = extractSearchIntent(raw)
      expect(result.areaMin, raw).toBe(500)
      expect(result.areaMax, raw).toBeUndefined()
      expect(result.rest, raw).toBe('')
    }
    for (const raw of ['不大于300平', '不超过300平', '不高于300平']) {
      const result = extractSearchIntent(raw)
      expect(result.areaMax, raw).toBe(300)
      expect(result.areaMin, raw).toBeUndefined()
      expect(result.rest, raw).toBe('')
    }
  })

  it('肯定写法不受影响：小于 / 低于 / 少于 / 大于 / 高于', () => {
    expect(extractSearchIntent('小于300平').areaMax).toBe(300)
    expect(extractSearchIntent('低于300平').areaMax).toBe(300)
    expect(extractSearchIntent('少于300平').areaMax).toBe(300)
    expect(extractSearchIntent('大于500平').areaMin).toBe(500)
    expect(extractSearchIntent('高于500平').areaMin).toBe(500)
  })
})

