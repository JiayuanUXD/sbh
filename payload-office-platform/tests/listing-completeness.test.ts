/**
 * 房源完整度计算测试（tasks.md M7.4 / R4）
 *
 * 覆盖：
 *   - 完整字段 → score = 1.0 / belowThreshold = false
 *   - 关键字段缺失（gallery / price / area）→ belowThreshold = true
 *   - gallery 部分填充按比例计分
 *   - description 是 Lexical 对象 / string / array 都能识别
 *   - 关系字段（building / coverImage）支持 ID / 对象两种形态
 *   - 空文档 → score = 0
 *   - 阈值边界：score == 0.8 不算 below
 */

import { describe, expect, it } from 'vitest'

import {
  COMPLETENESS_THRESHOLD,
  COMPLETENESS_WEIGHTS,
  computeListingCompleteness,
} from '@/domain/analytics/queries/listing-completeness'

// ────────────────────────────────────────────────────────────
// fixtures
// ────────────────────────────────────────────────────────────

function makeFullDoc(): Record<string, unknown> {
  return {
    title: '陆家嘴中心办公室',
    slug: 'lujiazui-center-office',
    listingType: 'traditional-office',
    building: 1,
    businessType: 'lease',
    decorationStatus: 'furnished',
    price: {
      amount: 8000,
      currency: 'CNY',
      period: 'month',
      unit: 'sqm',
    },
    area: 120,
    minimumLeaseMonths: 12,
    coverImage: 10,
    gallery: [{ image: 1 }, { image: 2 }, { image: 3 }],
    highlights: [{ text: '落地窗' }],
    description: { root: { children: [{ type: 'paragraph' }] } },
  }
}

// ────────────────────────────────────────────────────────────
// 1. 完整文档
// ────────────────────────────────────────────────────────────

describe('computeListingCompleteness', () => {
  it('完整文档 → score=1 / belowThreshold=false', () => {
    const result = computeListingCompleteness(makeFullDoc())
    expect(result.score).toBe(1)
    expect(result.belowThreshold).toBe(false)
  })

  it('空文档 → score=0 / belowThreshold=true', () => {
    const result = computeListingCompleteness({})
    expect(result.score).toBe(0)
    expect(result.belowThreshold).toBe(true)
  })

  it('阈值边界：score 刚好等于 0.8 不算 below', () => {
    // 缺失内容补充 0.2（highlights + description）
    const doc = makeFullDoc()
    delete doc.highlights
    delete doc.description
    const result = computeListingCompleteness(doc)
    expect(result.score).toBe(0.8)
    expect(result.belowThreshold).toBe(false)
  })

  it('阈值边界：score 0.75 算 below', () => {
    // 缺失 highlights(0.1) + description(0.1) + businessType(0.025) + decorationStatus(0.025)
    // = 1 - 0.25 = 0.75 < 0.8
    const doc = makeFullDoc()
    delete doc.highlights
    delete doc.description
    delete doc.businessType
    delete doc.decorationStatus
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeLessThan(COMPLETENESS_THRESHOLD)
    expect(result.belowThreshold).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// 2. 媒体展示
// ────────────────────────────────────────────────────────────

describe('媒体展示', () => {
  it('gallery 缺失 → score=0.8（损失 0.2 权重，刚到阈值）', () => {
    const doc = makeFullDoc()
    delete doc.gallery
    const result = computeListingCompleteness(doc)
    expect(result.score).toBe(0.8)
    expect(result.belowThreshold).toBe(false)
  })

  it('gallery + coverImage 都缺失 → belowThreshold=true（损失 0.3）', () => {
    const doc = makeFullDoc()
    delete doc.gallery
    delete doc.coverImage
    const result = computeListingCompleteness(doc)
    expect(result.score).toBe(0.7)
    expect(result.belowThreshold).toBe(true)
  })

  it('gallery 部分填充（2/3）→ 按比例计分', () => {
    const doc = makeFullDoc()
    doc.gallery = [{ image: 1 }, { image: 2 }] // 2 张
    const result = computeListingCompleteness(doc)
    // gallery 部分计分 = (2/3) * 0.2 ≈ 0.133
    const expectedGalleryScore = (2 / 3) * COMPLETENESS_WEIGHTS.galleryCount
    expect(result.score).toBeCloseTo(
      1 - COMPLETENESS_WEIGHTS.galleryCount + expectedGalleryScore,
      3,
    )
  })

  it('gallery 4 张（超过 min）→ 计满 0.2', () => {
    const doc = makeFullDoc()
    doc.gallery = [{ image: 1 }, { image: 2 }, { image: 3 }, { image: 4 }]
    const result = computeListingCompleteness(doc)
    expect(result.score).toBe(1)
  })

  it('coverImage 是对象形态 → 正确识别', () => {
    const doc = makeFullDoc()
    doc.coverImage = { id: 10, filename: 'cover.jpg' }
    const result = computeListingCompleteness(doc)
    expect(result.score).toBe(1)
  })

  it('coverImage 是 null → 不计分', () => {
    const doc = makeFullDoc()
    doc.coverImage = null
    const result = computeListingCompleteness(doc)
    expect(result.score).toBe(0.9)
  })
})

// ────────────────────────────────────────────────────────────
// 3. 租赁参数
// ────────────────────────────────────────────────────────────

describe('租赁参数', () => {
  it('价格缺失 → 损失 0.13', () => {
    const doc = makeFullDoc()
    delete doc.price
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - 0.13, 3)
  })

  it('amount=0 → 不计分（视为无效）', () => {
    const doc = makeFullDoc()
    ;(doc.price as Record<string, unknown>).amount = 0
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.priceAmount, 3)
  })

  it('area 缺失 → 损失 0.07', () => {
    const doc = makeFullDoc()
    delete doc.area
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.area, 3)
  })

  it('租赁房源缺 minimumLeaseMonths → 损失租售专属项 0.05', () => {
    const doc = makeFullDoc()
    delete doc.minimumLeaseMonths
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.businessTypeSpecific, 3)
  })

  // --- 出售口径（批次 3 / eng review T13）---------------------------------

  it('出售房源用产权年限顶替租期，满分仍是 1.0', () => {
    const doc = makeFullDoc()
    doc.businessType = 'sale'
    delete doc.minimumLeaseMonths
    doc.propertyRightYears = '50'
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1, 3)
    expect(result.belowThreshold).toBe(false)
  })

  it('出售房源缺产权年限 → 损失租售专属项 0.05（不因缺租期被双重扣分）', () => {
    const doc = makeFullDoc()
    doc.businessType = 'sale'
    delete doc.minimumLeaseMonths
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.businessTypeSpecific, 3)
  })

  it('出售房源填了 minimumLeaseMonths 也不计分（口径不串）', () => {
    const doc = makeFullDoc()
    doc.businessType = 'sale'
    doc.minimumLeaseMonths = 12
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.businessTypeSpecific, 3)
  })
})

