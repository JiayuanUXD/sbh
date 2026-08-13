/**
 * 公开目录缓存失效消费器（design.md §9 / F6.5）
 *
 * 职责：
 *   - 实现 EventConsumer 接口，监听房源/举报/审核等影响公开供给的领域事件
 *   - 从事件 payload 提取受影响实体 ID（listingId / buildingId）
 *   - 计算需要失效的 tag 集合
 *   - 通过 TagInvalidator 接口调用 revalidateTag
 *
 * 失效策略（design.md §9.2）：
 *   - listing.* 事件 → 失效 listing + building + home + facets + sitemap
 *     + 类别级 tag（public:listings / public:buildings）
 *   - report.supply_paused / supply_resumed → 失效 listing + building + home + facets + sitemap
 *     + 类别级 tag
 *   - 无法安全计算局部影响（如商户关系变化）→ 城市级安全失效
 *
 * 类别级 tag 设计：
 *   - lib/frontend/cached-queries.ts 用 unstable_cache 包装 Facade，由于 unstable_cache
 *     的 tags 在闭包中静态，cached function 标记的是类别级 tag（如 'public:listings'）
 *     而非具体 tag（如 'public:listing:123'）
 *   - 失效时同时调用具体 tag + 类别级 tag，保证 cached function 的缓存被正确失效
 *   - 具体 tag（listing:123）保留供未来 Cache Components 启用 cacheTag 指令时使用
 *
 * 幂等性：
 *   - revalidateTag 本身是幂等的（重复调用同一 tag 等同于一次失效）
 *   - 消费器幂等由 EventDispatcher 保证（processedAt 已设置则跳过）
 *
 * 设计取舍：
 *   - TagInvalidator 接口抽象 revalidateTag，便于测试注入 fake
 *   - 生产实现使用 next/cache.revalidateTag
 *   - 失效失败不阻断业务（记录错误，返回 ok，由人工介入）
 */

import { revalidateTag } from 'next/cache'

import { ok, type OperationResult } from '@/domain/shared/result'
import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'

import type { EventConsumer, ConsumerContext } from '@/domain/workflow/event-consumer'
import type { DomainEvent } from '@/domain/workflow/event-publisher'
import type { EventType } from '@/domain/workflow/event-types'
import {
  PUBLIC_CACHE_TAG_PREFIX,
  buildingTag,
  cityLevelSafeInvalidationTags,
  listingTag,
} from './cache-tags'

/**
 * Tag 失效器接口
 *
 * 抽象 next/cache.revalidateTag，便于测试注入 fake。
 * 生产实现为 createNextTagInvalidator()。
 */
export interface TagInvalidator {
  /** 失效指定 tag */
  revalidateTag(tag: string): void
}

/**
 * 从领域事件 payload 提取受影响实体 ID
 */
interface AffectedEntities {
  /** 受影响的房源 ID（如有） */
  listingId: string | number | null
  /** 受影响的楼盘 ID（如有） */
  buildingId: string | number | null
  /** 受影响的城市 slug（如有；缺省视为全城市） */
  city: string | null
}

/**
 * 从事件 payload 提取受影响实体
 *
 * payload 字段命名约定（与 event-publisher / fixture 对齐）：
 *   - listingId / targetListingId：房源 ID
 *   - buildingId：楼盘 ID
 *   - city：城市 slug
 */
function extractAffectedEntities(event: DomainEvent): AffectedEntities {
  const payload = event.payload as Record<string, unknown>
  const rawListingId =
    payload.listingId ?? payload.targetListingId
  const listingId: string | number | null =
    typeof rawListingId === 'string' || typeof rawListingId === 'number'
      ? rawListingId
      : event.aggregateType === 'listing'
        ? event.aggregateId
        : null
  const rawBuildingId = payload.buildingId
  const buildingId: string | number | null =
    typeof rawBuildingId === 'string' || typeof rawBuildingId === 'number'
      ? rawBuildingId
      : null
  const city = extractActualCitySlug(payload)
  return { listingId, buildingId, city }
}

function citySlugFromRecord(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  if ('citySlug' in value) {
    const explicit = normalizeCitySlug(value.citySlug)
    if (explicit) return explicit
  }
  if ('city' in value && typeof value.city === 'object' && value.city !== null) {
    if ('slug' in value.city) {
      const relationship = normalizeCitySlug(value.city.slug)
      if (relationship) return relationship
    }
  }
  if ('building' in value) return citySlugFromRecord(value.building)
  return null
}

function extractActualCitySlug(payload: Record<string, unknown>): string | null {
  for (const candidate of [payload.listing, payload.building, payload.doc, payload.document]) {
    const resolved = citySlugFromRecord(candidate)
    if (resolved) return resolved
  }
  const explicit = normalizeCitySlug(payload.citySlug)
  if (explicit) return explicit
  return normalizeCitySlug(payload.city)
}

