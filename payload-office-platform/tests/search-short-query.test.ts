/**
 * 单字查询：归一化后只有一个词项、且只有一个码点，不查库、不当零结果。
 *
 * 背景：Umami 近 30 天长度为 1 的查询返回 4289 条，最多一次 16439 条（991 个楼盘），
 * 是纯噪音。多词里带单字（「陆家嘴 楼」）不算——另一个词会把结果收窄。
 */

import { describe, expect, it } from 'vitest'

import { normalizeSearchQuery } from '@/domain/search/normalize'
import { isTooShortQuery } from '@/domain/search/short-query'

const short = (raw: string) => isTooShortQuery(normalizeSearchQuery(raw))

describe('isTooShortQuery', () => {
  it.each(['路', '楼', 'a', '5', '１', '  楼  ', '楼!'])('单字 %j 算过短', (raw) => {
    expect(short(raw)).toBe(true)
  })

  it.each(['陆家', 'ab', '12', '陆家嘴', '陆家嘴 楼', '楼 路'])('%j 不算过短', (raw) => {
    expect(short(raw)).toBe(false)
  })

  it('空输入不算过短（由「没有查询」分支处理）', () => {
    expect(short('')).toBe(false)
    expect(short('   ')).toBe(false)
    expect(short('!!!')).toBe(false)
    // emoji 被归一化当标点，整条查询为空，不是「单字」
    expect(short('😀')).toBe(false)
  })
})