// ────────────────────────────────────────────────────────────
// 4. 内容补充（description 多形态）
// ────────────────────────────────────────────────────────────

describe('description 形态', () => {
  it('description 是 string → 正确识别', () => {
    const doc = makeFullDoc()
    doc.description = '一段说明文字'
    const result = computeListingCompleteness(doc)
    expect(result.score).toBe(1)
  })

  it('description 是 lexical 节点数组 → 正确识别', () => {
    const doc = makeFullDoc()
    doc.description = [{ type: 'paragraph', children: [] }]
    const result = computeListingCompleteness(doc)
    expect(result.score).toBe(1)
  })

  it('description 是空字符串 → 不计分', () => {
    const doc = makeFullDoc()
    doc.description = '   '
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.description, 3)
  })

  it('description 是 null → 不计分', () => {
    const doc = makeFullDoc()
    doc.description = null
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.description, 3)
  })

  it('description 是空对象 → 不计分', () => {
    const doc = makeFullDoc()
    doc.description = {}
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.description, 3)
  })
})

// ────────────────────────────────────────────────────────────
// 5. 关系字段形态
// ────────────────────────────────────────────────────────────

describe('关系字段形态', () => {
  it('building 是 number → 计分', () => {
    const doc = makeFullDoc()
    doc.building = 5
    const result = computeListingCompleteness(doc)
    expect(result.score).toBe(1)
  })

  it('building 是对象 → 计分', () => {
    const doc = makeFullDoc()
    doc.building = { id: 5, name: 'A 大厦' }
    const result = computeListingCompleteness(doc)
    expect(result.score).toBe(1)
  })

  it('building 是 null → 不计分', () => {
    const doc = makeFullDoc()
    doc.building = null
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.building, 3)
  })

  it('building 是 0 → 不计分（视为无效 ID）', () => {
    const doc = makeFullDoc()
    doc.building = 0
    const result = computeListingCompleteness(doc)
    expect(result.score).toBeCloseTo(1 - COMPLETENESS_WEIGHTS.building, 3)
  })
})

// ────────────────────────────────────────────────────────────
// 6. 权重总和一致性
// ────────────────────────────────────────────────────────────

describe('权重总和', () => {
  it('所有权重之和 = 1.0', () => {
    const sum = Object.values(COMPLETENESS_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 5)
  })
})
