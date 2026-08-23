/**
 * 批量导入写入 Job / 批次回滚 → 供给缓存失效的编排层（OPT-041 D11）。
 *
 * 纯 tag 组装在 `lib/frontend/public-cache-revalidation.ts` 的
 * `invalidateSupplyImportPublicCache`；这里只负责这一步之前唯一的 IO：把批次行里
 * 的城市 id（`Locations` 主键）解析成前台缓存 tag 用的城市 slug。调用方
 * （`import-task.ts` 的写入 Job、`bulk-import-endpoint.ts` 的回滚 handler）各自
 * 已经手上有一批 cityId（来自 ValidBuildingRow/ValidListingRow.cityId 或批次持久化
 * 的 validRows[].cityId），传进来即可，不用各自重复写一遍"查 locations 拿 slug"。
 */

import type { Payload, PayloadRequest } from 'payload'

import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'
import { invalidateSupplyImportPublicCache } from '@/lib/frontend/public-cache-revalidation'

/**
 * 按 id 批量查 Locations，取出合法的城市 slug（去重、过滤解析不出来的）。
 * 空输入直接返回空数组，不发查询——空数组本身对
 * `invalidateSupplyImportPublicCache` 就是"退化为全城市兜底"的合法输入。
 */
export async function resolveCitySlugs(
  payload: Payload,
  req: PayloadRequest | undefined,
  cityIds: ReadonlyArray<number | string>,
): Promise<string[]> {
  const uniqueIds = [...new Set(cityIds.map((id) => String(id)))]
  if (uniqueIds.length === 0) return []

  const result = await payload.find({
    collection: 'locations',
    where: { id: { in: uniqueIds } },
    depth: 0,
    limit: 0,
    overrideAccess: true,
    req,
  })

  const slugs = new Set<string>()
  for (const doc of result.docs) {
    const slug = normalizeCitySlug((doc as { slug?: unknown }).slug)
    if (slug) slugs.add(slug)
  }
  return [...slugs]
}

/**
 * 解析城市 slug + 触发失效的组合入口。任何异常（查询失败、revalidateTag 抛错）
 * 都不向上抛——缓存失效是止血能力的锦上添花，绝不能让它的失败掩盖掉"批次其实已经
 * 写完 / 已经回滚成功"这个更重要的事实。调用方仍应记录失败（见调用点注释），
 * 但不应该让整个 Job / endpoint 因此判失败。
 */
export async function invalidateSupplyImportCache(
  payload: Payload,
  req: PayloadRequest | undefined,
  cityIds: ReadonlyArray<number | string>,
  reason: 'supply_import' | 'supply_import_rollback',
): Promise<void> {
  const citySlugs = await resolveCitySlugs(payload, req, cityIds)
  invalidateSupplyImportPublicCache(citySlugs, reason)
}
