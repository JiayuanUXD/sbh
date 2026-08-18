/**
 * 提交审核完整度校验单测（domain/review/listing-completeness.ts）
 *
 * 这个函数决定一套房源能不能进审核队列，此前零测试覆盖。出售模式要求必填项按
 * businessType 分支，正好补上。
 *
 * 守护不变量：
 *   - 出售房源不被租赁专属字段（最短租期 / 付款方式 / 可入驻时间）拦住
 *   - 出售房源必须有合法的产权年限枚举值
 *   - 租赁口径不受影响
 *   - businessType 缺失或非法时保守按租赁口径，不因未知值放行出售短路
 */

import { describe, expect, it } from 'vitest'

import {
  checkListingCompleteness,
  getSubmitRequiredFields,
  type ListingCompletenessSnapshot,
} from '@/domain/review/listing-completeness'

const SALE_BASE: ListingCompletenessSnapshot = {
  title: '外滩整层出售',
  building: 1,
  listingType: 'traditional-office',
  businessType: 'sale',
  decorationStatus: 'furnished',
  price: { amount: 38000000, currency: 'CNY', period: 'one-time', unit: 'suite' },
  area: 1200,
  floor: '18',
  propertyRightYears: '50',
  description: '整层出售',
  contactBroker: 1,
  galleryCount: 3,
  hasValidMerchantRelation: true,
}

const LEASE_BASE: ListingCompletenessSnapshot = {
  ...SALE_BASE,
  businessType: 'lease',
  price: { amount: 8.5, currency: 'CNY', period: 'day', unit: 'sqm' },
  minimumLeaseMonths: 12,
  paymentTerms: '押二付三',
  availableFrom: '2026-09-01',
  propertyRightYears: undefined,
}

describe('listing-completeness/租售必填分支', () => {
  it('出售房源不填租期三件套也能通过提交审核', () => {
    const r = checkListingCompleteness(SALE_BASE, 'submit')
    expect(r.complete).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('租赁房源填齐租期三件套通过提交审核', () => {
    const r = checkListingCompleteness(LEASE_BASE, 'submit')
    expect(r.complete).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('出售房源缺产权年限被拦下', () => {
    const r = checkListingCompleteness({ ...SALE_BASE, propertyRightYears: undefined }, 'submit')
    expect(r.complete).toBe(false)
    expect(r.missing.map((m) => m.field)).toContain('propertyRightYears')
  })

  it('产权年限非枚举值被拦下（防「四十年」这类脏值）', () => {
    for (const bad of ['四十年', '40年', 40, '', null]) {
      const r = checkListingCompleteness({ ...SALE_BASE, propertyRightYears: bad }, 'submit')
      expect(r.complete, `产权年限 ${String(bad)} 不应通过`).toBe(false)
    }
  })

  it('租赁房源缺租期三件套被拦下，且不要求产权年限', () => {
    const r = checkListingCompleteness(
      {
        ...LEASE_BASE,
        minimumLeaseMonths: undefined,
        paymentTerms: undefined,
        availableFrom: undefined,
      },
      'submit',
    )
    const fields = r.missing.map((m) => m.field)
    expect(fields).toContain('minimumLeaseMonths')
    expect(fields).toContain('paymentTerms')
    expect(fields).toContain('availableFrom')
    expect(fields).not.toContain('propertyRightYears')
  })

  it('businessType 缺失或非法时按租赁口径（保守，不放行出售短路）', () => {
    for (const bt of [undefined, null, 'transfer']) {
      const fields = checkListingCompleteness(
        { ...SALE_BASE, businessType: bt },
        'submit',
      ).missing.map((m) => m.field)
      expect(fields, `businessType=${String(bt)} 应按租赁校验`).toContain('minimumLeaseMonths')
    }
  })

  it('一次性价格（出售总价）被判为合法价格', () => {
    const r = checkListingCompleteness(SALE_BASE, 'submit')
    expect(r.missing.map((m) => m.field)).not.toContain('price')
  })

  it('getSubmitRequiredFields 两侧只差专属项', () => {
    const lease = new Set(getSubmitRequiredFields('lease'))
    const sale = new Set(getSubmitRequiredFields('sale'))
    expect([...lease].filter((f) => !sale.has(f)).sort()).toEqual([
      'availableFrom',
      'minimumLeaseMonths',
      'paymentTerms',
    ])
    expect([...sale].filter((f) => !lease.has(f))).toEqual(['propertyRightYears'])
  })

  it('草稿模式不受租售分支影响（只查标题/楼盘/类型）', () => {
    const draft: ListingCompletenessSnapshot = {
      title: '草稿',
      building: 1,
      listingType: 'traditional-office',
    }
    expect(checkListingCompleteness(draft, 'draft').complete).toBe(true)
  })
})
