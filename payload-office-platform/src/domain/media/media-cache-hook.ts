/**
 * 删除 media 后，让**所有引用它的公开页面缓存**失效。
 *
 * ## 病理：删 media 不经过任何父文档的写入路径
 *
 * 引用 `media` 的外键几乎全是 `ON DELETE SET NULL`（2026-09-05 真库实测：17 条外键里
 * 15 条 SET NULL、2 条 CASCADE）。删除一条 media 时，**PostgreSQL 在同一条 DELETE 语句里
 * 直接把父表的引用列置空**，父文档（城市站点配置 / 站点设置 / 内容页 / 资讯 / 区域 /
 * 楼盘 / 房源）根本不经过 Payload 的 update，于是它们各自的 afterChange 失效钩子
 * （`invalidateCitySiteProfilePublicCache` 等）**一次都不会触发**。
 *
 * 后果：前台在缓存自然过期前继续渲染那条已经删掉的文件 URL。以城市页为例，
 * `app/(frontend)/_lib/city-context.ts` 用 `unstable_cache` 缓存整份已映射好的
 * city profile（含 media URL），`CITY_PROFILE_REVALIDATE_SECONDS = 300`——删掉 hero 图后
 * 最长 5 分钟里首页照样吐旧 URL，浏览器拿到 404，页面破图。
 *
 * 所以正解是在 media 这一侧反查父文档，而不是去某一个 collection 上打补丁——
 * 消费方有七个，逐个打补丁既漏又散。
 *
 * ## 为什么反查必须在 beforeDelete
 *
 * `SET NULL` 在 DELETE 语句执行时就生效。等到 `afterDelete`，父表里那些
 * `cover_image_id` 已经是 NULL，按 media id 反查**一条都查不到**——钩子看起来跑了，
 * 实际什么都没失效。因此：
 *
 *   - `beforeDelete`：反查所有消费方，把算好的 tag 集合暂存到 `req.context`；
 *   - `afterDelete`：删除真的成功了，才把这批 tag 发出去。
 *
 * 拆成两步而不是在 beforeDelete 里直接失效，是因为删除可能失败（例如 `mediaItems.resource`
 * 这类 `NOT NULL` + `SET NULL` 的死结会抛 23502）。失败时不该动缓存。
 *
 * ## 容错口径
 *
 *   - 反查查询一律走 `findSafe` / `findGlobalSafe`：`try { find } catch { null }` 的写法
 *     在出错时会连带回滚调用方的删除事务（原因与实测见 `domain/shared/transaction-safety.ts`）。
 *   - **查询失败 ≠ 没有引用**。`findSafe` 用 `null` 和 `[]` 区分这两件事；查询失败时
 *     按该消费方的类目级 tag 保守失效并留痕，绝不静默当成「没引用」。
 *   - 失效本身不阻断删除：`revalidatePublicCacheTags` 已逐 tag 兜底，脚本 / Job 里
 *     没有 Next 请求上下文会统一降级成一条 warn。
 *
 * ## 不在范围内
 *
 * `ListingReports.evidence.image`（举报证据图）也引用 media，但举报是后台审核内容，
 * 不出现在任何公开页面、也没有对应的公开缓存 tag，反查它纯属浪费一次查询。
 */

import type {
  CollectionAfterDeleteHook,
  CollectionBeforeDeleteHook,
  CollectionSlug,
  PayloadRequest,
  Where,
} from 'payload'

import {
  tagsForLocationVisibilityChange,
  tagsForProfileChange,
  type CityCacheInvalidationRecord,
} from '@/domain/city-site-profile/cache-invalidator'
import {
  ARTICLES_CATEGORY_TAG,
  BUILDINGS_CATEGORY_TAG,
  LISTINGS_CATEGORY_TAG,
  PAGES_CATEGORY_TAG,
  SITEMAP_TAG,
  SITE_SETTINGS_TAG,
  cityLevelSafeInvalidationTags,
} from '@/domain/public-catalog/cache-tags'
import {
  citySlugOfBuildingDoc,
  citySlugOfListingDoc,
} from '@/domain/public-catalog/supply-cache-hook'
import { findGlobalSafe, findSafe } from '@/domain/shared/transaction-safety'
import { invalidateMediaConsumersPublicCache } from '@/lib/frontend/public-cache-revalidation'

