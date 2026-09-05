/**
 * 媒体删除前的引用摘除（OPT-070）。
 *
 * ## 病因
 *
 * 三个数组子表的媒体外键列同时是 `NOT NULL` 和 `ON DELETE SET NULL`——互斥：
 *
 *   listings_gallery.image_id          NOT NULL + SET NULL  ❌
 *   listings_media_items.resource_id   NOT NULL + SET NULL  ❌
 *   buildings_media_items.resource_id  NOT NULL + SET NULL  ❌
 *
 * 删 media 时 PG 试图置 NULL，直接撞非空约束（23502），事务中止，运营只看到
 * 「Something went wrong.」。与 `20260819_113218`（房源硬删）、OPT-050（楼盘硬删）、
 * `20260904_170123`（单城「按类型浏览」封面覆盖）是同一个死结。
 *
 * 根因不在本仓库而在 Payload：`@payloadcms/drizzle` 的 `dist/schema/traverseFields.js`
 * 对**每一个**单值 relationship / upload 列写死 `reference: { onDelete: 'set null' }`，
 * 同时只要 `field.required` 就给列加 `notNull`。「required 的 upload 字段」必然生成
 * 这对自相矛盾的约束，且没有任何配置开关能改 `onDelete`。
 *
 * ## 处方：钩子摘除，而不是放宽 NOT NULL
 *
 * `20260819_113218` 确立的三分口径是「审计表脱钩保留 / 纯关系行由钩子删除 /
 * 有业务含义的引用拦住不删」。这三列属**第二类**：`mediaItems` 行去掉 `resource`
 * 之后，`kind`/`category`/`alt` 描述的是空气；`gallery` 行本身就只有一个 `image`。
 *
 * 所以沿用 OPT-050 面对同一岔路口时的原话（见 `supply/building-delete-cleanup.ts`）：
 * 「**不放宽 NOT NULL**——那只会留下一堆无意义关系行。」
 *
 * 保持 NOT NULL 还顺手保住一条真实不变量：`galleryCount` 在三处都是裸
 * `gallery.length`（`review/review-transition.ts`、`components/admin/listing-review-queue-row.ts`、
 * `components/admin/ListingCompletenessCardClient.tsx`），**不过滤空值**。只要
 * `image_id` 非空，行数就等于真实图片数；一旦放宽，2 张真图会被算成 3 张，
 * 「提交审核至少 3 张」（`MIN_SUBMIT_MEDIA`）那道门就被静默放松了。
 *
 * 推论：**本模块不改 schema，因此没有迁移。**
 *
 * ## 为什么是裸 SQL，不是 payload.update
 *
 * `payload.update()` 会把整条房源写入流水线拖进来，其中 `adminAutoPublish`
 * （`review/admin-auto-publish-hook.ts`）是明确的污染源：管理员删一张图，会顺带把
 * 某条完整度达标的草稿房源推到「已发布」，并写一条 `decision=fast_track` 的审核记录，
 * 把「谁把它直接放上线的」记在删图的人头上。**删一张图不该改任何房源的发布状态。**
 *
 * 裸 SQL 在本仓库是既有模式（`geography/location-counts.ts` 整个模块、
 * `city-partner-application/public-service.ts`）。与那两处不同的是：本模块的 SQL
 * **必须跑在调用方的事务里**，否则 media 删除失败时子表行已经没了。
 *
 * ## 摘除范围
 *
 * 四张数组子表，都是「一行就为了指一张图」：
 *
 *   listings_media_items    死结列
 *   listings_gallery        死结列；且由 mediaItems 派生（syncListingMedia），必须同进退
 *   buildings_media_items   死结列
 *   buildings_gallery       **不是**死结列（image_id 本来可空），但它由 buildings.mediaItems
 *                           派生（syncBuildingMedia）。只删 media_items 不删它，两者会不一致，
 *                           还会留下 image IS NULL 的空行。
 *
 * `buildings_gallery.image_id` 可空、`listings_gallery.image_id` 非空是历史不一致
 * （同一个派生字段的两侧）。**本工作项不动它**：把房源侧改可空会引入上面那个计数缺陷，
 * 把楼盘侧改非空是范围外的收紧。
 *
 * **不碰标量列**（`listings.cover_image_id` / `buildings.cover_image_id` /
 * `pages.hero_image_id` / `site_settings.logo_id` / `articles.cover_image_id` 等 14 列）：
 * 它们本来可空，SET NULL 就是正确语义——字段置空、文档还在、前台走缺省图降级。
 * 这是现在已经在跑的行为，不改。
 */

import { sql, type SQL } from 'drizzle-orm'
import type {
  CollectionAfterDeleteHook,
  CollectionBeforeDeleteHook,
  Payload,
  PayloadRequest,
} from 'payload'

import { resolveSupplyCitySlugs } from '@/domain/public-catalog/supply-cache-hook'
import {
  invalidateSupplyPublicCache,
  type SupplyCacheInvalidationReason,
} from '@/lib/frontend/public-cache-revalidation'

/** 可执行原生 SQL 的最小接口；drizzle 的事务 session 与 `payload.db.drizzle` 都满足。 */
type Queryable = {
  execute: (query: SQL) => Promise<{ rows: Array<Record<string, unknown>> }>
}

