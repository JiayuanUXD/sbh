/**
 * 房源 / 楼盘变化后的公开目录缓存失效 hook。
 *
 * 为什么需要它：`lib/frontend/cached-queries.ts` 给所有公开查询包了
 * `unstable_cache({ revalidate: 300 })`。在此之前，仓库里**没有任何**供给侧失效接线——
 * `Articles` / `Pages` / `CitySiteProfiles` / `Locations` 四个 collection 各自挂了失效钩子，
 * 但 `Listings` / `Buildings` 一个都没有，而 `cache-invalidator.ts` 那条事件驱动链路
 * （`registerCacheInvalidatorConsumers`）写完了却从未在生产接线。
 * 结果就是后台下架一条房源之后，城市列表 / 首页 / facet / sitemap 最长陈旧 5 分钟，
 * 房源还挂在搜索结果里，点进去 404。
 *
 * 失效范围为什么是城市级：见 `lib/frontend/public-cache-revalidation.ts`
 * 的 `invalidateSupplyPublicCache` 注释。
 *
 * 边界与容错：
 *   - 失效失败**不阻断业务写入**。`revalidatePublicCacheTags` 已逐 tag 兜底，
 *     这里额外保证城市解析本身不抛。
 *   - 城市反查必须走 `findByIdSafe`，**不能**是 `try { findByID } catch { null }`。
 *     后者查不到时会连带回滚调用方的写入事务（Payload 的 operation catch 里
 *     `killTransaction(req)` 回滚的是整个 req 的事务），而错被这里吞掉，
 *     调用方看到「保存成功、数据没变」。原因与实测见 `domain/shared/transaction-safety.ts`。
 *   - 换楼盘 / 换城市要同时失效新旧两侧，否则旧城市的列表会留着一条已经搬走的房源。
 *   - `revalidateTag` 依赖 Next 请求上下文。后台保存走 Next route handler，有上下文；
 *     Job / 脚本里批量写入没有上下文，会被统一降级成一条 warn（见 revalidatePublicCacheTags），
 *     那类链路应由调用方在请求上下文里做一次批量失效，或退回 TTL 兜底。
 */

import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  PayloadRequest,
} from 'payload'

import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'
import { findByIdSafe } from '@/domain/shared/transaction-safety'
import {
  invalidateSupplyPublicCache,
  type SupplyCacheInvalidationReason,
} from '@/lib/frontend/public-cache-revalidation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** relationship 字段可能是 id，也可能是已展开的文档；两种形态都要能取到 id。 */
function relationshipId(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && value.trim() !== '') return value
  if (!isRecord(value)) return null
  return relationshipId(value.id)
}

/** 已展开的 relationship 上直接读 slug，省一次查询。 */
function citySlugFromPopulated(value: unknown): string | null {
  if (!isRecord(value)) return null
  return normalizeCitySlug(value.slug)
}

async function findCitySlugById(
  req: PayloadRequest,
  cityId: number | string,
): Promise<string | null> {
  const city = await findByIdSafe<{ type?: unknown; slug?: unknown }>({
    req,
    collection: 'locations',
    id: cityId,
    depth: 0,
    operation: 'supply-cache:location',
  })
  if (!city) return null
  return city.type === 'city' ? normalizeCitySlug(city.slug) : null
}

/** 楼盘文档 → 所属城市 slug。楼盘的 city 是可选 relationship，解析不出返回 null。 */
async function citySlugOfBuildingDoc(
  req: PayloadRequest,
  buildingDoc: unknown,
): Promise<string | null> {
  if (!isRecord(buildingDoc)) return null
  const populated = citySlugFromPopulated(buildingDoc.city)
  if (populated) return populated
  const cityId = relationshipId(buildingDoc.city)
  return cityId === null ? null : findCitySlugById(req, cityId)
}

/** 房源文档 → 所属城市 slug。房源不直接挂城市，要经楼盘。 */
async function citySlugOfListingDoc(
  req: PayloadRequest,
  listingDoc: unknown,
): Promise<string | null> {
  if (!isRecord(listingDoc)) return null

  // depth≥2 时 building.city 已经展开，直接读。
  const fromPopulated = isRecord(listingDoc.building)
    ? citySlugFromPopulated(listingDoc.building.city)
    : null
  if (fromPopulated) return fromPopulated

  const buildingId = relationshipId(listingDoc.building)
  if (buildingId === null) return null
  const building = await findByIdSafe({
    req,
    collection: 'buildings',
    id: buildingId,
    depth: 0,
    // 软删楼盘旗下的房源照样要失效它所在城市的缓存——下架/编辑这类操作
    // 恰恰发生在楼盘已经被软删之后，漏掉它旧列表页就一直挂着这条房源。
    trash: true,
    operation: 'supply-cache:building',
  })
  if (!building) return null
  return citySlugOfBuildingDoc(req, building)
}

