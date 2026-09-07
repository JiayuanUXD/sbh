import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  computeIdempotencyKey,
  computeIdempotencyKeySync,
  type InquiryIdempotencyKey,
} from '@/domain/inquiry'
import {
  computeMiniInquiryIdempotencyKey,
  computeMiniListingInquiryIdempotencyKey,
  computeMiniAcceptanceListingInquiryIdempotencyKey,
} from '@/domain/mini-program/inquiry-idempotency'

describe('Mini 询盘幂等键', () => {
  it('Web 异步/同步与 Mini 算法只返回同一编译期品牌 key', () => {
    expectTypeOf<Awaited<ReturnType<typeof computeIdempotencyKey>>>()
      .toEqualTypeOf<InquiryIdempotencyKey>()
    expectTypeOf<ReturnType<typeof computeIdempotencyKeySync>>()
      .toEqualTypeOf<InquiryIdempotencyKey>()
    expectTypeOf<Awaited<ReturnType<typeof computeMiniInquiryIdempotencyKey>>>()
      .toEqualTypeOf<InquiryIdempotencyKey>()
    expectTypeOf<string>().not.toMatchTypeOf<InquiryIdempotencyKey>()
  })

  it('以 mini-v1 固定域和固定字段顺序产生稳定 64 hex 向量', async () => {
    await expect(computeMiniInquiryIdempotencyKey(
      'subject-a',
      'req-123',
      { targetType: 'listing', listingSlug: 'jingan-center-100-monthly' },
    )).resolves.toBe('8d617deb62d5d7032f2df453efe87291fdb9041a9177e0d893e4ee48543eda23')
  })

  it('提交时目标类型或 slug 不同不会碰撞', async () => {
    const listing = await computeMiniInquiryIdempotencyKey(
      'subject-a',
      'req-123',
      { targetType: 'listing', listingSlug: 'target' },
    )
    const building = await computeMiniInquiryIdempotencyKey(
      'subject-a',
      'req-123',
      { targetType: 'building', buildingSlug: 'target' },
    )
    const anotherListing = await computeMiniInquiryIdempotencyKey(
      'subject-a',
      'req-123',
      { targetType: 'listing', listingSlug: 'other' },
    )

    expect(new Set([listing, building, anotherListing])).toHaveLength(3)
  })

  it('相同 submission 与目标按稳定 subject 隔离', async () => {
    const target = { targetType: 'general' as const }
    const first = await computeMiniInquiryIdempotencyKey('subject-a', 'req-123', target)
    const second = await computeMiniInquiryIdempotencyKey('subject-b', 'req-123', target)

    expect(first).not.toBe(second)
    await expect(computeMiniInquiryIdempotencyKey('subject-a', 'req-123', target)).resolves.toBe(first)
  })

  it('相同可见字段也与 Web 幂等域隔离', async () => {
    const mini = await computeMiniInquiryIdempotencyKey(
      'subject-a',
      'req-123',
      { targetType: 'listing', listingSlug: 'jingan-center-100-monthly' },
    )
    const web = await computeIdempotencyKey(
      'req-123',
      '13800001111',
      'listing',
      'jingan-center-100-monthly',
    )

    expect(web).toBe('512df2dec4cb419aef514c466c3e45f86bd65b03b1f3b9447bfbc19bfb61df9f')
    expect(mini).not.toBe(web)
  })

  it('Mini 详情 adapter 只能按提交时 listing 目标计算专属 key', async () => {
    await expect(computeMiniListingInquiryIdempotencyKey(
      'subject-a',
      'req-123',
      'jingan-center-100-monthly',
    )).resolves.toBe(await computeMiniInquiryIdempotencyKey(
      'subject-a',
      'req-123',
      { targetType: 'listing', listingSlug: 'jingan-center-100-monthly' },
    ))
  })

  it('Acceptance key 绑定 run 并使用独立域与固定字段顺序', async () => {
    await expect(computeMiniAcceptanceListingInquiryIdempotencyKey(
      'run-1', 'req-123', 'jingan-center-100-monthly',
    )).resolves.toBe('eb75a315dce4195230b78a65f54e0f0300826072a01eedd1871f2fcfde3eeb2c')
    const same = await computeMiniAcceptanceListingInquiryIdempotencyKey('run-1', 'req-123', 'target')
    expect(await computeMiniAcceptanceListingInquiryIdempotencyKey('run-1', 'req-123', 'target')).toBe(same)
    expect(await computeMiniAcceptanceListingInquiryIdempotencyKey('run-2', 'req-123', 'target')).not.toBe(same)
    expect(await computeMiniAcceptanceListingInquiryIdempotencyKey('run-1', 'req-124', 'target')).not.toBe(same)
    expect(await computeMiniAcceptanceListingInquiryIdempotencyKey('run-1', 'req-123', 'other')).not.toBe(same)
    expect(same).not.toBe(await computeMiniInquiryIdempotencyKey(
      'subject-a',
      'req-123',
      { targetType: 'listing', listingSlug: 'target' },
    ))
  })

  it('Acceptance key 保持 InquiryIdempotencyKey 编译期品牌', () => {
    expectTypeOf<Awaited<ReturnType<typeof computeMiniAcceptanceListingInquiryIdempotencyKey>>>()
      .toEqualTypeOf<InquiryIdempotencyKey>()
  })
})