/**
 * 单个消费方一次反查最多取多少条。
 *
 * 一张图正常只挂在一个父文档上（封面、图集行都是逐条上传的），100 条是给
 * 「同一张图被复用到多个楼盘」这类情况留的余量。
 */
const CONSUMER_LOOKUP_LIMIT = 100

/** `req.context` 上暂存反查结果的键。按 media id 分桶，兼容 `payload.delete({ where })` 批删。 */
const MEDIA_CACHE_TAGS_CONTEXT_KEY = 'mediaDeleteCacheTags'

/** 反查整体失败时的保守兜底：七个消费方的类目级 tag 全打一遍。 */
const ALL_CONSUMER_CATEGORY_TAGS: readonly string[] = [
  ARTICLES_CATEGORY_TAG,
  PAGES_CATEGORY_TAG,
  SITE_SETTINGS_TAG,
  LISTINGS_CATEGORY_TAG,
  BUILDINGS_CATEGORY_TAG,
  SITEMAP_TAG,
]

type TagBuckets = Record<string, string[]>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is number | string {
  return (
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === 'string' && value.trim().length > 0)
  )
}

/** relationship / upload 字段可能是裸 id，也可能是已展开的文档。 */
function relationshipId(value: unknown): number | string | null {
  if (isIdentifier(value)) return value
  if (!isRecord(value)) return null
  return isIdentifier(value.id) ? value.id : null
}

/** id 可能是 number 也可能是 string（Payload 两种都允许），一律按字符串比。 */
function referencesMedia(value: unknown, mediaId: number | string): boolean {
  const id = relationshipId(value)
  return id !== null && String(id) === String(mediaId)
}

function addAll(target: Set<string>, tags: readonly string[]): void {
  for (const tag of tags) target.add(tag)
}

function logLookupFailure(consumer: string, mediaId: number | string): void {
  // 反查失败会让失效范围退化成类目级——不致命，但说明有查询在报错，必须留痕。
  console.error('[media-cache-invalidation] lookup_failed', {
    consumer,
    objectId: mediaId,
    errorCode: 'media_consumer_lookup_failed',
  })
}

/** 任一 upload/relationship 字段命中这张图即算引用。 */
function anyFieldEquals(paths: readonly string[], mediaId: number | string): Where {
  return { or: paths.map((path) => ({ [path]: { equals: mediaId } })) }
}

/**
 * 「有没有引用」型消费方（资讯、内容页）：命中就整批失效类目 tag，不需要逐条算。
 * 与 `Articles` / `Pages` 自己的 afterChange 钩子失效的是同一组 tag。
 */
async function addCategoryConsumerTags(args: {
  req: PayloadRequest
  tags: Set<string>
  mediaId: number | string
  consumer: string
  collection: CollectionSlug
  paths: readonly string[]
  categoryTags: readonly string[]
}): Promise<void> {
  const { req, tags, mediaId, consumer, collection, paths, categoryTags } = args
  const docs = await findSafe({
    req,
    collection,
    where: anyFieldEquals(paths, mediaId),
    depth: 0,
    limit: 1,
    operation: `media-cache:${consumer}`,
  })
  if (docs === null) {
    logLookupFailure(consumer, mediaId)
    addAll(tags, categoryTags)
    return
  }
  if (docs.length > 0) addAll(tags, categoryTags)
}

/**
 * 城市站点配置与区域：两者的 tag 都由所属城市决定，`depth: 1` 正好把 `city`
 * 展开出 slug，省掉逐条再查一次 locations。解析不出城市时
 * `tagsFor*` 自带类目级兜底，这里不重新发明。
 */
