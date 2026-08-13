/**
 * F6.5 单测：公开目录缓存失效消费器
 *
 * 设计依据：specs/frontend-mvp/design.md §9.2
 *           specs/frontend-mvp/tasks.md F6.5
 *           src/domain/public-catalog/cache-invalidator.ts
 *
 * 守护不变量：
 *   - listing.* / report.supply_* 事件必须失效 listing + building + home + facets + sitemap
 *   - 无法确定城市时执行全城市安全失效
 *   - revalidateTag 调用幂等（重复 tag 只失效一次）
 *   - 失效失败不阻断业务（返回 ok）
 */

import { describe, expect, it, vi } from 'vitest'
import {
  CACHE_INVALIDATOR_EVENT_TYPES,
  computeAffectedTags,
  createCacheInvalidatorConsumer,
  registerCacheInvalidatorConsumers,
  type TagInvalidator,
} from '@/domain/public-catalog/cache-invalidator'
import { SITEMAP_TAG } from '@/domain/public-catalog/cache-tags'
import { ok } from '@/domain/shared/result'
import type { DomainEvent } from '@/domain/workflow/event-publisher'
import type { EventType } from '@/domain/workflow/event-types'

// ---------------------------------------------------------------------------
// Fake TagInvalidator
// ---------------------------------------------------------------------------

function createFakeInvalidator(): TagInvalidator & {
  calls: string[]
  throwOnTag?: string
} {
  const calls: string[] = []
  let throwOnTag: string | undefined
  return {
    calls,
    get throwOnTag() {
      return throwOnTag
    },
    set throwOnTag(v: string | undefined) {
      throwOnTag = v
    },
    revalidateTag(tag: string): void {
      if (throwOnTag !== undefined && tag === throwOnTag) {
        throw new Error(`mock fail: ${tag}`)
      }
      calls.push(tag)
    },
  }
}

// ---------------------------------------------------------------------------
// 事件 fixture 构造
// ---------------------------------------------------------------------------

