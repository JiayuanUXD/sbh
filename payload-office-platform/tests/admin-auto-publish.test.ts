import { describe, expect, it } from 'vitest'

import {
  PLATFORM_ADMIN_ROLE_CODE,
  decideAdminAutoPublish,
} from '@/domain/review/admin-auto-publish'

/**
 * 平台管理员保存即发布的判定（OPT-033 C）。
 *
 * 三条口径各自对应一组用例，重点在**不该上架时确实不上架**——
 * 判错方向的代价是「后台显示已发布、前台精筛静默撤下」的幽灵房源。
 */

/** 一份满足提交审核全部必填的租赁房源快照。 */
const completeLease = {
  title: '创科大厦 3 层整层办公室',
  building: 12,
  listingType: 'full-floor',
  businessType: 'lease',
  decorationStatus: 'furnished',
  price: { amount: 4.8, currency: 'CNY', period: 'day', unit: 'sqm' },
  area: 1280,
  floor: '3F',
  minimumLeaseMonths: 12,
  paymentTerms: '押二付三',
  availableFrom: '2026-09-01',
  description: '整层可分割',
  contactBroker: 7,
  galleryCount: 5,
  hasValidMerchantRelation: true,
}

const admin = [PLATFORM_ADMIN_ROLE_CODE]

describe('admin-auto-publish/只有平台管理员触发', () => {
  it('ADM 且条件齐备 → 自动上架', () => {
    const d = decideAdminAutoPublish({
      roleCodes: admin,
      reviewStatus: 'not_submitted',
      snapshot: completeLease,
    })
    expect(d).toEqual({ publish: true, skipReason: null, missing: [] })
  })

  it('运营 / 经纪人等其它角色照常走人工审核', () => {
    for (const roles of [['OPS'], ['MGR'], ['BRK'], ['CSR'], []]) {
      const d = decideAdminAutoPublish({
        roleCodes: roles,
        reviewStatus: 'not_submitted',
        snapshot: completeLease,
      })
      expect(d.publish).toBe(false)
      expect(d.skipReason).toBe('not-admin')
    }
  })

  it('兼任 ADM 的多角色用户也触发', () => {
    const d = decideAdminAutoPublish({
      roleCodes: ['OPS', PLATFORM_ADMIN_ROLE_CODE],
      reviewStatus: 'not_submitted',
      snapshot: completeLease,
    })
    expect(d.publish).toBe(true)
  })
})

describe('admin-auto-publish/走状态机，不绕过', () => {
  it('已驳回的房源改好后保存 → 自动上架', () => {
    const d = decideAdminAutoPublish({
      roleCodes: admin,
      reviewStatus: 'rejected',
      snapshot: completeLease,
    })
    expect(d.publish).toBe(true)
  })

  it('pending 不自动上架——队列里的房源应由审核人裁决', () => {
    // 否则会出现「审核中却已通过」这种自相矛盾的轨迹
    const d = decideAdminAutoPublish({
      roleCodes: admin,
      reviewStatus: 'pending',
      snapshot: completeLease,
    })
    expect(d.publish).toBe(false)
    expect(d.skipReason).toBe('illegal-transition')
  })

  it('已通过的房源再保存不重复触发', () => {
    const d = decideAdminAutoPublish({
      roleCodes: admin,
      reviewStatus: 'approved',
      snapshot: completeLease,
    })
    expect(d.publish).toBe(false)
    expect(d.skipReason).toBe('illegal-transition')
  })

  it('审核状态非法/缺失时保守不上架', () => {
    for (const bad of [undefined, null, '', 'whatever', 42]) {
      const d = decideAdminAutoPublish({
        roleCodes: admin,
        reviewStatus: bad,
        snapshot: completeLease,
      })
      expect(d.publish).toBe(false)
      expect(d.skipReason).toBe('illegal-transition')
    }
  })
})

describe('admin-auto-publish/不绕过完整度', () => {
  it('图片不足 3 张 → 只存草稿，并摊开缺失项', () => {
    const d = decideAdminAutoPublish({
      roleCodes: admin,
      reviewStatus: 'not_submitted',
      snapshot: { ...completeLease, galleryCount: 2 },
    })
    expect(d.publish).toBe(false)
    expect(d.skipReason).toBe('incomplete')
    expect(d.missing.map((m) => m.field)).toContain('gallery')
  })

  it('没有有效商户关系 → 不上架', () => {
    const d = decideAdminAutoPublish({
      roleCodes: admin,
      reviewStatus: 'not_submitted',
      snapshot: { ...completeLease, hasValidMerchantRelation: false },
    })
    expect(d.publish).toBe(false)
    expect(d.missing.map((m) => m.field)).toContain('merchant')
  })

  it('价格四件套不全 → 不上架', () => {
    const d = decideAdminAutoPublish({
      roleCodes: admin,
      reviewStatus: 'not_submitted',
      snapshot: { ...completeLease, price: { amount: 4.8 } },
    })
    expect(d.publish).toBe(false)
    expect(d.missing.map((m) => m.field)).toContain('price')
  })

  it('出售房源按出售口径判定，不会被「最短租期」平白卡住', () => {
    const sale = {
      ...completeLease,
      businessType: 'sale',
      price: { amount: 38000000, currency: 'CNY', period: 'one-time', unit: 'suite' },
      propertyRightYears: '50',
      minimumLeaseMonths: undefined,
      paymentTerms: undefined,
      availableFrom: undefined,
    }
    const d = decideAdminAutoPublish({
      roleCodes: admin,
      reviewStatus: 'not_submitted',
      snapshot: sale,
    })
    expect(d.publish).toBe(true)
  })

  it('出售房源缺产权年限 → 不上架', () => {
    const d = decideAdminAutoPublish({
      roleCodes: admin,
      reviewStatus: 'not_submitted',
      snapshot: {
        ...completeLease,
        businessType: 'sale',
        price: { amount: 38000000, currency: 'CNY', period: 'one-time', unit: 'suite' },
      },
    })
    expect(d.publish).toBe(false)
    expect(d.missing.map((m) => m.field)).toContain('propertyRightYears')
  })
})
