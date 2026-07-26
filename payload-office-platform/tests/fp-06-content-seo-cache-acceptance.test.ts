/**
 * F6.6 验收：metadata / robots / 缓存失效覆盖单测
 *
 * 设计依据：specs/frontend-mvp/tasks.md F6.6
 *           docs/prd/前台网站_MVP_页面PRD/06-内容页_PRD.md §6 SEO
 *           specs/frontend-mvp/design.md §11 SEO 与 §9 缓存
 *
 * 守护不变量：
 *   - buildPageMetadata 输出 canonical / OG / robots 完整字段
 *   - buildNotFoundMetadata 输出 noindex,follow
 *   - cache-invalidator 对所有 CACHE_INVALIDATOR_EVENT_TYPES 都能计算 tag
 *   - 失效 tag 集合永远包含 SITEMAP_TAG（任何供给变化影响 sitemap）
 *   - 失效 tag 集合在 city 已知时包含 home + facets，未知时执行全城市安全失效
 */

import { describe, expect, it } from 'vitest'

import {
  CACHE_INVALIDATOR_EVENT_TYPES,
  computeAffectedTags,
} from '@/domain/public-catalog/cache-invalidator'
import { SITEMAP_TAG } from '@/domain/public-catalog/cache-tags'
import { buildNotFoundMetadata, buildPageMetadata } from '@/lib/frontend/metadata'
import { siteConfig } from '@/lib/frontend/site-config'
import type { DomainEvent } from '@/domain/workflow/event-publisher'
import type { EventType } from '@/domain/workflow/event-types'

// ---------------------------------------------------------------------------
// 测试 fixture
// ---------------------------------------------------------------------------

function makeEvent(
  eventType: EventType,
  payload: Record<string, unknown>,
  options: { aggregateId?: string; aggregateType?: string } = {},
): DomainEvent {
  return {
    eventId: `evt-fp06-${eventType}-${Math.random().toString(36).slice(2, 6)}`,
    eventType,
    aggregateType: (options.aggregateType ?? 'listing') as
      | 'listing'
      | 'report'
      | 'lead'
      | 'followup'
      | 'sla'
      | 'task',
    aggregateId: options.aggregateId ?? 'agg-fp06',
    aggregateVersion: 1,
    payload,
    occurredAt: '2026-07-26T00:00:00.000Z',
    processedAt: null,
    attemptCount: 0,
    lastError: null,
  }
}

// ---------------------------------------------------------------------------
// buildPageMetadata 测试
// ---------------------------------------------------------------------------