function makeEvent(
  eventType: EventType,
  payload: Record<string, unknown>,
  options: { aggregateId?: string; aggregateType?: string } = {},
): DomainEvent {
  return {
    eventId: `evt-test-${eventType}-${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    aggregateType: (options.aggregateType ?? 'listing') as
      | 'listing'
      | 'report'
      | 'lead'
      | 'followup'
      | 'sla'
      | 'task',
    aggregateId: options.aggregateId ?? 'agg-1',
    aggregateVersion: 1,
    payload,
    occurredAt: '2026-07-26T00:00:00.000Z',
    processedAt: null,
    attemptCount: 0,
    lastError: null,
  }
}

// ---------------------------------------------------------------------------
// computeAffectedTags 测试
// ---------------------------------------------------------------------------

describe('F6.5 computeAffectedTags', () => {
  it('listing.published 事件：失效 listing + home + facets + sitemap', () => {
    const event = makeEvent('listing.published', {
      listingId: 'listing-1001',
      city: 'shanghai',
    })
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:listing:listing-1001')
    expect(tags).toContain('public:home:shanghai')
    expect(tags).toContain('public:facets:shanghai')
    expect(tags).toContain(SITEMAP_TAG)
  })

  it('listing.unpublished 事件：同样失效 listing + home + facets + sitemap', () => {
    const event = makeEvent('listing.unpublished', {
      listingId: 'listing-1002',
      city: 'shanghai',
    })
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:listing:listing-1002')
    expect(tags).toContain('public:home:shanghai')
    expect(tags).toContain(SITEMAP_TAG)
  })

  it('report.supply_paused 事件：失效 targetListingId 对应 tag', () => {
    const event = makeEvent(
      'report.supply_paused',
      {
        targetListingId: 'listing-2001',
        reportId: 'report-1',
      },
      { aggregateType: 'report', aggregateId: 'report-1' },
    )
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:listing:listing-2001')
    expect(tags).toContain(SITEMAP_TAG)
  })

  it('report.sustained 事件：失效 targetListingId 对应 tag', () => {
    const event = makeEvent(
      'report.sustained',
      {
        targetListingId: 'listing-2002',
        reportId: 'report-2',
        conclusion: 'sustained',
      },
      { aggregateType: 'report', aggregateId: 'report-2' },
    )
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:listing:listing-2002')
  })

  it('事件 payload 缺 city 时：执行全城市安全失效', () => {
    const event = makeEvent('listing.published', {
      listingId: 'listing-1003',
      // 无 city 字段
    })
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:listing:listing-1003')
    expect(tags).not.toContain('public:home:shanghai')
    expect(tags).not.toContain('public:facets:shanghai')
    expect(tags).toContain(SITEMAP_TAG)
    expect(tags).toContain('public:listings')
    expect(tags).toContain('public:buildings')
  })

  it('derives the actual city from a public listing identity instead of a legacy city hint', () => {
    const event = makeEvent('listing.published', {
      listingId: 'listing-hangzhou',
      city: 'shanghai',
      listing: { citySlug: 'hangzhou', slug: 'hangzhou-office' },
    })
    const tags = computeAffectedTags(event)

    expect(tags).toContain('public:home:hangzhou')
    expect(tags).toContain('public:facets:hangzhou')
    expect(tags).toContain('public:listings:city:hangzhou')
    expect(tags).not.toContain('public:home:shanghai')
  })

  it('事件 payload 含 buildingId 时：失效对应 building tag', () => {
    const event = makeEvent('listing.published', {
      listingId: 'listing-1004',
      buildingId: 'building-200',
      city: 'shanghai',
    })
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:building:building-200')
    expect(tags).toContain('public:listing:listing-1004')
  })

  it('aggregateType=listing 但 payload 无 listingId：从 aggregateId 派生', () => {
    const event = makeEvent(
      'listing.published',
      {
        // 无 listingId，但有 publicationStatus
        publicationStatus: 'published',
        city: 'shanghai',
      },
      { aggregateType: 'listing', aggregateId: 'listing-from-agg' },
    )
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:listing:listing-from-agg')
  })

  it('tag 集合去重：同一 tag 只出现一次', () => {
    const event = makeEvent('listing.published', {
      listingId: 'listing-dup',
      targetListingId: 'listing-dup', // 同值
      city: 'shanghai',
    })
    const tags = computeAffectedTags(event)
    const listingTags = tags.filter((t) => t === 'public:listing:listing-dup')
    expect(listingTags).toHaveLength(1)
  })

  it('listing 事件同时失效具体 tag 和实际城市类别 tag', () => {
    const event = makeEvent('listing.published', {
      listingId: 'listing-cat-1',
      city: 'shanghai',
    })
    const tags = computeAffectedTags(event)
    // 具体 tag（供未来 Cache Components 使用）
    expect(tags).toContain('public:listing:listing-cat-1')
    expect(tags).toContain('public:listings:city:shanghai')
    expect(tags).not.toContain('public:listings')
  })

  it('building 事件同时失效具体 tag 和实际城市类别 tag', () => {
    const event = makeEvent('listing.published', {
      listingId: 'listing-b-1',
      buildingId: 'building-cat-1',
      city: 'shanghai',
    })
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:building:building-cat-1')
    expect(tags).toContain('public:buildings:city:shanghai')
    expect(tags).not.toContain('public:buildings')
  })

  it('无 listingId 的事件不失效 public:listings 类别 tag', () => {
    // 极端场景：事件 payload 无 listingId 且 aggregateType 不是 listing
    const event = makeEvent(
      'report.dismissed',
      {
        reportId: 'report-3',
        // 无 targetListingId，无 listingId
        city: 'shanghai',
      },
      { aggregateType: 'report', aggregateId: 'report-3' },
    )
    const tags = computeAffectedTags(event)
    expect(tags).not.toContain('public:listings')
    expect(tags).not.toContain('public:buildings')
    // 仍失效 sitemap + home + facets
    expect(tags).toContain(SITEMAP_TAG)
    expect(tags).toContain('public:home:shanghai')
  })
})

// ---------------------------------------------------------------------------
// createCacheInvalidatorConsumer 测试
// ---------------------------------------------------------------------------

describe('F6.5 createCacheInvalidatorConsumer', () => {
  it('handle 调用 revalidateTag 失效所有受影响 tag', async () => {
    const invalidator = createFakeInvalidator()
    const consumer = createCacheInvalidatorConsumer('listing.published', invalidator)
    const event = makeEvent('listing.published', {
      listingId: 'listing-3001',
      city: 'shanghai',
    })
    const result = await consumer.handle(event, {
      updateEvent: async () => ok(undefined),
    })
    expect(result.ok).toBe(true)
    expect(invalidator.calls).toContain('public:listing:listing-3001')
    expect(invalidator.calls).toContain('public:home:shanghai')
    expect(invalidator.calls).toContain(SITEMAP_TAG)
  })

  it('revalidateTag 抛错时 handle 仍返回 ok（不阻断业务）', async () => {
    const invalidator = createFakeInvalidator()
    invalidator.throwOnTag = SITEMAP_TAG
    const consumer = createCacheInvalidatorConsumer('listing.published', invalidator)
    const event = makeEvent('listing.published', {
      listingId: 'listing-3002',
      city: 'shanghai',
    })
    const result = await consumer.handle(event, {
      updateEvent: async () => ok(undefined),
    })
    expect(result.ok).toBe(true)
    // 其他 tag 仍被调用
    expect(invalidator.calls).toContain('public:listing:listing-3002')
  })

  it('consumer.eventType 与传入参数一致', () => {
    const invalidator = createFakeInvalidator()
    const consumer = createCacheInvalidatorConsumer('report.supply_paused', invalidator)
    expect(consumer.eventType).toBe('report.supply_paused')
  })
})

// ---------------------------------------------------------------------------
// registerCacheInvalidatorConsumers 测试
// ---------------------------------------------------------------------------

describe('F6.5 registerCacheInvalidatorConsumers', () => {
  it('注册所有关注的事件类型', () => {
    const invalidator = createFakeInvalidator()
    const registered: string[] = []
    const dispatcher = {
      register: (consumer: { eventType: string }) => {
        registered.push(consumer.eventType)
      },
    }
    const types = registerCacheInvalidatorConsumers(dispatcher, invalidator)
    expect(types).toEqual(CACHE_INVALIDATOR_EVENT_TYPES)
    expect(registered).toEqual([...CACHE_INVALIDATOR_EVENT_TYPES])
  })

  it('注册数量与 CACHE_INVALIDATOR_EVENT_TYPES 一致', () => {
    const invalidator = createFakeInvalidator()
    const registered: string[] = []
    const dispatcher = {
      register: (consumer: { eventType: string }) => {
        registered.push(consumer.eventType)
      },
    }
    registerCacheInvalidatorConsumers(dispatcher, invalidator)
    expect(registered).toHaveLength(CACHE_INVALIDATOR_EVENT_TYPES.length)
  })
})

// ---------------------------------------------------------------------------
// 失效覆盖完整性测试
// ---------------------------------------------------------------------------

describe('F6.5 失效覆盖完整性', () => {
  it('所有 CACHE_INVALIDATOR_EVENT_TYPES 都能正确计算 tag', () => {
    for (const eventType of CACHE_INVALIDATOR_EVENT_TYPES) {
      const event = makeEvent(
        eventType,
        { listingId: 'listing-x', city: 'shanghai' },
        {
          aggregateType: eventType.startsWith('report')
            ? 'report'
            : eventType.startsWith('listing')
              ? 'listing'
              : 'listing',
          aggregateId: 'agg-x',
        },
      )
      const tags = computeAffectedTags(event)
      expect(tags.length, `[${eventType}] 应至少有 1 个 tag`).toBeGreaterThan(0)
      expect(tags, `[${eventType}] 应包含 sitemap tag`).toContain(SITEMAP_TAG)
    }
  })
})
