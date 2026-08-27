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
      'req-123',
      'listing',
      'jingan-center-100-monthly',
    )).resolves.toBe('3003d45b835e6a47b8cc78538d67678c19955470e0f90f18ef797af50d870286')
  })

  it('提交时目标类型或 slug 不同不会碰撞', async () => {
    const listing = await computeMiniInquiryIdempotencyKey('req-123', 'listing', 'target')
    const building = await computeMiniInquiryIdempotencyKey('req-123', 'building', 'target')
    const anotherListing = await computeMiniInquiryIdempotencyKey('req-123', 'listing', 'other')

    expect(new Set([listing, building, anotherListing])).toHaveLength(3)
  })

  it('相同可见字段也与 Web 幂等域隔离', async () => {
    const mini = await computeMiniInquiryIdempotencyKey(
      'req-123',
      'listing',
      'jingan-center-100-monthly',
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
      'req-123',
      'jingan-center-100-monthly',
    )).resolves.toBe(await computeMiniInquiryIdempotencyKey(
      'req-123',
      'listing',
      'jingan-center-100-monthly',
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
    expect(same).not.toBe(await computeMiniInquiryIdempotencyKey('req-123', 'listing', 'target'))
  })

  it('Acceptance key 保持 InquiryIdempotencyKey 编译期品牌', () => {
    expectTypeOf<Awaited<ReturnType<typeof computeMiniAcceptanceListingInquiryIdempotencyKey>>>()
      .toEqualTypeOf<InquiryIdempotencyKey>()
  })
})