type CitySlugResolver = (req: PayloadRequest, doc: unknown) => Promise<string | null>

/**
 * 收集本次变更涉及的城市：当前文档 + 变更前文档。
 * 两者不同说明房源换了楼盘 / 楼盘换了城市，新旧城市都要失效。
 */
async function collectCitySlugs(
  req: PayloadRequest,
  resolve: CitySlugResolver,
  docs: readonly unknown[],
): Promise<string[]> {
  const slugs = new Set<string>()
  for (const doc of docs) {
    if (doc === undefined || doc === null) continue
    const slug = await resolve(req, doc)
    if (slug) slugs.add(slug)
  }
  return [...slugs]
}

/**
 * 解析城市 → 失效。变更与删除两条路径共用，保证留痕口径一致。
 *
 * 解析不出城市**不等于**可以跳过失效：文档确实变了，只是算不出精确范围，
 * 该退化到类目级兜底（由 `invalidateSupplyPublicCache` 承担），同时留痕——
 * 房源查不到所属城市通常意味着 building 关系断了或城市数据被停用，是数据问题。
 */
async function invalidateForDocs(
  req: PayloadRequest,
  resolve: CitySlugResolver,
  reason: SupplyCacheInvalidationReason,
  docs: readonly unknown[],
): Promise<void> {
  const citySlugs = await collectCitySlugs(req, resolve, docs)
  if (citySlugs.length === 0) {
    console.error('[supply-cache-invalidation] city_unresolved', {
      reason,
      objectId: isRecord(docs[0]) ? docs[0].id : null,
      errorCode: 'city_slug_unresolved',
    })
  }
  invalidateSupplyPublicCache(citySlugs, reason)
}

function createAfterChangeHook(
  resolve: CitySlugResolver,
  reason: SupplyCacheInvalidationReason,
): CollectionAfterChangeHook {
  return async ({ doc, previousDoc, req }) => {
    await invalidateForDocs(req, resolve, reason, [doc, previousDoc])
    return doc
  }
}

function createAfterDeleteHook(
  resolve: CitySlugResolver,
  reason: SupplyCacheInvalidationReason,
): CollectionAfterDeleteHook {
  return async ({ doc, req }) => {
    await invalidateForDocs(req, resolve, reason, [doc])
    return doc
  }
}

export const invalidateListingPublicCacheAfterChange =
  createAfterChangeHook(citySlugOfListingDoc, 'listing')
export const invalidateListingPublicCacheAfterDelete =
  createAfterDeleteHook(citySlugOfListingDoc, 'listing')
export const invalidateBuildingPublicCacheAfterChange =
  createAfterChangeHook(citySlugOfBuildingDoc, 'building')
export const invalidateBuildingPublicCacheAfterDelete =
  createAfterDeleteHook(citySlugOfBuildingDoc, 'building')

/**
 * 按父文档 id 解析受影响城市，供「不是文档自身写入」的链路复用。
 *
 * 现有消费方：媒体删除时摘除房源 / 楼盘的图集与媒体工作台引用
 * （`domain/media/media-delete-cleanup.ts`，OPT-070）。那条链路直接删数组子表行、
 * 不经过 Listings / Buildings 的 afterChange，因此拿不到 doc，只有 `_parent_id`。
 *
 * 走一次 `payload.find` 而不是逐条 `findByID`：一次删图可能牵动多条房源，
 * 而 `findByID` 查不到时会连带回滚调用方的事务（原因见 `shared/transaction-safety.ts`）。
 * 带 `trash: true`——软删的房源 / 楼盘照样引用着这张图，它们所在城市的缓存照样要失效。
 */
export async function resolveSupplyCitySlugs(
  req: PayloadRequest,
  reason: SupplyCacheInvalidationReason,
  ids: readonly (number | string)[],
): Promise<string[]> {
  if (ids.length === 0) return []
  const found = await req.payload.find({
    collection: reason === 'listing' ? 'listings' : 'buildings',
    where: { id: { in: [...ids] } },
    depth: 0,
    limit: ids.length,
    overrideAccess: true,
    trash: true,
    req,
  })
  const resolve = reason === 'listing' ? citySlugOfListingDoc : citySlugOfBuildingDoc
  return collectCitySlugs(req, resolve, found.docs)
}
