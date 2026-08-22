import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionConfig,
  PayloadRequest,
} from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import {
  tagsForProfileChange,
  type CityCacheInvalidationRecord,
} from '@/domain/city-site-profile/cache-invalidator'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import { protectCitySiteProfile } from '@/domain/city-site-profile/profile-protect'
import { CITY_SERVICE_STATUSES } from '@/domain/city-site-profile/schema'
import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'
import { invalidateCitySiteProfilePublicCache } from '@/lib/frontend/public-cache-revalidation'

type Identifier = number | string

function relationshipId(value: unknown): Identifier | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    (typeof value.id === 'number' || typeof value.id === 'string')
  ) {
    return value.id
  }
  return null
}

function toCacheRecord(value: unknown): CityCacheInvalidationRecord | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    (typeof value.id !== 'number' && typeof value.id !== 'string')
  ) {
    return null
  }
  return {
    id: value.id,
    city: 'city' in value ? value.city : undefined,
  }
}

async function resolveCitySlug(
  req: PayloadRequest,
  record: CityCacheInvalidationRecord,
): Promise<string | null> {
  if (typeof record.city === 'object' && record.city !== null && 'slug' in record.city) {
    const populatedSlug = normalizeCitySlug(record.city.slug)
    if (populatedSlug) return populatedSlug
  }

  const cityId = relationshipId(record.city)
  if (cityId === null) return null

  try {
    const city = await req.payload.findByID({
      collection: 'locations',
      id: cityId,
      depth: 0,
      req,
    })
    return city.type === 'city' ? normalizeCitySlug(city.slug) : null
  } catch {
    return null
  }
}

async function invalidateCitySiteProfileCacheRecords(
  doc: unknown,
  previousDoc: unknown,
  req: PayloadRequest,
): Promise<void> {
  const records = [toCacheRecord(doc), toCacheRecord(previousDoc)]
  const tags = new Set<string>()

  for (const record of records) {
    if (!record) continue

    const citySlug = await resolveCitySlug(req, record)
    if (!citySlug) {
      console.error('[city-profile-cache-invalidation] city_unresolved', {
        objectId: record.id,
        errorCode: 'city_slug_unresolved',
      })
    }
    for (const tag of tagsForProfileChange(citySlug ? { ...record, citySlug } : record)) {
      tags.add(tag)
    }
  }

  if (tags.size > 0) invalidateCitySiteProfilePublicCache([...tags], 'city_site_profile')
}

const invalidateCitySiteProfileAfterChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
}) => {
  await invalidateCitySiteProfileCacheRecords(doc, previousDoc, req)
  return doc
}

const invalidateCitySiteProfileAfterDelete: CollectionAfterDeleteHook = async ({ doc, req }) => {
  await invalidateCitySiteProfileCacheRecords(doc, undefined, req)
  return doc
}

export const CitySiteProfiles: CollectionConfig = {
  slug: 'city-site-profiles',
  labels: {
    singular: '城市站点配置',
    plural: '城市站点配置',
  },
  admin: {
    group: false,
    useAsTitle: 'seoTitle',
    defaultColumns: ['city', 'serviceStatus', 'switcherVisible', 'sortOrder', 'updatedAt'],
  },
  access: {
    ...createCollectionAccess({
      create: 'location:manage',
      update: 'location:manage',
    }),
    read: () => true,
    delete: () => false,
  },
  hooks: {
    beforeChange: [protectCitySiteProfile],
    afterChange: [invalidateCitySiteProfileAfterChange],
    afterDelete: [invalidateCitySiteProfileAfterDelete],
  },
  fields: [
    // 分 tab 收口（后台表单优化第二批）：状态类一眼可见，SEO 与首页文案按需切换。
    // 全部 unnamed tab，纯 admin 布局，不影响数据库 schema。
    {
      type: 'tabs',
      tabs: [
        {
          label: '基础与状态',
          description: '城市绑定、服务状态与前台可见性。',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'city',
                  label: '城市',
                  type: 'relationship',
                  relationTo: 'locations',
                  required: true,
                  unique: true,
                  filterOptions: () => activeLocationFilter(['city']),
                },
                {
                  name: 'serviceStatus',
                  label: '服务状态',
                  type: 'select',
                  required: true,
                  options: CITY_SERVICE_STATUSES.map((value) => ({ value, label: value === 'live' ? '已开通' : '筹备中' })),
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'switcherVisible',
                  label: '在城市切换器中显示',
                  type: 'checkbox',
                  required: true,
                  defaultValue: true,
                },
                {
                  name: 'sortOrder',
                  label: '排序',
                  type: 'number',
                  required: true,
                  defaultValue: 100,
                  min: 0,
                },
              ],
            },
          ],
        },
        {
          label: 'SEO',
          description: '站点级标题与描述，影响搜索收录与分享卡片。',
          fields: [
            {
              name: 'seoTitle',
              label: 'SEO 标题',
              type: 'text',
              required: true,
              maxLength: 60,
            },
            {
              name: 'seoDescription',
              label: 'SEO 描述',
              type: 'textarea',
              required: true,
              minLength: 70,
              maxLength: 160,
            },
          ],
        },
        {
          label: '首页内容',
          description: '城市站首页 Hero、简介、委托卡片与精选区域。',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'heroEyebrow', label: 'Hero 眉题', type: 'text' },
                { name: 'heroHeading', label: 'Hero 标题', type: 'text' },
              ],
            },
            { name: 'heroBody', label: 'Hero 正文', type: 'textarea' },
            { name: 'heroMedia', label: 'Hero 媒体', type: 'relationship', relationTo: 'media' },
            { name: 'introHeading', label: '简介标题', type: 'text' },
            { name: 'introBody', label: '简介正文', type: 'textarea' },
            { name: 'contactHeading', label: '委托卡片标题', type: 'text' },
            { name: 'contactBody', label: '委托卡片说明', type: 'textarea' },
            {
              name: 'avgResponseHours',
              label: '平均响应时长（小时）',
              type: 'number',
              min: 0,
              max: 72,
              admin: {
                description: '首页数据带「平均响应」展示值，运营承诺口径；留空则首页不展示该格。',
                step: 0.1,
              },
            },
            {
              name: 'featuredRegions',
              label: '精选区域',
              type: 'relationship',
              relationTo: 'locations',
              hasMany: true,
              maxRows: 12,
              filterOptions: () => activeLocationFilter(['district', 'business_area']),
            },
          ],
        },
      ],
    },
  ],
}
