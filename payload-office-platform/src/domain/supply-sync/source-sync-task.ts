/**
 * 外部来源同步任务 `run-source-sync`（OPT-104 §5.3）。
 *
 * 一次运行只处理一段（行数上限 + 耗时上限），游标落库，没处理完就给自己续排——照
 * `watermark-rebake.ts` 的写法。不照 `run-supply-import` 的整批一把跑：那条任务运行中不续租约，
 * 超过 15 分钟会被 `recoverStaleSupplyImportJobs` 复位重跑，而一包 1,000 行带图片的楼盘
 * 远超 15 分钟。本任务每段控制在 SLICE_BUDGET_MS 内结束，租约恢复只是兜底（实例被回收时）。
 *
 * 写入规则见 `huizuxuanzhi-apply.ts`；本文件只负责查库、编排、计数与回滚锚点。
 * 每行独立 try/catch：单行失败计入 writeErrors，不阻断同一包的其它行。
 */

import type { Payload, PayloadRequest, TaskConfig, Where } from 'payload'

import { SKIP_SUPPLY_CACHE_INVALIDATION } from '@/domain/public-catalog/supply-cache-hook'
import { resolveDefaultSupplyMerchant, type MerchantLookupPort } from '@/domain/supply/default-merchant'

import {
  buildingCreateData,
  buildingFillPatch,
  huizuDataSource,
  listingCreateData,
  listingUpdatePatch,
  retireDecision,
  type BuildingRefs,
} from './huizuxuanzhi-apply'
import {
  HUIZU_SOURCE,
  isHuizuImageUrl,
  parseHuizuSyncRow,
  type HuizuBuildingRow,
  type HuizuListingRow,
  type HuizuRetireRow,
  type HuizuSyncRow,
} from './huizuxuanzhi-row'

export const SOURCE_SYNC_TASK = 'run-source-sync' as const
export const SOURCE_SYNC_QUEUE = 'source-sync'
/**
 * 每段最多处理的行数。真正的刹车是 SLICE_BUDGET_MS：拉图慢的楼盘段会提前收工落游标；
 * 行数上限只防「全是没图的楼盘」时一段吞太多。楼盘曾设 15，4,442 个楼盘光段间等待就要一小时。
 */
const SLICE_MAX_ROWS = { buildings: 100, listings: 400, retire: 400 } as const
/** 每段耗时上限：到点就收工落游标，留足余量给最后一行与批次落库 */
const SLICE_BUDGET_MS = 90_000
/** 陈旧 processing 租约的释放阈值，与 import-task 同口径 */
export const SOURCE_SYNC_JOB_LEASE_MS = 15 * 60 * 1000
const IMAGE_TIMEOUT_MS = 30_000
const IMAGE_MAX_BYTES = 15 * 1024 * 1024
/** protectBuilding 的图集上限 */
const MAX_BUILDING_IMAGES = 20
const SHANGHAI_SLUG = 'shanghai'

type Stats = {
  created: number
  updated: number
  unchanged: number
  retired: number
  skipped: number
  failed: number
  imagesCreated: number
}
type Affected = {
  createdBuildings: number[]
  filledBuildings: { id: number; filled: string[] }[]
  createdListings: number[]
  /** 只记已上架房源：草稿被覆盖不影响前台，不需要回滚锚点 */
  updatedPublishedListings: { id: number; before: Record<string, unknown> }[]
  retiredListings: number[]
}
type WriteError = { row: number; externalId: string; message: string }

export type SyncContext = Readonly<{
  cityId: number
  districtIdByName: ReadonlyMap<string, number>
  businessAreaId: (districtId: number, name: string | null) => number | null
  merchantId: number | null
  syncedAt: string
}>

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
const toNumber = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isSafeInteger(n) ? n : null
}

// ---------------------------------------------------------------------------
// 查库
// ---------------------------------------------------------------------------

