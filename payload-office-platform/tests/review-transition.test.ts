import { describe, it, expect } from 'vitest'

import {
  REVIEW_TASK_STATUSES,
  isReviewTaskStatus,
  taskStatusForDecision,
  buildListingSnapshot,
  computeSnapshotHash,
  assertReasonForDecision,
  type ListingReviewSnapshot,
} from '@/domain/review/review-transition'
import { InvalidOperationError } from '@/domain/shared/errors'

/** 构造一个可提交审核的房源文档快照（关系字段用 id 或 populated 对象混合，验证归一）。 */
function listingDoc(): Record<string, unknown> {
  return {
    id: 42,
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
    description: '甲级写字楼，视野开阔。',
    contactBroker: { id: 7, name: '张三' },
    merchant: 3,
    gallery: [{ image: 1 }, { image: 2 }, { image: 3 }],
    version: 5,
  }
}

describe('review-transition — task_status 枚举', () => {
  it('任务状态枚举含待处理/处理中/已完成/已取消', () => {
    expect([...REVIEW_TASK_STATUSES]).toEqual(['pending', 'processing', 'resolved', 'cancelled'])
  })

  it('isReviewTaskStatus 守卫合法值', () => {
    expect(isReviewTaskStatus('pending')).toBe(true)
    expect(isReviewTaskStatus('done')).toBe(false)
    expect(isReviewTaskStatus(undefined)).toBe(false)
  })
})

describe('review-transition — 动作到任务状态映射', () => {
  it('submit → pending（待领取审核）', () => {
    expect(taskStatusForDecision('submit')).toBe('pending')
  })
  it('withdraw → cancelled', () => {
    expect(taskStatusForDecision('withdraw')).toBe('cancelled')
  })
  it('approve → resolved', () => {
    expect(taskStatusForDecision('approve')).toBe('resolved')
  })
  it('reject → resolved', () => {
    expect(taskStatusForDecision('reject')).toBe('resolved')
  })
})

describe('review-transition — 驳回必须填写原因', () => {
  it('reject 缺原因抛 InvalidOperationError', () => {
    expect(() => assertReasonForDecision('reject', '')).toThrow(InvalidOperationError)
    expect(() => assertReasonForDecision('reject', '   ')).toThrow(InvalidOperationError)
    expect(() => assertReasonForDecision('reject', undefined)).toThrow(InvalidOperationError)
  })
  it('reject 带非空原因通过', () => {
    expect(() => assertReasonForDecision('reject', '图片不清晰')).not.toThrow()
  })
  it('submit/withdraw/approve 不强制原因', () => {
    expect(() => assertReasonForDecision('submit', undefined)).not.toThrow()
    expect(() => assertReasonForDecision('withdraw', undefined)).not.toThrow()
    expect(() => assertReasonForDecision('approve', undefined)).not.toThrow()
  })
})

describe('review-transition — 不可变提交快照', () => {
  it('冻结审核相关字段并归一关系为 id', () => {
    const snap = buildListingSnapshot(listingDoc())
    expect(snap.listing).toBe(42)
    expect(snap.listingVersion).toBe(5)
    expect(snap.title).toBe('国贸三期 3801')
    expect(snap.building).toBe(12)
    // populated 对象归一为 id
    expect(snap.contactBroker).toBe(7)
    expect(snap.merchant).toBe(3)
    expect(snap.galleryCount).toBe(3)
    expect(snap.price).toEqual({ amount: 8.5, currency: 'CNY', period: 'month', unit: 'sqm' })
  })

  it('缺 version 时快照 listingVersion 记为 1', () => {
    const doc = listingDoc()
    delete doc.version
    const snap = buildListingSnapshot(doc)
    expect(snap.listingVersion).toBe(1)
  })

  it('快照是普通可序列化对象（无函数/循环）', () => {
    const snap = buildListingSnapshot(listingDoc())
    expect(() => JSON.stringify(snap)).not.toThrow()
  })
})

describe('review-transition — 确定性快照哈希', () => {
  it('同一快照哈希稳定', () => {
    const a = computeSnapshotHash(buildListingSnapshot(listingDoc()))
    const b = computeSnapshotHash(buildListingSnapshot(listingDoc()))
    expect(a).toBe(b)
  })

  it('哈希与字段键顺序无关', () => {
    const s1 = buildListingSnapshot(listingDoc())
    // 手工重排键顺序构造等价快照
    const reordered = Object.fromEntries(
      Object.entries(s1).reverse(),
    ) as unknown as ListingReviewSnapshot
    expect(computeSnapshotHash(reordered)).toBe(computeSnapshotHash(s1))
  })

  it('字段变化导致哈希变化', () => {
    const base = buildListingSnapshot(listingDoc())
    const doc = listingDoc()
    doc.title = '国贸三期 3802'
    const changed = buildListingSnapshot(doc)
    expect(computeSnapshotHash(changed)).not.toBe(computeSnapshotHash(base))
  })

  it('哈希为 64 位十六进制（sha256）', () => {
    const h = computeSnapshotHash(buildListingSnapshot(listingDoc()))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
