import { describe, expect, it } from 'vitest'

import { describeQueryShape, hasEntityWithoutSupply } from '@/domain/search/analytics-shape'

describe('describeQueryShape', () => {
  it('纯汉字：cjk，单个长串只算 1 个词项', () => {
    expect(describeQueryShape('陆家嘴整层办公室')).toEqual({ termCount: 1, script: 'cjk' })
  })

  it('空白与标点分词后计数', () => {
    expect(describeQueryShape('陆家嘴 整层')).toEqual({ termCount: 2, script: 'cjk' })
    expect(describeQueryShape('静安，整层。')).toEqual({ termCount: 2, script: 'cjk' })
  })

  it('纯拉丁字母（含全角、大小写）：latin', () => {
    expect(describeQueryShape('lujiazui')).toEqual({ termCount: 1, script: 'latin' })
    expect(describeQueryShape('ＩＦＣ')).toEqual({ termCount: 1, script: 'latin' })
  })

  it('字母加数字没有汉字：latin', () => {
    expect(describeQueryShape('a1')).toEqual({ termCount: 1, script: 'latin' })
  })

  it('纯数字（含全角）：digit', () => {
    expect(describeQueryShape('500')).toEqual({ termCount: 1, script: 'digit' })
    expect(describeQueryShape('１２３')).toEqual({ termCount: 1, script: 'digit' })
  })

  it('汉字与拉丁或数字混用：mixed', () => {
    expect(describeQueryShape('500平')).toEqual({ termCount: 1, script: 'mixed' })
    expect(describeQueryShape('ifc 国金')).toEqual({ termCount: 2, script: 'mixed' })
  })

  it('既无汉字也无拉丁与数字的字母（假名、西里尔）：other', () => {
    expect(describeQueryShape('こんにちは')).toEqual({ termCount: 1, script: 'other' })
    expect(describeQueryShape('привет')).toEqual({ termCount: 1, script: 'other' })
  })

  it('空输入与纯标点：0 个词项，script 为 none', () => {
    expect(describeQueryShape('')).toEqual({ termCount: 0, script: 'none' })
    expect(describeQueryShape('  ，。 ')).toEqual({ termCount: 0, script: 'none' })
  })

  it('词项数与归一化口径一致：最多 8 个', () => {
    const raw = Array.from({ length: 10 }, (_, index) => `t${index}`).join(' ')
    expect(describeQueryShape(raw).termCount).toBe(8)
  })

  it('不返回任何原文片段', () => {
    const shape = describeQueryShape('陆家嘴整层')
    expect(Object.keys(shape).sort()).toEqual(['script', 'termCount'])
    expect(JSON.stringify(shape)).not.toContain('陆家嘴')
  })
})

describe('hasEntityWithoutSupply', () => {
  it('楼盘有命中、在租房源为 0：true', () => {
    expect(hasEntityWithoutSupply({ listings: 0, buildings: 2 })).toBe(true)
  })

  it('房源有命中：false', () => {
    expect(hasEntityWithoutSupply({ listings: 5, buildings: 2 })).toBe(false)
  })

  it('楼盘也没有命中：false（那是零结果，不是实体无供给）', () => {
    expect(hasEntityWithoutSupply({ listings: 0, buildings: 0 })).toBe(false)
  })

  it('资讯命中不影响判定', () => {
    expect(hasEntityWithoutSupply({ listings: 0, buildings: 1, news: 9 })).toBe(true)
    expect(hasEntityWithoutSupply({ listings: 0, buildings: 0, news: 9 })).toBe(false)
  })
})
