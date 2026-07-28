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
  'listing-merchant-relations',
  'listing-reports',
  'listing-reviews',
  'listings',
  'locations',
  'media',
  'merchants',
  'pages',
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
  'form-submissions': '提交数据',
  locations: '行政区域',
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