/** 地理与商户上下文：每段开头查一次（一段几百行，查一次的成本可以忽略）。 */
export async function loadSyncContext(payload: Payload, req: PayloadRequest | undefined): Promise<SyncContext> {
  const city = await payload.find({
    collection: 'locations',
    where: { type: { equals: 'city' }, slug: { equals: SHANGHAI_SLUG }, status: { equals: 'active' } },
    depth: 0,
    limit: 2,
    overrideAccess: true,
    req,
  })
  if (city.docs.length !== 1) throw new Error(`上海城市节点应恰有 1 个启用的，实际 ${city.docs.length} 个`)
  const cityId = city.docs[0].id as number

  const districts = await payload.find({
    collection: 'locations',
    where: { type: { equals: 'district' }, parent: { equals: cityId }, status: { equals: 'active' } },
    depth: 0,
    limit: 0,
    overrideAccess: true,
    req,
  })
  const districtIdByName = new Map<string, number>()
  const dupNames = new Set<string>()
  for (const d of districts.docs) {
    const name = String(d.name)
    if (districtIdByName.has(name)) dupNames.add(name)
    districtIdByName.set(name, d.id as number)
  }
  // 同名启用区不止一个时宁可报错也不猜（区合并留下的重复节点见 merge-duplicate-districts.ts）
  for (const name of dupNames) districtIdByName.delete(name)

  const areas = await payload.find({
    collection: 'locations',
    where: { type: { equals: 'business_area' }, parent: { in: [...new Set(districtIdByName.values())] } },
    depth: 0,
    limit: 0,
    overrideAccess: true,
    req,
  })
  const areaKey = (districtId: number, name: string) => `${districtId}::${name}`
  const areaId = new Map<string, number>()
  for (const a of areas.docs) {
    const parentId = toNumber(a.parent)
    if (parentId !== null) areaId.set(areaKey(parentId, String(a.name)), a.id as number)
  }

  const merchant = await resolveDefaultSupplyMerchant(payload as unknown as MerchantLookupPort, { cityId, req })
  return {
    cityId,
    districtIdByName,
    businessAreaId: (districtId, name) => (name ? (areaId.get(areaKey(districtId, name)) ?? null) : null),
    merchantId: toNumber(merchant),
    syncedAt: new Date().toISOString(),
  }
}

