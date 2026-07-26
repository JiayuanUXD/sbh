import { describe, expect, it } from 'vitest'

import {
  DUPLICATE_REASONS,
  PROXIMITY_THRESHOLD_METERS,
  detectDuplicates,
  haversineMeters,
  matchDuplicate,
  normalizeBuildingName,
} from '@/domain/supply/building-dedup'

/**
 * M3.2 楼盘重复检测纯函数单测（tasks.md M3.2 / R3, R8）
 *
 * 口径（已确认决策）：同城前提下，「归一化同名 OR 100 米内」任一命中即高相似候选。
 * 城市相等由查询层保证（只把同城候选传入），纯函数只判名称 + 地理邻近。
 */

describe('building-dedup/normalizeBuildingName', () => {
  it('去首尾空格并折叠内部空白', () => {
    expect(normalizeBuildingName('  环球  金融   中心 ')).toBe('环球金融中心')
  })

  it('全角字母数字 → 半角', () => {
    expect(normalizeBuildingName('ＳＯＨＯ３Ｑ')).toBe('soho3q')
  })

  it('英文大小写归一为小写', () => {
    expect(normalizeBuildingName('Jing An Kerry Centre')).toBe('jingankerrycentre')
  })

  it('非字符串输入 → 空串', () => {
    expect(normalizeBuildingName(null)).toBe('')
    expect(normalizeBuildingName(undefined)).toBe('')
    expect(normalizeBuildingName(123)).toBe('')
  })
})

describe('building-dedup/haversineMeters', () => {
  it('同点距离为 0', () => {
    expect(haversineMeters({ lat: 31.23, lng: 121.47 }, { lat: 31.23, lng: 121.47 })).toBe(0)
  })

  it('约百米量级距离落在合理范围', () => {
    // 上海纬度处经度 0.001° ≈ 95 米
    const d = haversineMeters({ lat: 31.23, lng: 121.47 }, { lat: 31.23, lng: 121.471 })
    expect(d).toBeGreaterThan(80)
    expect(d).toBeLessThan(110)
  })
})

describe('building-dedup/matchDuplicate', () => {
  it('归一化同名 → 命中 SAME_NAME', () => {
    const m = matchDuplicate(
      { name: '环球 金融中心', latitude: null, longitude: null },
      { id: 7, name: '环球金融中心', latitude: null, longitude: null },
    )
    expect(m).not.toBeNull()
    expect(m?.reasons).toContain(DUPLICATE_REASONS.SAME_NAME)
    expect(m?.id).toBe(7)
  })

  it('异名但 100 米内 → 命中 PROXIMITY，带距离', () => {
    const m = matchDuplicate(
      { name: 'A 座', latitude: 31.23, longitude: 121.47 },
      { id: 8, name: 'B 座', latitude: 31.23, longitude: 121.4705 },
    )
    expect(m?.reasons).toEqual([DUPLICATE_REASONS.PROXIMITY])
    expect(m?.distanceMeters).not.toBeNull()
    expect(m?.distanceMeters as number).toBeLessThanOrEqual(PROXIMITY_THRESHOLD_METERS)
  })

  it('同名且邻近 → 两个原因都命中', () => {
    const m = matchDuplicate(
      { name: '中心', latitude: 31.23, longitude: 121.47 },
      { id: 9, name: '中心', latitude: 31.23, longitude: 121.47 },
    )
    expect(m?.reasons).toContain(DUPLICATE_REASONS.SAME_NAME)
    expect(m?.reasons).toContain(DUPLICATE_REASONS.PROXIMITY)
  })

  it('异名且超 100 米 → 不命中', () => {
    const m = matchDuplicate(
      { name: 'A 座', latitude: 31.23, longitude: 121.47 },
      { id: 10, name: 'B 座', latitude: 31.24, longitude: 121.48 },
    )
    expect(m).toBeNull()
  })

  it('异名且任一方缺坐标 → 无邻近判据，不命中', () => {
    const m = matchDuplicate(
      { name: 'A 座', latitude: null, longitude: null },
      { id: 11, name: 'B 座', latitude: 31.23, longitude: 121.47 },
    )
    expect(m).toBeNull()
  })

  it('空名（归一化后为空）不作同名判据', () => {
    const m = matchDuplicate(
      { name: '   ', latitude: null, longitude: null },
      { id: 12, name: '   ', latitude: null, longitude: null },
    )
    expect(m).toBeNull()
  })
})

describe('building-dedup/detectDuplicates', () => {
  const input = { name: '环球金融中心', latitude: 31.23, longitude: 121.47 }
  const candidates = [
    { id: 1, name: '环球金融中心', latitude: null, longitude: null }, // 同名
    { id: 2, name: '恒隆广场', latitude: 31.23, longitude: 121.4705 }, // 邻近
    { id: 3, name: '恒隆广场', latitude: 31.5, longitude: 121.9 }, // 均不命中
  ]

  it('返回全部命中候选，异名远距离被过滤', () => {
    const out = detectDuplicates(input, candidates)
    expect(out.map((c) => c.id)).toEqual([1, 2])
  })

  it('无命中 → 空数组', () => {
    const out = detectDuplicates(input, [
      { id: 3, name: '恒隆广场', latitude: 31.5, longitude: 121.9 },
    ])
    expect(out).toEqual([])
  })
})
