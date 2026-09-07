import type { SanitizedConfig } from 'payload'
import { describe, expect, it } from 'vitest'

const { default: configPromise } = await import('@/payload.config')
const payloadConfig = await configPromise

const customNavigationCollectionSlugs = [
  'tasks',
  'notifications',
  'users',
  'roles',
  'amenities',
  'audit-logs',
  'brokers',
  'building-merchant-relations',
  'buildings',
  'business-area-extensions',
  'customers',
  'display-tags',
  'domain-events',
  'follow-ups',
  'lead-ownership-history',
  'leads',
  'listing-reports',
  'listing-reviews',
  'listings',
  'locations',
  'media',
  'merchants',
  'pages',
  'articles',
  'teams',
  'search',
  'forms',
  'form-submissions',
  'imports',
  'exports',
] as const

const targetPluralLabels = {
  tasks: '我的待办',
  notifications: '消息通知',
  'listing-reviews': '审核队列',
  media: '素材库',
  articles: '资讯中心',
  'form-submissions': '提交数据',
  locations: '地理数据',
  'business-area-extensions': '商圈管理',
  amenities: '配套字典',
} as const

function getDashboardDefaultLayout(config: SanitizedConfig): unknown {
  const dashboard: unknown = config.admin.dashboard

  if (typeof dashboard !== 'object' || dashboard === null || !('defaultLayout' in dashboard)) {
    return undefined
  }

  return dashboard.defaultLayout
}

describe('Payload custom admin navigation config', () => {
  it('keeps every custom-navigation collection route while removing it from the default nav', () => {
    for (const slug of customNavigationCollectionSlugs) {
      const collection = payloadConfig.collections.find((candidate) => candidate.slug === slug)

      expect(collection, `${slug} must remain registered so /admin/collections/${slug} still exists`).toBeDefined()
      if (!collection) continue

      expect(collection.admin.group, `${slug} must opt out via admin.group=false`).toBe(false)
      // 退出默认导航一律只靠 admin.group=false。business-area-extensions 曾额外写
      // admin.hidden=true 并在此开特例，注释还声称「直接 URL 仍可访问用于排障」——
      // 2026-09-06 实测证伪（hidden 会连 /admin/collections/<slug>/* 一起 404），
      // 特例连同 hidden 一并移除。为什么 hidden ≠ 只藏导航，见
      // tests/admin-entity-route-visibility.test.ts。
      expect(collection.admin.hidden, `${slug} must keep its direct admin route visible`).not.toBe(true)
    }
  })

  it('uses the target Chinese labels for custom navigation entries', () => {
    for (const [slug, pluralLabel] of Object.entries(targetPluralLabels)) {
      const collection = payloadConfig.collections.find((candidate) => candidate.slug === slug)

      expect(collection?.labels.plural).toBe(pluralLabel)
    }
  })

  it('keeps only the core stats widget in the default dashboard layout', () => {
    expect(getDashboardDefaultLayout(payloadConfig)).toEqual([
      { widgetSlug: 'core-stats', width: 'full' },
    ])
  })
})