async function findBySource(
  payload: Payload,
  req: PayloadRequest | undefined,
  collection: 'buildings' | 'listings',
  externalId: string,
): Promise<Record<string, unknown> | null> {
  const where: Where = {
    and: [{ 'dataSource.source': { equals: HUIZU_SOURCE } }, { 'dataSource.externalId': { equals: externalId } }],
  }
  const res = await payload.find({
    collection,
    where,
    // 软删的也要找到：externalId 局部唯一索引覆盖软删行，找不到就去 create 会撞索引
    trash: true,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  return (res.docs[0] as unknown as Record<string, unknown> | undefined) ?? null
}

/** slug 撞了就加后缀；源 slug 已含对方 id，撞车只会来自手工楼盘的同名 slug。 */
async function uniqueSlug(
  payload: Payload,
  req: PayloadRequest | undefined,
  collection: 'buildings' | 'listings',
  base: string,
): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    const res = await payload.find({
      collection,
      where: { slug: { equals: candidate } },
      trash: true,
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
    if (res.docs.length === 0) return candidate
  }
  throw new Error(`slug「${base}」及其 20 个后缀都已被占用`)
}

// ---------------------------------------------------------------------------
// 楼盘图片
// ---------------------------------------------------------------------------

/**
 * 对方 OSS 有防盗链（不带 Referer 返回 403）。带对方站点的 Referer 属于绕过防盗链——
 * 用户在知悉法律风险后于 2026-10-06 拍板采用（OPT-104 §9 决定 ⑥）。只对对方图床生效；
 * 同步包里的图片主机已被 parseHuizuSyncRow 限定在对方图床，这里再判一次兜底。
 */
export function imageRequestHeaders(url: string): Record<string, string> {
  return isHuizuImageUrl(url) ? { Referer: 'https://www.huizuxuanzhi.com/' } : {}
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * 从源地址拉图建 Media，返回成功的 media id（按原顺序）。单张失败只记一笔，不让楼盘行失败：
 * 图是锦上添花，楼盘本身的事实字段更重要；下次同步时图集仍为空会再补一次。
 */
async function importBuildingImages(
  payload: Payload,
  req: PayloadRequest | undefined,
  row: HuizuBuildingRow,
  errors: string[],
): Promise<number[]> {
  const ids: number[] = []
  for (const [i, url] of row.images.slice(0, MAX_BUILDING_IMAGES).entries()) {
    try {
      const res = await fetch(url, { headers: imageRequestHeaders(url), signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const mimetype = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      const ext = EXT_BY_MIME[mimetype]
      if (!ext) throw new Error(`不是可用的图片类型：${mimetype || '未知'}`)
      const data = Buffer.from(await res.arrayBuffer())
      if (data.length === 0 || data.length > IMAGE_MAX_BYTES) throw new Error(`图片大小异常：${data.length} 字节`)
      const media = await payload.create({
        collection: 'media',
        data: { alt: row.name.slice(0, 160), usage: 'listing-photo' },
        file: { data, mimetype, name: `hzx-b${row.externalId}-${i + 1}.${ext}`, size: data.length },
        overrideAccess: true,
        req,
      })
      ids.push(media.id as number)
    } catch (e) {
      errors.push(`第 ${i + 1} 张图（${url}）：${errorMessage(e)}`)
    }
  }
  return ids
}

const mediaItemsFor = (ids: readonly number[], alt: string) =>
  ids.map((id, i) => ({
    resource: id,
    kind: 'image' as const,
    // 内容未知；首张作外立面（封面），其余归公共区域，运营可在后台改
    category: i === 0 ? ('exterior' as const) : ('common-area' as const),
    alt: alt.slice(0, 160),
  }))

// ---------------------------------------------------------------------------
// 逐行写入
// ---------------------------------------------------------------------------

type Outcome = 'created' | 'updated' | 'unchanged' | 'retired' | 'skipped'

async function applyBuilding(
  payload: Payload,
  req: PayloadRequest | undefined,
  ctx: SyncContext,
  row: HuizuBuildingRow,
  stats: Stats,
  affected: Affected,
  imageErrors: string[],
): Promise<Outcome> {
  let existing = await findBySource(payload, req, 'buildings', row.externalId)
  if (!existing && row.attachToBuildingId !== null) {
    const target = await payload.findByID({
      collection: 'buildings',
      id: row.attachToBuildingId,
      trash: true,
      depth: 0,
      overrideAccess: true,
      req,
      disableErrors: true,
    })
    if (!target) throw new Error(`挂靠目标楼盘 ${row.attachToBuildingId} 不存在`)
    const ds = (target as { dataSource?: { source?: unknown } }).dataSource
    if (ds?.source) throw new Error(`挂靠目标楼盘 ${row.attachToBuildingId} 已绑定来源 ${String(ds.source)}，不能再挂`)
    existing = target as unknown as Record<string, unknown>
  }
  if (existing?.deletedAt) return 'skipped' // 运营删过的不复活

  const districtId = row.districtName ? (ctx.districtIdByName.get(row.districtName) ?? null) : null
  if (districtId === null && !existing)
    throw new Error(`行政区「${row.districtName ?? '空'}」在本站找不到唯一的启用节点`)
  const refs: BuildingRefs = {
    cityId: ctx.cityId,
    districtId: districtId ?? 0,
    businessDistrictId: districtId === null ? null : ctx.businessAreaId(districtId, row.businessAreaName),
  }

  if (existing) {
    const id = existing.id as number
    const { patch, filled } = buildingFillPatch(existing, row, refs)
    const ds = (existing.dataSource ?? {}) as Record<string, unknown>
    // 已绑定本来源：只刷新 sourceUrl / syncedAt；挂靠的手工楼盘：补上完整 dataSource
    patch.dataSource = ds.source
      ? { ...ds, sourceUrl: row.sourceUrl, syncedAt: ctx.syncedAt }
      : huizuDataSource(row, ctx.syncedAt)
    if (row.images.length && !(Array.isArray(existing.mediaItems) && existing.mediaItems.length)) {
      const mediaIds = await importBuildingImages(payload, req, row, imageErrors)
      stats.imagesCreated += mediaIds.length
      if (mediaIds.length) {
        patch.mediaItems = mediaItemsFor(mediaIds, row.name)
        filled.push('mediaItems')
      }
    }
    await payload.update({ collection: 'buildings', id, data: patch, depth: 0, overrideAccess: true, req })
    if (filled.length) affected.filledBuildings.push({ id, filled })
    return filled.length ? 'updated' : 'unchanged'
  }

  const data = buildingCreateData(row, refs, ctx.syncedAt)
  const created = await payload.create({
    collection: 'buildings',
    data: { ...data, slug: await uniqueSlug(payload, req, 'buildings', data.slug) },
    depth: 0,
    overrideAccess: true,
    req,
  })
  const id = created.id as number
  affected.createdBuildings.push(id)
  // 先建楼盘、后挂图：图片中途失败只留下「没图的楼盘」，下次同步会补；反过来会留下孤儿 media
  if (row.images.length) {
    const mediaIds = await importBuildingImages(payload, req, row, imageErrors)
    stats.imagesCreated += mediaIds.length
    if (mediaIds.length) {
      await payload.update({
        collection: 'buildings',
        id,
        data: { mediaItems: mediaItemsFor(mediaIds, row.name) },
        depth: 0,
        overrideAccess: true,
        req,
      })
    }
  }
  return 'created'
}

async function applyListing(
  payload: Payload,
  req: PayloadRequest | undefined,
  ctx: SyncContext,
  row: HuizuListingRow,
  affected: Affected,
): Promise<Outcome> {
  const building = await findBySource(payload, req, 'buildings', row.buildingExternalId)
  if (!building) throw new Error(`所属楼盘 ${row.buildingExternalId} 尚未同步（楼盘包要先于房源包上传）`)
  if (building.deletedAt) throw new Error(`所属楼盘 ${row.buildingExternalId} 已被删除`)
  const buildingId = building.id as number

  const existing = await findBySource(payload, req, 'listings', row.externalId)
  if (existing?.deletedAt) return 'skipped'
  if (existing) {
    const id = existing.id as number
    const { patch, before, changed } = listingUpdatePatch(existing, row, buildingId, ctx.syncedAt)
    await payload.update({ collection: 'listings', id, data: patch, depth: 0, overrideAccess: true, req })
    if (changed.length && existing.publicationStatus === 'published')
      affected.updatedPublishedListings.push({ id, before })
    return changed.length ? 'updated' : 'unchanged'
  }

  if (ctx.merchantId === null) throw new Error('找不到覆盖上海的平台默认供给商户，无法新建房源')
  const data = listingCreateData(row, buildingId, ctx.merchantId, ctx.syncedAt)
  const created = await payload.create({
    collection: 'listings',
    data: { ...data, slug: await uniqueSlug(payload, req, 'listings', data.slug) },
    depth: 0,
    overrideAccess: true,
    req,
  })
  affected.createdListings.push(created.id as number)
  return 'created'
}

async function applyRetire(
  payload: Payload,
  req: PayloadRequest | undefined,
  row: HuizuRetireRow,
  affected: Affected,
): Promise<Outcome> {
  const existing = await findBySource(payload, req, 'listings', row.externalId)
  if (!existing || retireDecision(existing) !== 'retire') return 'skipped'
  const id = existing.id as number
  await payload.update({
    collection: 'listings',
    id,
    data: { publicationStatus: 'unpublished' },
    depth: 0,
    overrideAccess: true,
    req,
  })
  affected.retiredListings.push(id)
  return 'retired'
}

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

const emptyAffected = (): Affected => ({
  createdBuildings: [],
  filledBuildings: [],
  createdListings: [],
  updatedPublishedListings: [],
  retiredListings: [],
})

/** 批次里存的 affected 是 json，读回按 unknown 收口；字段缺失补空数组。 */
export function readAffected(value: unknown): Affected {
  const base = emptyAffected()
  if (typeof value !== 'object' || value === null) return base
  const v = value as Record<string, unknown>
  const nums = (x: unknown) => (Array.isArray(x) ? x.map(toNumber).filter((n): n is number => n !== null) : [])
  return {
    createdBuildings: nums(v.createdBuildings),
    filledBuildings: Array.isArray(v.filledBuildings)
      ? (v.filledBuildings as Affected['filledBuildings']).filter((x) => toNumber(x?.id) !== null)
      : [],
    createdListings: nums(v.createdListings),
    updatedPublishedListings: Array.isArray(v.updatedPublishedListings)
      ? (v.updatedPublishedListings as Affected['updatedPublishedListings']).filter((x) => toNumber(x?.id) !== null)
      : [],
    retiredListings: nums(v.retiredListings),
  }
}

const readStats = (value: unknown): Stats => {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const n = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : 0)
  return {
    created: n('created'),
    updated: n('updated'),
    unchanged: n('unchanged'),
    retired: n('retired'),
    skipped: n('skipped'),
    failed: n('failed'),
    imagesCreated: n('imagesCreated'),
  }
}

/**
 * 处理一段。返回是否还有剩余（调用方据此续排）。导出供 postgres 集成测试直接驱动，
 * 不经 jobs 队列。
 */
export async function runSourceSyncSlice(
  payload: Payload,
  req: PayloadRequest | undefined,
  batchId: number,
  now: () => number = Date.now,
): Promise<{ hasMore: boolean; processed: number }> {
  const startedAt = now()
  const batch = (await payload.findByID({
    collection: 'source-sync-batches',
    id: batchId,
    depth: 0,
    overrideAccess: true,
    req,
    disableErrors: true,
  })) as unknown as Record<string, unknown> | null
  if (!batch) throw new Error(`同步批次 ${batchId} 不存在`)
  if (batch.status === 'completed' || batch.status === 'failed') return { hasMore: false, processed: 0 }

  const kind = batch.kind as keyof typeof SLICE_MAX_ROWS
  const rows: unknown[] = Array.isArray(batch.rows) ? batch.rows : []
  let cursor = toNumber(batch.cursor) ?? 0
  const stats = readStats(batch.stats)
  const affected = readAffected(batch.affected)
  const writeErrors: WriteError[] = Array.isArray(batch.writeErrors) ? (batch.writeErrors as WriteError[]) : []

  if (batch.status === 'queued') {
    await payload.update({
      collection: 'source-sync-batches',
      id: batchId,
      data: { status: 'running', startedAt: new Date(startedAt).toISOString() },
      depth: 0,
      overrideAccess: true,
      req,
    })
  }

  let ctx: SyncContext
  try {
    ctx = await loadSyncContext(payload, req)
  } catch (e) {
    // 上下文都建不起来（城市节点缺失等）是配置问题，整批判失败，别空转续排
    await payload.update({
      collection: 'source-sync-batches',
      id: batchId,
      data: {
        status: 'failed',
        finishedAt: new Date(now()).toISOString(),
        writeErrors: [...writeErrors, { row: -1, externalId: '', message: errorMessage(e) }],
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
    return { hasMore: false, processed: 0 }
  }

  let processed = 0
  while (cursor < rows.length && processed < SLICE_MAX_ROWS[kind] && now() - startedAt < SLICE_BUDGET_MS) {
    const index = cursor
    cursor++
    processed++
    const parsed = parseHuizuSyncRow(rows[index])
    if (!parsed.ok) {
      stats.failed++
      writeErrors.push({ row: index + 1, externalId: '', message: parsed.errors.join('；') })
      continue
    }
    const row: HuizuSyncRow = parsed.row
    const imageErrors: string[] = []
    try {
      const outcome =
        row.kind === 'building'
          ? await applyBuilding(payload, req, ctx, row, stats, affected, imageErrors)
          : row.kind === 'listing'
            ? await applyListing(payload, req, ctx, row, affected)
            : await applyRetire(payload, req, row, affected)
      stats[outcome]++
    } catch (e) {
      stats.failed++
      writeErrors.push({ row: index + 1, externalId: row.externalId, message: errorMessage(e) })
    }
    for (const message of imageErrors) writeErrors.push({ row: index + 1, externalId: row.externalId, message })
  }

  const done = cursor >= rows.length
  await payload.update({
    collection: 'source-sync-batches',
    id: batchId,
    data: {
      cursor,
      stats,
      affected,
      // 只留最近 500 条，防止某个系统性错误把 json 撑爆
      writeErrors: writeErrors.slice(-500),
      ...(done ? { status: 'completed', finishedAt: new Date(now()).toISOString() } : {}),
    },
    depth: 0,
    overrideAccess: true,
    req,
  })
  return { hasMore: !done, processed }
}

export const sourceSyncTask: TaskConfig<typeof SOURCE_SYNC_TASK> = {
  slug: SOURCE_SYNC_TASK,
  inputSchema: [{ name: 'batchId', type: 'number', required: true }],
  // 段内逐行吞错；段级异常（库连不上等）交给重试，游标保证不重复写已处理的行
  retries: { attempts: 3 },
  handler: async ({ input, req }) => {
    const payload = req.payload
    const batchId = Number(input.batchId)
    // 本任务的所有写入都跳过逐条缓存失效，见 SKIP_SUPPLY_CACHE_INVALIDATION
    req.context = { ...(req.context ?? {}), [SKIP_SUPPLY_CACHE_INVALIDATION]: true }
    const { hasMore, processed } = await runSourceSyncSlice(payload, req, batchId)
    if (hasMore) {
      await payload.jobs.queue({ task: SOURCE_SYNC_TASK, queue: SOURCE_SYNC_QUEUE, input: { batchId } })
    }
    return { output: { batchId, processed, hasMore } }
  },
}

/** 实例被回收时遗留的 processing=true job，超过租约就放回队列（同 import-task 的写法）。 */
export async function recoverStaleSourceSyncJobs(payload: Payload, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SOURCE_SYNC_JOB_LEASE_MS).toISOString()
  const result = await payload.db.pool.query<{ id: number }>(
    `
    UPDATE payload_jobs
    SET processing = false, updated_at = NOW()
    WHERE queue = $1
      AND updated_at <= $2
      AND task_slug = $3
      AND processing = true
      AND completed_at IS NULL
      AND has_error IS NOT TRUE
    RETURNING id
  `,
    [SOURCE_SYNC_QUEUE, cutoff, SOURCE_SYNC_TASK],
  )
  return result.rowCount ?? result.rows.length
}