/**
 * 计算事件需要失效的 tag 集合
 *
 * 规则（design.md §9.2）：
 *   - listing.* / report.supply_* → 失效 listing + building + home + facets + sitemap
 *     + 类别级 tag（public:listings / public:buildings）
 *   - 无法安全计算城市 → 全城市安全失效
 *
 * 类别级 tag：
 *   - lib/frontend/cached-queries.ts 中 unstable_cache 包装的 Facade 调用
 *     标记的是类别级 tag（如 'public:listings'），无法按参数动态生成具体 tag
 *   - 因此失效时必须包含类别级 tag，保证 cached function 缓存被正确清空
 *   - 具体 tag（listing:123）保留供未来 Cache Components 启用 cacheTag 指令时使用
 *
 * @returns 去重后的 tag 数组
 */
export function computeAffectedTags(event: DomainEvent): readonly string[] {
  const { listingId, buildingId, city } = extractAffectedEntities(event)
  const tags = new Set<string>()

  for (const tag of cityLevelSafeInvalidationTags(city)) {
    tags.add(tag)
  }

  // 失效具体房源 + 类别级 tag
  if (listingId != null) {
    tags.add(listingTag(listingId))
  }

  // 失效具体楼盘 + 类别级 tag
  if (buildingId != null) {
    tags.add(buildingTag(buildingId))
  }

  // 内容页事件失效 pages 类别 tag
  // 当前 EVENT_TYPES 未包含 page.* 聚合类型，此处通过事件类型前缀判断预留扩展
  if (typeof event.eventType === 'string' && event.eventType.startsWith('page.')) {
    tags.add(`${PUBLIC_CACHE_TAG_PREFIX}:pages`)
  }

  return Array.from(tags)
}

/**
 * 创建缓存失效消费器
 *
 * 监听指定事件类型，计算受影响 tag 并调用 revalidateTag。
 *
 * @param eventType 监听的领域事件类型
 * @param invalidator Tag 失效器（生产用 NextTagInvalidator，测试用 fake）
 */
export function createCacheInvalidatorConsumer(
  eventType: EventType,
  invalidator: TagInvalidator,
): EventConsumer {
  return {
    eventType,
    async handle(
      event: DomainEvent,
      _ctx: ConsumerContext,
    ): Promise<OperationResult<void>> {
      const tags = computeAffectedTags(event)
      const failedTags: Array<{ tag: string; error: string }> = []
      for (const tag of tags) {
        try {
          invalidator.revalidateTag(tag)
        } catch (e) {
          // 失效失败不阻断业务：收集失败 tag，统一上报后返回 ok
          // 重复失效由 revalidateTag 幂等性保证；持续失败由监控告警，人工介入
          failedTags.push({
            tag,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
      if (failedTags.length > 0) {
        // 部分失效失败可观测（design.md §9 / OPT-012）：
        // 不返回 err 触发重试，避免 revalidateTag 持续失败导致事件死信堆积
        console.error('[cache-invalidator] partial_failure', {
          eventType,
          eventId: event.eventId,
          failedTags: failedTags.map((f) => f.tag),
          count: failedTags.length,
          total: tags.length,
          errors: failedTags,
        })
      }
      return ok(undefined)
    },
  }
}

/**
 * 缓存失效消费器关注的事件类型
 *
 * 这些事件直接影响公开供给可见性，需要失效对应缓存。
 */
export const CACHE_INVALIDATOR_EVENT_TYPES: readonly EventType[] = [
  'listing.published',
  'listing.unpublished',
  'listing.review_approved',
  'listing.review_rejected',
  'report.supply_paused',
  'report.supply_resumed',
  'report.sustained',
  'report.dismissed',
] as const

/**
 * 批量注册缓存失效消费器到 EventDispatcher
 *
 * 为每个关注的事件类型创建独立的 CacheInvalidatorConsumer 实例。
 *
 * @returns 已注册的事件类型列表
 */
export function registerCacheInvalidatorConsumers(
  dispatcher: {
    register: (consumer: EventConsumer) => void
  },
  invalidator: TagInvalidator,
): readonly EventType[] {
  for (const eventType of CACHE_INVALIDATOR_EVENT_TYPES) {
    dispatcher.register(createCacheInvalidatorConsumer(eventType, invalidator))
  }
  return CACHE_INVALIDATOR_EVENT_TYPES
}

/**
 * 生产环境 TagInvalidator：基于 next/cache.revalidateTag
 *
 * 顶层静态 import next/cache（与 lib/frontend/cached-queries.ts 一致）；
 * revalidateTag 在非 Next 请求上下文调用会抛错，由消费器 handle 兜底捕获。
 */
export function createNextTagInvalidator(): TagInvalidator {
  return {
    revalidateTag(tag: string): void {
      // Next 16 起 revalidateTag 第二参数 profile 必填，'max' 表示按最长缓存生命重新验证
      revalidateTag(tag, 'max')
    },
  }
}