async function addCityScopedConsumerTags(args: {
  req: PayloadRequest
  tags: Set<string>
  mediaId: number | string
  consumer: string
  collection: CollectionSlug
  paths: readonly string[]
  toTags: (record: CityCacheInvalidationRecord) => readonly string[]
}): Promise<void> {
  const { req, tags, mediaId, consumer, collection, paths, toTags } = args
  const docs = await findSafe<Record<string, unknown>>({
    req,
    collection,
    where: anyFieldEquals(paths, mediaId),
    depth: 1,
    limit: CONSUMER_LOOKUP_LIMIT,
    operation: `media-cache:${consumer}`,
  })
  if (docs === null) {
    logLookupFailure(consumer, mediaId)
    // 传一个解析不出城市的空记录，让 tagsFor* 自己给出它定义的类目级兜底集合。
    addAll(tags, toTags({ id: 0 }))
    return
  }
  for (const doc of docs) {
    if (!isIdentifier(doc.id)) continue
    addAll(tags, toTags(doc as CityCacheInvalidationRecord))
  }
}

/**
 * 楼盘 / 房源：走与 `supply-cache-hook` 完全相同的城市解析，保证同一张图无论是
 * 「删房源」还是「删图」触发，失效的 tag 集合一致。
 *
 * `trash: true`：软删的房源 / 楼盘照样握着这张图的外键，它们所在城市的列表缓存
 * 同样可能残留旧 URL。
 *
 * `depth: 0` + 解析器内部的 `findByIdSafe`：depth 2 能一次拿到 `building.city`，
 * 但会把整份房源文档（含图集、富文本）拉回来，代价远高于多两次按 id 的小查询。
 */
async function addSupplyConsumerTags(args: {
  req: PayloadRequest
  tags: Set<string>
  mediaId: number | string
  consumer: 'listings' | 'buildings'
  paths: readonly string[]
}): Promise<void> {
  const { req, tags, mediaId, consumer, paths } = args
  const docs = await findSafe({
    req,
    collection: consumer,
    where: anyFieldEquals(paths, mediaId),
    depth: 0,
    limit: CONSUMER_LOOKUP_LIMIT,
    trash: true,
    operation: `media-cache:${consumer}`,
  })
  if (docs === null) {
    logLookupFailure(consumer, mediaId)
    addAll(tags, [LISTINGS_CATEGORY_TAG, BUILDINGS_CATEGORY_TAG, SITEMAP_TAG])
    return
  }
  const resolve = consumer === 'listings' ? citySlugOfListingDoc : citySlugOfBuildingDoc
  for (const doc of docs) {
    const citySlug = await resolve(req, doc)
    if (!citySlug) {
      // 与 supply-cache-hook 同一口径：算不出城市不等于可以跳过，退化成类目级并留痕。
      console.error('[media-cache-invalidation] city_unresolved', {
        consumer,
        objectId: isRecord(doc) ? doc.id : null,
        errorCode: 'city_slug_unresolved',
      })
    }
    addAll(tags, cityLevelSafeInvalidationTags(citySlug))
  }
}

/**
 * 站点设置是 Global，没法用 `find` 按引用反查，只能取回来逐字段比。
 * `depth: 0` 足够——两个字段要的都只是 id。
 */
async function addSiteSettingsTags(
  req: PayloadRequest,
  tags: Set<string>,
  mediaId: number | string,
): Promise<void> {
  const settings = await findGlobalSafe<Record<string, unknown>>({
    req,
    slug: 'site-settings',
    depth: 0,
    operation: 'media-cache:site-settings',
  })
  if (settings === null) {
    logLookupFailure('site-settings', mediaId)
    tags.add(SITE_SETTINGS_TAG)
    return
  }

  const typeCards = Array.isArray(settings.typeCards) ? settings.typeCards : []
  const referenced =
    referencesMedia(settings.logo, mediaId) ||
    typeCards.some((card) => isRecord(card) && referencesMedia(card.coverImage, mediaId))

  if (referenced) tags.add(SITE_SETTINGS_TAG)
}