type ReferencingTable = {
  /** 数组子表名 */
  table: string
  /** 指向 media 的外键列 */
  column: string
  /** 该子表挂在哪个父 collection 上——决定缓存失效算的是哪一侧的城市 */
  scope: SupplyCacheInvalidationReason
}

const REFERENCING_TABLES: readonly ReferencingTable[] = [
  { table: 'listings_media_items', column: 'resource_id', scope: 'listing' },
  { table: 'listings_gallery', column: 'image_id', scope: 'listing' },
  { table: 'buildings_media_items', column: 'resource_id', scope: 'building' },
  { table: 'buildings_gallery', column: 'image_id', scope: 'building' },
]

/** req.context 上的标记键：beforeDelete 算出受影响城市，afterDelete 消费。 */
const AFFECTED_CITIES_MARK = '__opt070MediaUnmountCities'

type AffectedCities = Record<SupplyCacheInvalidationReason, string[]>

function isQueryable(value: unknown): value is Queryable {
  return typeof (value as Queryable | undefined)?.execute === 'function'
}

/**
 * 取**调用方事务内**的 drizzle executor。
 *
 * `payload.db.drizzle` 是连接池上的顶层 executor，它跑的语句**不在** `req` 的事务里：
 * media 删除随后失败时，这里删掉的子表行不会跟着回滚，房源就凭空少了几张图。
 * 事务 session 的取法与 `city-partner-application/public-service.ts` 一致。
 *
 * 拿不到 session（调用方显式关了事务，如部分脚本链路）时回落到顶层 executor：
 * 此时 media 删除本身也不是事务性的，两者一致，不构成新的不一致窗口。
 */
function transactionExecutor(payload: Payload, req: PayloadRequest): Queryable | null {
  const transactionID = req.transactionID
  if (transactionID !== undefined && transactionID !== null) {
    const session = payload.db.sessions?.[String(transactionID)]
    if (session && isQueryable(session.db)) return session.db
  }
  return isQueryable(payload.db.drizzle) ? payload.db.drizzle : null
}

function toParentId(value: unknown): number | string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  // PG 的 bigint / numeric 经 pg 驱动会以字符串回来，直接透传即可。
  if (typeof value === 'string' && value.trim() !== '') return value
  return null
}

/**
 * 删 media 之前，把引用它的数组子表行摘掉，让 PG 的 SET NULL 无行可置。
 *
 * `beforeDelete` 在 Payload 里对**每个**待删文档各调一次（批量删除也是逐个调），
 * 所以这里只需处理单个 `id`。
 */
export const unmountMediaReferences: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const { payload } = req
  const db = transactionExecutor(payload, req)
  if (!db) return

  const affected: AffectedCities = { listing: [], building: [] }
  const parentsByScope: Record<SupplyCacheInvalidationReason, Set<number | string>> = {
    listing: new Set(),
    building: new Set(),
  }

  for (const { table, column, scope } of REFERENCING_TABLES) {
    const tableRef = sql.identifier(table)
    const columnRef = sql.identifier(column)

    // 先查父文档 id，再删行：删完就查不到了，而缓存失效需要知道动了谁。
    const found = await db.execute(
      sql`SELECT DISTINCT "_parent_id" FROM ${tableRef} WHERE ${columnRef} = ${id}`,
    )
    for (const row of found.rows) {
      const parentId = toParentId(row._parent_id)
      if (parentId !== null) parentsByScope[scope].add(parentId)
    }

    // 失败必须抛出、不能吞：吞掉的话删除会继续走到 PG，然后撞上 SET NULL + NOT NULL
    // 那个死结，运营又会看到一个无法理解的 500。
    await db.execute(sql`DELETE FROM ${tableRef} WHERE ${columnRef} = ${id}`)
  }

  // 城市在 beforeDelete 里就解析好：此刻文档还完整，afterDelete 只做纯失效、不再打库。
  for (const scope of ['listing', 'building'] as const) {
    affected[scope] = await resolveSupplyCitySlugs(req, scope, [...parentsByScope[scope]])
  }

  const context = ((req as { context?: Record<string, unknown> }).context ??= {})
  context[AFFECTED_CITIES_MARK] = affected
}

/**
 * 摘除完成后失效受影响城市的公开目录缓存。
 *
 * 为什么本工作项要带上它：改之前，删一张被图集引用的图**必然失败**，所以从来不会
 * 出现「缓存里挂着已删图片 URL」的窗口；改之后删除会成功，这个窗口是本次改动
 * 造出来的（`lib/frontend/cached-queries.ts` 的 `revalidate: 300`，最长陈旧 5 分钟）。
 *
 * 只对**真的摘掉过行**的城市失效：没有引用时 beforeDelete 不置位，这里直接返回。
 * 标量封面列（coverImage / hero / logo）的删除不在此列——它们本来就能删，
 * 其缓存行为与本次改动无关，不在此扩大范围。
 */
export const invalidateSupplyCacheAfterMediaDelete: CollectionAfterDeleteHook = async ({
  doc,
  req,
}) => {
  const context = (req as { context?: Record<string, unknown> }).context
  const affected = context?.[AFFECTED_CITIES_MARK] as AffectedCities | undefined
  if (!affected) return doc

  for (const scope of ['listing', 'building'] as const) {
    if (affected[scope].length > 0) invalidateSupplyPublicCache(affected[scope], scope)
  }
  return doc
}
