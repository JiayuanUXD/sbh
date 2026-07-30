/**
 * 房源保护 hook（tasks.md M4.1 / design §3.4 / R3, R4）
 *
 * 守护不变量（读库无副作用，纯字段级判定；跨文档校验在完整度校验/审核/发布 endpoint）：
 *   1. create 初始化三轴状态：审核 review_status=not_submitted、发布
 *      publication_status=draft、供给冻结 supply_visibility_hold=normal + version=1。
 *      仅在客户端未显式给值时补默认，不覆盖已给的合法值。
 *   2. 枚举二次校验：客户端可绕过 admin select 直接打 REST，非法枚举一律拒绝
 *      （InvalidOperationError，domain:'review'）。校验审核轴/发布轴/供给冻结轴，
 *      以及房源自身的租售类型 business_type、装修 decoration_status。
 *   3. 版本乐观锁：update 提交的 version 与库内不符 → VersionConflictError(409)；
 *      一致则自增，未提交则按当前版本自增。
 *
 * R3：状态轴的变更由显式审核/发布 endpoint 驱动，本 hook 不隐式改写；update 时
 * 绝不重置三轴状态（只有 create 缺省时初始化）。
 */

import type { CollectionBeforeChangeHook } from 'payload'
import { InvalidOperationError, VersionConflictError } from '@/domain/shared/errors'
import { ensureUniqueSlug, slugify } from '@/domain/shared/slug'
import { isReviewStatus } from './review-status'
import { isPublicationStatus, isSupplyVisibilityHold } from './publication-status'
import { isBusinessType, isDecorationStatus } from './listing-fields'

/** 可选枚举字段：给了就必须合法，没给放行（可空）。 */
function assertOptionalEnum(
  value: unknown,
  guard: (v: unknown) => boolean,
  code: string,
  message: string,
): void {
  if (value === undefined || value === null || value === '') return
  if (!guard(value)) {
    throw new InvalidOperationError({ domain: 'review', code, message })
  }
}

export const protectListing: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  // —— 枚举二次校验（审核/发布/供给冻结三轴 + 房源自身枚举）——
  assertOptionalEnum(
    data?.reviewStatus,
    isReviewStatus,
    'INVALID_REVIEW_STATUS',
    '非法的审核状态',
  )
  assertOptionalEnum(
    data?.publicationStatus,
    isPublicationStatus,
    'INVALID_PUBLICATION_STATUS',
    '非法的发布状态',
  )
  assertOptionalEnum(
    data?.supplyVisibilityHold,
    isSupplyVisibilityHold,
    'INVALID_SUPPLY_VISIBILITY_HOLD',
    '非法的供给可见性冻结态',
  )
  assertOptionalEnum(
    data?.businessType,
    isBusinessType,
    'INVALID_BUSINESS_TYPE',
    '非法的租售类型',
  )
  assertOptionalEnum(
    data?.decorationStatus,
    isDecorationStatus,
    'INVALID_DECORATION_STATUS',
    '非法的装修状态',
  )

  // —— slug 自动生成：留空时根据标题生成拼音 slug，冲突时追加序号 ——
  // 用户手动填写的 slug 不会被覆盖；仅当 slug 为空字符串/undefined 时自动生成。
  const title = typeof data?.title === 'string' ? data.title : ''
  const currentSlug = typeof data?.slug === 'string' ? data.slug.trim() : ''
  const originalSlug =
    originalDoc && typeof (originalDoc as { slug?: unknown }).slug === 'string'
      ? ((originalDoc as { slug: string }).slug as string)
      : ''

  const needGenerateSlug = !currentSlug && title
  if (needGenerateSlug) {
    // 若 update 场景下原有 slug 已存在且标题未变，保留原 slug（不重新生成）
    if (operation === 'update' && originalSlug) {
      data.slug = originalSlug
    } else {
      const base = slugify(title)
      if (base) {
        const selfId =
          operation === 'update' && originalDoc?.id
            ? String((originalDoc as { id: unknown }).id)
            : undefined
        data.slug = await ensureUniqueSlug(base, async (candidate) => {
          const res = await req.payload.find({
            collection: 'listings',
            where: {
              slug: { equals: candidate },
              ...(selfId ? { id: { not_equals: selfId } } : {}),
            },
            limit: 1,
          })
          return res.totalDocs > 0
        })
      }
    }
  }

  if (operation === 'create') {
    // —— 三轴状态缺省初始化（不覆盖已显式给定的合法值）——
    if (data.reviewStatus === undefined || data.reviewStatus === null || data.reviewStatus === '') {
      data.reviewStatus = 'not_submitted'
    }
    if (
      data.publicationStatus === undefined ||
      data.publicationStatus === null ||
      data.publicationStatus === ''
    ) {
      data.publicationStatus = 'draft'
    }
    if (
      data.supplyVisibilityHold === undefined ||
      data.supplyVisibilityHold === null ||
      data.supplyVisibilityHold === ''
    ) {
      data.supplyVisibilityHold = 'normal'
    }
    data.version = 1
  } else if (operation === 'update' && originalDoc) {
    // —— 版本乐观锁 ——
    const currentVersion = typeof originalDoc.version === 'number' ? originalDoc.version : 1
    const submitted = data?.version
    if (typeof submitted === 'number' && submitted !== currentVersion) {
      throw new VersionConflictError({
        domain: 'review',
        resource: '房源',
        expectedVersion: currentVersion,
        actualVersion: submitted,
      })
    }
    data.version = currentVersion + 1
  }

  return data
}
