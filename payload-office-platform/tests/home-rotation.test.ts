import { describe, expect, it } from 'vitest'

import {
  diversify,
  rotationBucket,
  rotationSeed,
  seededShuffle,
} from '@/domain/public-catalog/rotation'

/** 构造带分组键的假条目：group 同时进 label，便于断言。 */
function items(count: number, groups: readonly string[]) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    label: `${groups[index % groups.length]}-${index + 1}`,
    group: groups[index % groups.length]!,
  }))
}

const groupOf = (item: { group: string }) => item.group

describe('rotationBucket', () => {
  const day = 24 * 60 * 60 * 1000
  // 北京时间 2026-10-20 00:00 = UTC 2026-10-19 16:00
  const beijingMidnight = Date.UTC(2026, 9, 19, 16, 0, 0)

  it('桶边界对齐北京时间零点：同一天内数值相同', () => {
    expect(rotationBucket(beijingMidnight)).toBe(rotationBucket(beijingMidnight + day - 1))
  })

  it('北京零点跨天递增 1', () => {
    expect(rotationBucket(beijingMidnight + day)).toBe(rotationBucket(beijingMidnight) + 1)
  })

  it('UTC 零点（北京 08:00）不是边界', () => {
    const utcMidnight = Date.UTC(2026, 9, 20, 0, 0, 0) // 北京 08:00
    expect(rotationBucket(utcMidnight - 1)).toBe(rotationBucket(utcMidnight))
  })

  it('支持自定义桶宽', () => {
    const hour = 60 * 60 * 1000
    expect(rotationBucket(beijingMidnight + hour, 1)).toBe(rotationBucket(beijingMidnight, 1) + 1)
    expect(rotationBucket(beijingMidnight + hour, 24)).toBe(rotationBucket(beijingMidnight, 24))
  })
})

describe('rotationSeed', () => {
  it('同城市同桶稳定、不同桶不同', () => {
    expect(rotationSeed('shanghai', 100)).toBe(rotationSeed('shanghai', 100))
    expect(rotationSeed('shanghai', 100)).not.toBe(rotationSeed('shanghai', 101))
    expect(rotationSeed('shanghai', 100)).not.toBe(rotationSeed('beijing', 100))
  })
})

describe('seededShuffle', () => {
  const list = items(24, ['a', 'b', 'c', 'd'])

  it('同种子结果一致，且不修改输入', () => {
    const snapshot = [...list]
    const first = seededShuffle(list, 42)
    const second = seededShuffle(list, 42)
    expect(first.map((i) => i.id)).toEqual(second.map((i) => i.id))
    expect(list).toEqual(snapshot)
  })

  it('不同种子给出不同排列（固定用例）', () => {
    const a = seededShuffle(list, 1).map((i) => i.id)
    const b = seededShuffle(list, 2).map((i) => i.id)
    expect(a).not.toEqual(b)
  })

  it('保持元素集合不变', () => {
    expect(seededShuffle(list, 7).map((i) => i.id).sort((x, y) => x - y))
      .toEqual(list.map((i) => i.id))
  })
})

describe('diversify', () => {
  it('前 N 个固定不动', () => {
    const pool = items(24, ['a', 'b', 'c', 'd'])
    const result = diversify(pool, { take: 8, pinned: 2, maxPerGroup: 2, groupOf, seed: 99 })
    expect(result.slice(0, 2).map((i) => i.id)).toEqual([1, 2])
    expect(result).toHaveLength(8)
  })

  it('同组不超过上限（供给充足时）', () => {
    const pool = items(24, ['a', 'b', 'c', 'd'])
    const result = diversify(pool, { take: 8, pinned: 2, maxPerGroup: 2, groupOf, seed: 99 })
    const perGroup = new Map<string, number>()
    for (const item of result) perGroup.set(item.group, (perGroup.get(item.group) ?? 0) + 1)
    for (const count of perGroup.values()) expect(count).toBeLessThanOrEqual(3)
  })

  it('供给不足时逐级放宽，仍凑满 take', () => {
    // 全部同一组：上限 2 无法满足 8 个，必须放宽
    const pool = items(12, ['only'])
    const result = diversify(pool, { take: 8, pinned: 0, maxPerGroup: 2, groupOf, seed: 5 })
    expect(result).toHaveLength(8)
    expect(new Set(result.map((i) => i.id)).size).toBe(8)
  })

  it('池子小于 take 时全给', () => {
    const pool = items(5, ['a', 'b'])
    const result = diversify(pool, { take: 8, pinned: 2, maxPerGroup: 2, groupOf, seed: 1 })
    expect(result).toHaveLength(5)
  })

  it('pinned 超出上限时不裁剪（运营置顶优先）', () => {
    const pool = items(9, ['only'])
    const result = diversify(pool, { take: 4, pinned: 3, maxPerGroup: 1, groupOf, seed: 1 })
    expect(result.slice(0, 3).map((i) => i.id)).toEqual([1, 2, 3])
    expect(result).toHaveLength(4)
  })

  it('maxPerGroup 超过 take 时等于无约束，仍要填满', () => {
    const pool = items(9, ['a', 'b', 'c'])
    const result = diversify(pool, { take: 4, pinned: 1, maxPerGroup: 10, groupOf, seed: 1 })
    expect(result).toHaveLength(4)
  })

  it('结果确定：同 seed 同输出', () => {
    const pool = items(24, ['a', 'b', 'c', 'd'])
    const options = { take: 8, pinned: 2, maxPerGroup: 2, groupOf, seed: 7 } as const
    expect(diversify(pool, options).map((i) => i.id))
      .toEqual(diversify(pool, options).map((i) => i.id))
  })

  it('不同 seed 输出不同（固定用例）', () => {
    const pool = items(24, ['a', 'b', 'c', 'd'])
    const base = { take: 8, pinned: 2, maxPerGroup: 2, groupOf }
    expect(diversify(pool, { ...base, seed: 11 }).map((i) => i.id))
      .not.toEqual(diversify(pool, { ...base, seed: 12 }).map((i) => i.id))
  })

  it('空池与 take<=0', () => {
    expect(diversify([], { take: 8, pinned: 2, maxPerGroup: 2, groupOf, seed: 1 })).toEqual([])
    expect(diversify(items(4, ['a']), { take: 0, pinned: 0, maxPerGroup: 2, groupOf, seed: 1 })).toEqual([])
  })
})
