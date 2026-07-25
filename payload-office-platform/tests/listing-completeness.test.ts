import { describe, it, expect } from 'vitest'

import {
  checkListingCompleteness,
  DRAFT_REQUIRED_FIELDS,
  SUBMIT_REQUIRED_FIELDS,
  type ListingCompletenessSnapshot,
} from '@/domain/review/listing-completeness'

/** 构造一个「提交审核完全合格」的房源快照;各用例按需拆字段制造缺失。 */
function fullSnapshot(): ListingCompletenessSnapshot {
  return {
    title: '国贸三期 3801',
    slug: 'guomao-3-3801',
    listingType: 'traditional-office',
    building: 12,
    businessType: 'lease',
    decorationStatus: 'fully_fitted',
    price: { amount: 8.5, currency: 'CNY', period: 'month', unit: 'sqm' },
    area: 320.5,
    floor: '38',
    minimumLeaseMonths: 12,
    paymentTerms: '押二付三',
    availableFrom: '2026-08-01T00:00:00.000Z',
    description: '甲级写字楼,视野开阔。',
    contactBroker: 7,
    galleryCount: 3,
    hasValidMerchantRelation: true,
  }
}

describe('checkListingCompleteness — 草稿最小校验', () => {
  it('仅有标题/楼盘/房源类型即可保存草稿', () => {
    const r = checkListingCompleteness(
      { title: '临时房源', building: 1, listingType: 'traditional-office' },
      'draft',
    )
    expect(r.mode).toBe('draft')
    expect(r.complete).toBe(true)
    expect(r.missing).toHaveLength(0)
    expect(r.score).toBe(100)
  })

  it('草稿缺标题时不合格并定位到 title', () => {
    const r = checkListingCompleteness({ building: 1, listingType: 'traditional-office' }, 'draft')
    expect(r.complete).toBe(false)
    expect(r.missing.map((m) => m.field)).toContain('title')
  })

  it('草稿不因缺价格/图片/商户而失败(那些是提交门槛)', () => {
    const r = checkListingCompleteness(
      { title: 'x', building: 1, listingType: 'traditional-office' },
      'draft',
    )
    expect(r.missing.map((m) => m.field)).not.toContain('price')
    expect(r.missing.map((m) => m.field)).not.toContain('gallery')
    expect(r.missing.map((m) => m.field)).not.toContain('merchant')
  })

  it('空对象草稿定位全部最小必填项', () => {
    const r = checkListingCompleteness({}, 'draft')
    expect(r.complete).toBe(false)
    expect(r.missing.map((m) => m.field).sort()).toEqual([...DRAFT_REQUIRED_FIELDS].sort())
  })
})

describe('checkListingCompleteness — 提交审核完整校验', () => {
  it('完全合格快照提交通过,分数 100', () => {
    const r = checkListingCompleteness(fullSnapshot(), 'submit')
    expect(r.mode).toBe('submit')
    expect(r.complete).toBe(true)
    expect(r.missing).toHaveLength(0)
    expect(r.score).toBe(100)
  })

  it('缺文本必填项逐一定位', () => {
    const snap = fullSnapshot()
    delete (snap as Record<string, unknown>).paymentTerms
    snap.floor = ''
    const r = checkListingCompleteness(snap, 'submit')
    expect(r.complete).toBe(false)
    const fields = r.missing.map((m) => m.field)
    expect(fields).toContain('paymentTerms')
    expect(fields).toContain('floor')
  })

  it('价格金额为 0 或非法时定位到 price', () => {
    const snap = fullSnapshot()
    snap.price = { amount: 0, currency: 'CNY', period: 'month', unit: 'sqm' }
    const r = checkListingCompleteness(snap, 'submit')
    expect(r.missing.map((m) => m.field)).toContain('price')
  })

  it('价格周期/单位非法时定位到 price', () => {
    const snap = fullSnapshot()
    snap.price = {
      amount: 5,
      currency: 'CNY',
      period: 'week' as never,
      unit: 'sqm',
    }
    const r = checkListingCompleteness(snap, 'submit')
    expect(r.missing.map((m) => m.field)).toContain('price')
  })

  it('缺价格对象时定位到 price', () => {
    const snap = fullSnapshot()
    delete (snap as Record<string, unknown>).price
    const r = checkListingCompleteness(snap, 'submit')
    expect(r.missing.map((m) => m.field)).toContain('price')
  })

  it('图片少于 3 张时定位到 gallery', () => {
    const snap = fullSnapshot()
    snap.galleryCount = 2
    const r = checkListingCompleteness(snap, 'submit')
    expect(r.complete).toBe(false)
    const item = r.missing.find((m) => m.field === 'gallery')
    expect(item).toBeDefined()
    expect(item!.reason).toContain('3')
  })

  it('无有效商户关系时定位到 merchant', () => {
    const snap = fullSnapshot()
    snap.hasValidMerchantRelation = false
    const r = checkListingCompleteness(snap, 'submit')
    expect(r.missing.map((m) => m.field)).toContain('merchant')
  })

  it('面积非法(负/多小数)时定位到 area', () => {
    const snap = fullSnapshot()
    snap.area = -5
    const r = checkListingCompleteness(snap, 'submit')
    expect(r.missing.map((m) => m.field)).toContain('area')
  })

  it('分数按满足项占比计算,介于 0 与 100 之间', () => {
    const snap = fullSnapshot()
    snap.hasValidMerchantRelation = false
    snap.galleryCount = 0
    const r = checkListingCompleteness(snap, 'submit')
    expect(r.score).toBeGreaterThan(0)
    expect(r.score).toBeLessThan(100)
  })

  it('每个缺失项都带中文标签', () => {
    const r = checkListingCompleteness({}, 'submit')
    for (const item of r.missing) {
      expect(typeof item.label).toBe('string')
      expect(item.label.length).toBeGreaterThan(0)
    }
  })

  it('SUBMIT_REQUIRED_FIELDS 是 DRAFT_REQUIRED_FIELDS 的超集', () => {
    for (const f of DRAFT_REQUIRED_FIELDS) {
      expect(SUBMIT_REQUIRED_FIELDS).toContain(f)
    }
  })
})