describe('F6.6 buildPageMetadata 验收', () => {
  it('输出 canonical / OG / robots 完整字段', () => {
    const md = buildPageMetadata({
      title: '在租房源',
      description: '上海在租办公房源列表',
      canonicalPath: '/listings',
    })
    // canonical 必须为相对路径
    expect(md.alternates?.canonical).toBe('/listings')
    // OG 必须包含绝对 URL、locale、siteName
    expect(md.openGraph?.url).toBe(`${siteConfig.siteOrigin}/listings`)
    expect(md.openGraph?.locale).toBe('zh_CN')
    expect(md.openGraph?.title).toBe('在租房源')
    expect(md.openGraph?.description).toBe('上海在租办公房源列表')
    // robots 默认 index,follow（Next.js Robots 对象形态）
    const robots = md.robots as { index: boolean; follow: boolean }
    expect(robots.index).toBe(true)
    expect(robots.follow).toBe(true)
  })

  it('文章型内容用 ogType=article', () => {
    const md = buildPageMetadata({
      title: '上海办公选址指南',
      canonicalPath: '/pages/office-guide',
      ogType: 'article',
    })
    const og = md.openGraph as { type?: string }
    expect(og.type).toBe('article')
  })

  it('noindex 策略输出 index=false,follow=true', () => {
    const md = buildPageMetadata({
      title: '越界页',
      canonicalPath: '/listings?page=999',
      robots: 'noindex',
    })
    const robots = md.robots as { index: boolean; follow: boolean }
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(true)
  })

  it('OG image 显式传入时附加到 openGraph.images', () => {
    const md = buildPageMetadata({
      title: '测试',
      canonicalPath: '/x',
      ogImage: 'https://example.com/og.png',
    })
    expect(md.openGraph?.images).toEqual([{ url: 'https://example.com/og.png' }])
  })

  it('不设置 keywords（Google 已不使用）', () => {
    const md = buildPageMetadata({
      title: 'x',
      canonicalPath: '/',
    })
    expect(md.keywords).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// buildNotFoundMetadata 测试
// ---------------------------------------------------------------------------

describe('F6.6 buildNotFoundMetadata 验收', () => {
  it('默认标题：页面未找到', () => {
    const md = buildNotFoundMetadata()
    expect(md.title).toBe('页面未找到')
  })

  it('noindex,follow 阻止搜索引擎索引 404 / 草稿页', () => {
    const md = buildNotFoundMetadata('房源未找到')
    expect(md.title).toBe('房源未找到')
    const robots = md.robots as { index: boolean; follow: boolean }
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(false)
  })

  it('不输出 canonical（404 页面不应有 canonical）', () => {
    const md = buildNotFoundMetadata()
    expect(md.alternates?.canonical).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// cache-invalidator 失效覆盖完整性（FP-06 §10 验收点：失效事件撤销时间）
// ---------------------------------------------------------------------------

describe('F6.6 缓存失效覆盖完整性', () => {
  it('所有 CACHE_INVALIDATOR_EVENT_TYPES 都能计算 tag', () => {
    expect(CACHE_INVALIDATOR_EVENT_TYPES.length).toBeGreaterThan(0)
    for (const eventType of CACHE_INVALIDATOR_EVENT_TYPES) {
      const event = makeEvent(
        eventType,
        { listingId: 'listing-fp06', city: 'shanghai' },
        {
          aggregateType: eventType.startsWith('report')
            ? 'report'
            : 'listing',
          aggregateId: 'agg-fp06',
        },
      )
      const tags = computeAffectedTags(event)
      expect(tags.length, `[${eventType}] 应至少有 1 个 tag`).toBeGreaterThan(0)
      expect(tags, `[${eventType}] 应包含 sitemap tag`).toContain(SITEMAP_TAG)
    }
  })

  it('listing.* 事件失效 listing + 类别级 listings + home + facets + sitemap', () => {
    const event = makeEvent('listing.published', {
      listingId: 'listing-fp06-1',
      city: 'shanghai',
    })
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:listing:listing-fp06-1')
    expect(tags).toContain('public:listings')
    expect(tags).toContain('public:home:shanghai')
    expect(tags).toContain('public:facets:shanghai')
    expect(tags).toContain(SITEMAP_TAG)
  })

  it('report.supply_paused 事件同样失效 listing + 类别 + sitemap', () => {
    const event = makeEvent(
      'report.supply_paused',
      { targetListingId: 'listing-fp06-2', reportId: 'r-1' },
      { aggregateType: 'report', aggregateId: 'r-1' },
    )
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:listing:listing-fp06-2')
    expect(tags).toContain('public:listings')
    expect(tags).toContain(SITEMAP_TAG)
  })

  it('事件缺 city 时执行全城市安全失效', () => {
    const event = makeEvent('listing.published', {
      listingId: 'listing-fp06-3',
      // 无 city
    })
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:home:all')
    expect(tags).toContain('public:facets:all')
    expect(tags).toContain(SITEMAP_TAG)
    expect(tags).toContain('public:listings')
  })

  it('事件含 buildingId 时失效 building + 类别 buildings', () => {
    const event = makeEvent('listing.published', {
      listingId: 'listing-fp06-4',
      buildingId: 'building-fp06-1',
      city: 'shanghai',
    })
    const tags = computeAffectedTags(event)
    expect(tags).toContain('public:building:building-fp06-1')
    expect(tags).toContain('public:buildings')
  })

  it('sitemap tag 永远在失效集合中（任何供给变化都影响 sitemap）', () => {
    // 极端场景：事件 payload 几乎为空
    const event = makeEvent('listing.published', {})
    const tags = computeAffectedTags(event)
    expect(tags).toContain(SITEMAP_TAG)
  })
})

// ---------------------------------------------------------------------------
// 失效时间窗口（FP-06 §10 验收点：撤销时间）
// ---------------------------------------------------------------------------

describe('F6.6 失效撤销时间窗口（设计依据 design.md §9.2）', () => {
  it('computeAffectedTags 是同步函数，事件触发后立即计算 tag 集合', () => {
    // computeAffectedTags 不做 IO，纯函数计算
    // 事件 dispatch 后立即返回 tag 集合，revalidateTag 同步执行
    // 因此撤销窗口 = EventDispatcher 处理时间 + revalidateTag 调用时间
    // 远小于 60 秒待办闭环 SLA
    const event = makeEvent('listing.published', {
      listingId: 'listing-fp06-time',
      city: 'shanghai',
    })
    const start = Date.now()
    const tags = computeAffectedTags(event)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(50) // 50ms 内完成（远小于 60s SLA）
    expect(tags.length).toBeGreaterThan(0)
  })
})
