import { describe, expect, it } from 'vitest'

import {
  assertValidBoundary,
  normalizeAliases,
} from '@/domain/geography/business-area-extension'
import { DomainError } from '@/domain/shared/errors'

/** 闭合正方形外环（合法简单多边形） */
const SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
}

describe('business-area-extension/normalizeAliases', () => {
  it('空/undefined → 空数组', () => {
    expect(normalizeAliases(undefined)).toEqual([])
    expect(normalizeAliases(null)).toEqual([])
    expect(normalizeAliases([])).toEqual([])
  })

  it('去首尾空格、丢弃空串', () => {
    expect(normalizeAliases([{ alias: '  国贸  ' }, { alias: '   ' }, { alias: '' }])).toEqual([
      { alias: '国贸' },
    ])
  })

  it('按规范化值(小写)去重,保留首次原文', () => {
    expect(normalizeAliases([{ alias: 'CBD' }, { alias: 'cbd' }, { alias: 'Cbd' }])).toEqual([
      { alias: 'CBD' },
    ])
  })

  it('接受纯字符串数组', () => {
    expect(normalizeAliases(['国贸', '大望路'])).toEqual([{ alias: '国贸' }, { alias: '大望路' }])
  })

  it('单项超 50 字抛错', () => {
    expect(() => normalizeAliases([{ alias: 'x'.repeat(51) }])).toThrow(DomainError)
  })

  it('非数组抛错', () => {
    expect(() => normalizeAliases('国贸' as unknown)).toThrow(/别名必须是列表/)
  })

  it('元素非字符串抛错', () => {
    expect(() => normalizeAliases([{ alias: 123 }])).toThrow(DomainError)
  })
})

describe('business-area-extension/assertValidBoundary', () => {
  it('空边界放行', () => {
    expect(() => assertValidBoundary(null)).not.toThrow()
    expect(() => assertValidBoundary(undefined)).not.toThrow()
  })

  it('合法闭合正方形通过', () => {
    expect(() => assertValidBoundary(SQUARE)).not.toThrow()
  })

  it('非 Polygon 类型抛错', () => {
    expect(() => assertValidBoundary({ type: 'Point', coordinates: [0, 0] })).toThrow(
      /Polygon/,
    )
  })

  it('非对象抛错', () => {
    expect(() => assertValidBoundary([1, 2, 3])).toThrow(DomainError)
  })

  it('点数不足 4 抛错', () => {
    expect(() =>
      assertValidBoundary({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      }),
    ).toThrow(/至少需要 4 个坐标点/)
  })

  it('未闭合(首尾不同)抛错', () => {
    expect(() =>
      assertValidBoundary({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
          ],
        ],
      }),
    ).toThrow(/未闭合/)
  })

  it('坐标越界抛错', () => {
    expect(() =>
      assertValidBoundary({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 1],
            [200, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      }),
    ).toThrow(/非法坐标点/)
  })

  it('自交蝴蝶形抛错', () => {
    // 经典自交:0,0 → 1,1 → 1,0 → 0,1 → 0,0 中两条对角边相交
    expect(() =>
      assertValidBoundary({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
            [1, 0],
            [0, 1],
            [0, 0],
          ],
        ],
      }),
    ).toThrow(/自交/)
  })

  it('带合法内环(洞)通过', () => {
    expect(() =>
      assertValidBoundary({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 10],
            [10, 10],
            [10, 0],
            [0, 0],
          ],
          [
            [2, 2],
            [2, 4],
            [4, 4],
            [4, 2],
            [2, 2],
          ],
        ],
      }),
    ).not.toThrow()
  })
})
