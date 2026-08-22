/**
 * OPT-012 集成测试：缓存失效生产适配器验证真实 Next 行为
 *
 * 审查背景（frontend-acceptance-audit.md P1）：
 *   - 现有单测通过 fake invalidator 验证 tag 集合，无法证明生产适配器
 *     真实接入 next/cache.revalidateTag
 *   - 生产适配器曾用动态 require('next/cache') 接入，且部分失效静默吞掉
 *
 * 守护不变量：
 *   - createNextTagInvalidator 接入真实 next/cache.revalidateTag（非 fake）
 *   - listing.published 事件触发后，computeAffectedTags 计算的所有 tag
 *     均通过真实 revalidateTag 调用（含 sitemap / home / listing / 类别级 tag）
 *   - revalidateTag 部分抛错时：handle 返回 ok（不阻断业务），
 *     且 console.error 上报 failedTags（部分失效可观测）
 *
 * 注：Next 16 起 revalidateTag 第二参数 profile 必填。生产适配器传的是
 *     IMMEDIATE_CACHE_EXPIRE_PROFILE（硬失效），不是 'max'——'max' 只标记 stale，
 *     会让 unstable_cache 先返回一次陈旧值。语义守护见
 *     tests/public-cache-immediate-expiry.test.ts。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// vi.mock 被 vitest hoist 到 import 之前；替换 next/cache 为可控 spy，
// 从而验证 createNextTagInvalidator 走的是真实模块路径而非 fake 实现。
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}))

import { revalidateTag } from 'next/cache'
import {
  createCacheInvalidatorConsumer,
  createNextTagInvalidator,
  computeAffectedTags,
} from '@/domain/public-catalog/cache-invalidator'
import { IMMEDIATE_CACHE_EXPIRE_PROFILE, SITEMAP_TAG } from '@/domain/public-catalog/cache-tags'
import { ok } from '@/domain/shared/result'
import type { DomainEvent } from '@/domain/workflow/event-publisher'
import type { EventType } from '@/domain/workflow/event-types'

const mockedRevalidateTag = vi.mocked(revalidateTag)

function makeEvent(
  eventType: EventType,
  payload: Record<string, unknown>,
): DomainEvent {
  return {
    eventId: `evt-int-${eventType}-${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    aggregateType: 'listing',
    aggregateId: 'agg-1',
    aggregateVersion: 1,
    payload,
    occurredAt: '2026-07-26T00:00:00.000Z',
    processedAt: null,
    attemptCount: 0,
    lastError: null,
  }
}

describe('OPT-012 createNextTagInvalidator 真实 Next 接线', () => {
  beforeEach(() => {
    mockedRevalidateTag.mockReset()
  })

  it('revalidateTag 调用 next/cache.revalidateTag（非 fake）', () => {
    const invalidator = createNextTagInvalidator()
    invalidator.revalidateTag('public:listing:123')
    expect(mockedRevalidateTag).toHaveBeenCalledTimes(1)
    expect(mockedRevalidateTag).toHaveBeenCalledWith('public:listing:123', IMMEDIATE_CACHE_EXPIRE_PROFILE)
  })

  it('listing.published 事件使所有受影响 tag 经真实 revalidateTag 失效', async () => {
    const invalidator = createNextTagInvalidator()
    const consumer = createCacheInvalidatorConsumer(
      'listing.published',
      invalidator,
    )
    const event = makeEvent('listing.published', {
      listingId: 'listing-9001',
      city: 'shanghai',
    })
    const result = await consumer.handle(event, {
      updateEvent: async () => ok(undefined),
    })

    expect(result.ok).toBe(true)
    // 每个计算出的 tag 都应通过真实 revalidateTag 调用一次
    const expectedTags = computeAffectedTags(event)
    expect(mockedRevalidateTag).toHaveBeenCalledTimes(expectedTags.length)
    for (const tag of expectedTags) {
      expect(mockedRevalidateTag).toHaveBeenCalledWith(tag, IMMEDIATE_CACHE_EXPIRE_PROFILE)
    }
    // 关键类别 tag 兜底断言
    expect(mockedRevalidateTag).toHaveBeenCalledWith(SITEMAP_TAG, IMMEDIATE_CACHE_EXPIRE_PROFILE)
    expect(mockedRevalidateTag).toHaveBeenCalledWith('public:listing:listing-9001', IMMEDIATE_CACHE_EXPIRE_PROFILE)
    expect(mockedRevalidateTag).toHaveBeenCalledWith('public:home:shanghai', IMMEDIATE_CACHE_EXPIRE_PROFILE)
  })

  it('revalidateTag 部分抛错时 handle 返回 ok 并上报 failedTags', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    mockedRevalidateTag.mockImplementation((tag: string) => {
      if (tag === SITEMAP_TAG) {
        throw new Error('revalidateTag called outside a request scope')
      }
    })

    const invalidator = createNextTagInvalidator()
    const consumer = createCacheInvalidatorConsumer(
      'listing.published',
      invalidator,
    )
    const event = makeEvent('listing.published', {
      listingId: 'listing-9002',
      city: 'shanghai',
    })
    const result = await consumer.handle(event, {
      updateEvent: async () => ok(undefined),
    })

    // 不阻断业务
    expect(result.ok).toBe(true)
    // 部分失效可观测：failedTags 上报
    expect(errorSpy).toHaveBeenCalledWith(
      '[cache-invalidator] partial_failure',
      expect.objectContaining({
        eventType: 'listing.published',
        failedTags: [SITEMAP_TAG],
        count: 1,
      }),
    )
    // 其他 tag 仍被调用（未被首个失败阻断）
    expect(mockedRevalidateTag).toHaveBeenCalledWith(
      'public:listing:listing-9002',
      IMMEDIATE_CACHE_EXPIRE_PROFILE,
    )
    errorSpy.mockRestore()
  })
})
