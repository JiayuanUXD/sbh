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
import { findByIdSafe } from '@/domain/shared/transaction-safety'
import { protectCitySiteProfile } from '@/domain/city-site-profile/profile-protect'
import { CITY_SERVICE_STATUSES } from '@/domain/city-site-profile/schema'
import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'
import { invalidateCitySiteProfilePublicCache } from '@/lib/frontend/public-cache-revalidation'

type Identifier = number | string

/**
 * OPT-053 §6：Hero 文案三件套的作用域说明。
 *
 * 2026-08-21 产品裁定「首屏全站共用一句、不按城市定制」，已开城首页因此**不读**
 * 这里的 heroHeading/heroBody。裁定本身没问题，问题在于字段标签当时没跟着改——
 * 运营看到「Hero 标题」就填，填完首页毫无反应，页面上也没有任何线索解释。
 */
const HERO_COPY_SCOPE_NOTE =
  '仅用于该城**未开通服务**时的招募页。已开城首页的首屏文案在「内容管理 → 站点设置 → 品牌」里改。'

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

  // findByIdSafe 而不是 try/catch 吞 NotFound：后者会连带回滚调用方的写入事务
  // （原因与实测见 domain/shared/transaction-safety.ts）
  const city = await findByIdSafe<{ type?: unknown; slug?: unknown }>({
    req,
    collection: 'locations',
    id: cityId,
    depth: 0,
    operation: 'city-site-profiles-cache:location',
  })
  if (!city) return null
  return city.type === 'city' ? normalizeCitySlug(city.slug) : null
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
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
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
            // OPT-053 §6：这三个文案字段**只作用于未开城页**（ComingSoonCityView），
            // 已开城首页的 H1/副标读全局「站点设置 → 品牌」。
            // 标签必须带「未开城页」前缀——不带的话它们叫「Hero 标题」，运营看到就填，
            // 填完首页纹丝不动，而页面上没有任何线索说明原因。**字段没坏，是标签在撒谎。**
            {
              type: 'row',
              fields: [
                {
                  name: 'heroEyebrow',
                  label: '未开城页 Hero 眉题',
                  type: 'text',
                  admin: { description: HERO_COPY_SCOPE_NOTE },
                },
                {
                  name: 'heroHeading',
                  label: '未开城页 Hero 标题',
                  type: 'text',
                  admin: { description: HERO_COPY_SCOPE_NOTE },
                },
              ],
            },
            {
              name: 'heroBody',
              label: '未开城页 Hero 正文',
              type: 'textarea',
              admin: { description: HERO_COPY_SCOPE_NOTE },
            },
            // 背景媒体与上面三个文案字段的作用域不同：它**首页也生效**，故不加前缀。
            // OPT-053 §4.5：图与视频拆成两个独立字段。此前 HomeHeroMedia 用
            // `{!poster && loadVideo && <video>}`，配了图等于把视频关掉——运营想换底图，
            // 实际效果是动态背景消失。图本就是视频的封面与降级底图，两者不该互斥。
            {
              name: 'heroMedia',
              label: 'Hero 背景图',
              type: 'relationship',
              relationTo: 'media',
              // 不限类型的话，运营选个视频进来会被塞进 <img src=…> 直接破图
              filterOptions: () => ({ mimeType: { contains: 'image' } }),
              admin: { description: '首页与未开城页共用的背景图。同时用作背景视频的封面与降级底图。' },
            },
            {
              name: 'heroVideo',
              label: 'Hero 背景视频',
              type: 'relationship',
              relationTo: 'media',
              filterOptions: () => ({ mimeType: { contains: 'video' } }),
              admin: { description: '留空则用内置的默认背景视频。移动端、省流量模式与「减少动态效果」下一律不加载。' },
            },
            {
              name: 'heroVideoEnabled',
              label: '首屏播放背景视频',
              type: 'checkbox',
              defaultValue: true,
              admin: { description: '关掉则只展示背景图，不播视频。' },
            },
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
            {
              name: 'typeCardOverrides',
              label: '「按类型浏览」封面（本城覆盖）',
              type: 'array',
              maxRows: 5,
              admin: {
                description:
                  '只覆盖封面图，不覆盖文案。某个槽位没配就用「站点设置」里的全局默认；全局也空则回落到该类型第一条房源的封面。',
              },
              fields: [
                {
                  name: 'slot',
                  label: '槽位',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'traditional-office', label: '传统办公位' },
                    { value: 'coworking', label: '联合办公位' },
                    { value: 'full-floor', label: '整层办公位' },
                    { value: 'serviced-office', label: '独栋办公位' },
                    { value: 'creative-park', label: '创意园区位' },
                  ],
                },
                {
                  name: 'coverImage',
                  label: '封面图',
                  type: 'upload',
                  relationTo: 'media',
                  required: true,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