/**
 * 反查全部公开消费方，返回本次删除应当失效的 tag 集合。
 *
 * 顺序执行而不是 `Promise.all`：这些查询跑在同一笔删除事务的同一条 pg 连接上，
 * 并发下发会撞上「同一 client 上一条查询还没结束」。
 */
export async function collectMediaConsumerCacheTags(
  req: PayloadRequest,
  mediaId: number | string,
): Promise<string[]> {
  const tags = new Set<string>()

  await addCategoryConsumerTags({
    req,
    tags,
    mediaId,
    consumer: 'articles',
    collection: 'articles',
    paths: ['coverImage'],
    categoryTags: [ARTICLES_CATEGORY_TAG, SITEMAP_TAG],
  })

  await addCategoryConsumerTags({
    req,
    tags,
    mediaId,
    consumer: 'pages',
    collection: 'pages',
    paths: ['hero.image'],
    categoryTags: [PAGES_CATEGORY_TAG, SITEMAP_TAG],
  })

  await addCityScopedConsumerTags({
    req,
    tags,
    mediaId,
    consumer: 'city-site-profiles',
    collection: 'city-site-profiles',
    paths: ['heroMedia', 'heroVideo', 'typeCardOverrides.coverImage'],
    toTags: tagsForProfileChange,
  })

  await addCityScopedConsumerTags({
    req,
    tags,
    mediaId,
    consumer: 'locations',
    collection: 'locations',
    paths: ['coverImage'],
    toTags: tagsForLocationVisibilityChange,
  })

  await addSupplyConsumerTags({
    req,
    tags,
    mediaId,
    consumer: 'buildings',
    paths: ['coverImage', 'gallery.image', 'mediaItems.resource'],
  })

  await addSupplyConsumerTags({
    req,
    tags,
    mediaId,
    consumer: 'listings',
    paths: ['coverImage', 'gallery.image', 'mediaItems.resource'],
  })

  await addSiteSettingsTags(req, tags, mediaId)

  return [...tags]
}

function tagBucketsOf(context: unknown): TagBuckets | null {
  if (!isRecord(context)) return null
  const existing = context[MEDIA_CACHE_TAGS_CONTEXT_KEY]
  if (isRecord(existing)) return existing as TagBuckets
  const created: TagBuckets = {}
  context[MEDIA_CACHE_TAGS_CONTEXT_KEY] = created
  return created
}

/**
 * `Media.hooks.beforeDelete`：趁父文档的外键还指着这张图，把要失效的 tag 算出来存好。
 * 算完丢在 `req.context` 上，等 `afterDelete` 确认删除成功后再真正失效。
 */
export const collectMediaCacheTagsBeforeDelete: CollectionBeforeDeleteHook = async ({
  context,
  id,
  req,
}) => {
  const buckets = tagBucketsOf(context)
  if (!buckets) return
  buckets[String(id)] = await collectMediaConsumerCacheTags(req, id)
}

/**
 * `Media.hooks.afterDelete`：删除已经落库，把 `beforeDelete` 算好的 tag 发出去。
 *
 * 拿不到暂存结果（理论上只可能是 beforeDelete 没跑）时不静默——那意味着这次删除
 * 的缓存失效整个丢了，必须留痕，并退化成类目级兜底。
 */
export const invalidateMediaConsumerCacheAfterDelete: CollectionAfterDeleteHook = async ({
  context,
  doc,
  id,
}) => {
  const buckets = tagBucketsOf(context)
  const key = String(id)
  const tags = buckets?.[key]

  if (!Array.isArray(tags)) {
    console.error('[media-cache-invalidation] tags_missing', {
      objectId: id,
      errorCode: 'media_cache_tags_missing',
    })
    invalidateMediaConsumersPublicCache(ALL_CONSUMER_CATEGORY_TAGS)
    return doc
  }

  if (buckets) delete buckets[key]
  invalidateMediaConsumersPublicCache(tags)
  return doc
}
