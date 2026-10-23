import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload'

import { tagsForProfileChange } from '@/domain/city-site-profile/cache-invalidator'
import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'
import { findByIdSafe } from '@/domain/shared/transaction-safety'
import { invalidateCitySiteProfilePublicCache } from '@/lib/frontend/public-cache-revalidation'

type Identifier = number | string

function toId(value: unknown): Identifier | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return null
}

/** 商圈 → 所属城市 slug。取不到返回 null（调用方按「全城」口径失效） */
async function resolveCitySlug(req: PayloadRequest, areaRef: unknown): Promise<string | null> {
  const areaId = toId(areaRef)
  if (areaId === null) return null
  const area = await findByIdSafe<{ city?: unknown }>({
    req,
    collection: 'locations',
    id: areaId,
    depth: 1,
    operation: 'business-area-extension-cache:area',
  })
  const city = area?.city
  if (typeof city === 'object' && city !== null && 'slug' in city) {
    return normalizeCitySlug((city as { slug: unknown }).slug)
  }
  return null
}

async function invalidate(req: PayloadRequest, docs: readonly unknown[]): Promise<void> {
  const tags = new Set<string>()
  for (const doc of docs) {
    if (typeof doc !== 'object' || doc === null || !('businessArea' in doc)) continue
    const record = doc as { id?: unknown; businessArea?: unknown }
    const citySlug = await resolveCitySlug(req, record.businessArea)
    if (!citySlug) {
      console.error('[business-area-extension-cache] city_unresolved', {
        objectId: record.id,
        errorCode: 'city_slug_unresolved',
      })
    }
    // 精选区域变化只影响该城 profile 与首页；slug 取不到时 tagsForProfileChange 回落到全城口径
    const id = toId(record.id)
    if (id === null) continue
    for (const tag of tagsForProfileChange(citySlug ? { id, citySlug } : { id })) tags.add(tag)
  }
  if (tags.size > 0) invalidateCitySiteProfilePublicCache([...tags], 'location')
}

/**
 * 精选序号（`featuredOrder`）决定首页热门商圈 / chips / 招商页 / 未开城页，
 * 而城市 profile 带 unstable_cache + tag（见 city-context.ts）。扩展保存后不失效，
 * 运营改完要等 revalidate 才生效。
 */
export const invalidateBusinessAreaExtensionCache: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
}) => {
  await invalidate(req, [doc, previousDoc])
  return doc
}

export const invalidateDeletedBusinessAreaExtensionCache: CollectionAfterDeleteHook = async ({
  doc,
  req,
}) => {
  await invalidate(req, [doc])
  return doc
}
