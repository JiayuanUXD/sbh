import type { CollectionBeforeValidateHook } from 'payload'

import { ensureUniqueSlug, slugify } from '@/domain/shared/slug'
import type { Building } from '@/payload-types'

/** 在 required 字段校验前补齐标识；已存地址不随名称或普通保存而变化。 */
export const ensureBuildingSlug: CollectionBeforeValidateHook<Building> = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (!data || (typeof data.slug === 'string' && data.slug.trim())) return data

  if (operation === 'update' && typeof originalDoc?.slug === 'string' && originalDoc.slug.trim()) {
    return { ...data, slug: originalDoc.slug }
  }

  const name = typeof data.name === 'string' ? data.name : originalDoc?.name
  if (!name) return data // 缺少名称仍由名称字段的 required 校验拒绝。

  const selfId = operation === 'update' ? originalDoc?.id : undefined
  const slug = await ensureUniqueSlug(slugify(name) || 'building', async (candidate) => {
    const result = await req.payload.find({
      collection: 'buildings',
      where: {
        slug: { equals: candidate },
        ...(selfId !== undefined ? { id: { not_equals: selfId } } : {}),
      },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      trash: true,
      req,
    })
    return result.totalDocs > 0
  })

  return { ...data, slug }
}
