/**
 * 批量导入 Jobs Queue 写入层（OPT-041 Task 7）
 *
 * 这是整个批量导入功能里唯一真正改动业务数据的一层——预检（Task 6）只读不写，
 * 这里才把预检通过的行真正 create/update 进 buildings / listings。导入的房源
 * **直接上架**，写错会立刻出现在前台，故五条语义不可妥协：
 *
 *   1. 幂等键是 (dataSource.source='manual-import', dataSource.externalId)：
 *      命中则 update，未命中则 create。同一批跑两次，第二次全部落 updated，
 *      两次 affectedIds 相同。
 *   2. 落地状态显式写死，不依赖 `adminAutoPublish` 的副作用（该 hook 因操作者
 *      身份不同会产生不同结果，见 `domain/review/admin-auto-publish-hook.ts`）：
 *      房源 reviewStatus:'approved' + publicationStatus:'published' +
 *      supplyVisibilityHold:'normal'；楼盘 status:'published' +
 *      operationalStatus:'active'。
 *   3. update 时绝不改 slug——改 slug 会断掉已有的前台 URL。create 时才用
 *      slugify() 生成并处理冲突。
 *   4. 单行失败不阻断后续行，也不回滚已成功的行：每行独立 try/catch，失败计入
 *      failed 并记录原因，继续下一行。
 *   5. 唯一索引冲突（PG 23505）视为并发重复：重新按 externalId 查一次改走
 *      update，仍失败才计 failed。判定复用
 *      `domain/supply-submission/submission-notify.ts` 里 `isUniqueViolation`
 *      的写法（逐层看 cause.code，最多 5 层）——该函数未导出，这里按同一实现
 *      再写一份，不改变判定逻辑本身。
 */

import type { Payload, PayloadRequest, TaskConfig } from 'payload'

import { isDecorationStatus, isListingType } from '@/domain/review/listing-fields'
import { ensureUniqueSlug, slugify } from '@/domain/shared/slug'
import type { ValidBuildingRow } from '@/domain/supply-import/building-row'
import type { ValidListingRow } from '@/domain/supply-import/listing-row'

export const SUPPLY_IMPORT_TASK = 'run-supply-import'
export const SUPPLY_IMPORT_QUEUE = 'supply-imports'
export const SUPPLY_IMPORT_CHUNK = 20

/** 陈旧 processing 租约的释放阈值，与 `application-notify.ts` 的 15 分钟同口径。 */
export const SUPPLY_IMPORT_JOB_LEASE_MS = 15 * 60 * 1_000

export interface ImportRunResult {
  created: number
  updated: number
  failed: number
  affectedIds: Array<number | string>
  errors: Array<{ externalId: string; message: string }>
}

// ────────────────────────────────────────────────────────────
// 唯一索引冲突判定（逐字复用 submission-notify.ts:isUniqueViolation 的写法）
// ────────────────────────────────────────────────────────────

function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error
  for (let depth = 0; depth < 5 && candidate && typeof candidate === 'object'; depth += 1) {
    const record = candidate as Record<string, unknown>
    if (record.code === '23505') return true
    candidate = record.cause
  }
  return false
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * relationship 字段在生成类型里是 `number | <Doc>`（Postgres 适配器下 ID 恒为 number，
 * 与 bulk-import-endpoint.ts:numericId 同口径），而 ValidBuildingRow/ValidListingRow
 * 的 id 类型是宽松的 `number | string`（Task 4 解析层的通用产出）。这里收窄一次。
 */
function numericId(id: number | string): number {
  return typeof id === 'number' ? id : Number(id)
}

// ────────────────────────────────────────────────────────────
// 房源 rentUnit：ValidListingRow.rentUnit 取值域比 Listings.rentUnit（旧字段）宽
// （normalize.ts 的 parseRent 还会产出 'rmb-total'，旧字段 select 没有这个选项）。
// 不在这里猜测性地把 'rmb-total' 映射进结构化价格——期间/单位口径不明确，猜错
// 会让前台价格错一个数量级，宁可让该行失败并报错，由后续任务显式决定映射规则。
// ────────────────────────────────────────────────────────────

const LEGACY_RENT_UNITS = ['rmb-sqm-day', 'rmb-month', 'rmb-seat-month'] as const
type LegacyRentUnit = (typeof LEGACY_RENT_UNITS)[number]

function isLegacyRentUnit(value: string): value is LegacyRentUnit {
  return (LEGACY_RENT_UNITS as readonly string[]).includes(value)
}

// ────────────────────────────────────────────────────────────
// slug：create 时生成，update 时绝不传（不覆盖已有值）
// ────────────────────────────────────────────────────────────

async function uniqueSlugFor(
  payload: Payload,
  req: PayloadRequest | undefined,
  collection: 'buildings' | 'listings',
  base: string,
): Promise<string> {
  const baseSlug = slugify(base) || 'supply-import'
  return ensureUniqueSlug(baseSlug, async (candidate) => {
    const result = await payload.find({
      collection,
      where: { slug: { equals: candidate } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    })
    return result.totalDocs > 0
  })
}

// ────────────────────────────────────────────────────────────
// 楼盘写入
// ────────────────────────────────────────────────────────────

async function findBuildingByExternalId(
  payload: Payload,
  req: PayloadRequest | undefined,
  externalId: string,
): Promise<number | null> {
  const result = await payload.find({
    collection: 'buildings',
    where: {
      and: [
        { 'dataSource.source': { equals: 'manual-import' } },
        { 'dataSource.externalId': { equals: externalId } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return result.docs[0]?.id ?? null
}

async function writeBuildingRow(
  payload: Payload,
  req: PayloadRequest | undefined,
  row: ValidBuildingRow,
): Promise<{ id: number; created: boolean }> {
  const syncedAt = new Date().toISOString()
  const sharedData = {
    name: row.name,
    city: numericId(row.cityId),
    district: numericId(row.districtId),
    businessDistrict: row.businessAreaId === null ? null : numericId(row.businessAreaId),
    address: row.address,
    totalFloors: row.totalFloors,
    developerAndScale: { grossFloorArea: row.grossFloorArea },
    // 语义 2：落地状态显式写死，不依赖 adminAutoPublish 的副作用。
    status: 'published' as const,
    operationalStatus: 'active' as const,
    dataSource: {
      source: 'manual-import' as const,
      externalId: row.externalId,
      syncedAt,
    },
  }

  const existingId = await findBuildingByExternalId(payload, req, row.externalId)
  if (existingId !== null) {
    // 语义 3：update 绝不传 slug。
    const updated = await payload.update({
      collection: 'buildings',
      id: existingId,
      data: sharedData,
      overrideAccess: true,
      req,
    })
    return { id: updated.id, created: false }
  }

  try {
    const slug = await uniqueSlugFor(payload, req, 'buildings', row.name)
    const created = await payload.create({
      collection: 'buildings',
      data: { ...sharedData, slug },
      overrideAccess: true,
      req,
    })
    return { id: created.id, created: true }
  } catch (error) {
    // 语义 5：唯一索引冲突视为并发重复，重新按 externalId 查一次改走 update。
    if (!isUniqueViolation(error)) throw error
    const raceId = await findBuildingByExternalId(payload, req, row.externalId)
    if (raceId === null) throw error
    const updated = await payload.update({
      collection: 'buildings',
      id: raceId,
      data: sharedData,
      overrideAccess: true,
      req,
    })
    return { id: updated.id, created: false }
  }
}

// ────────────────────────────────────────────────────────────
// 房源写入
// ────────────────────────────────────────────────────────────

async function findListingByExternalId(
  payload: Payload,
  req: PayloadRequest | undefined,
  externalId: string,
): Promise<number | null> {
  const result = await payload.find({
    collection: 'listings',
    where: {
      and: [
        { 'dataSource.source': { equals: 'manual-import' } },
        { 'dataSource.externalId': { equals: externalId } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return result.docs[0]?.id ?? null
}

async function writeListingRow(
  payload: Payload,
  req: PayloadRequest | undefined,
  row: ValidListingRow,
): Promise<{ id: number; created: boolean }> {
  if (!isListingType(row.listingType)) {
    throw new Error(`未知房源类型：${row.listingType}`)
  }
  if (row.decorationStatus !== null && !isDecorationStatus(row.decorationStatus)) {
    throw new Error(`未知装修状态：${row.decorationStatus}`)
  }
  if (!isLegacyRentUnit(row.rentUnit)) {
    throw new Error(`租金单位「${row.rentUnit}」暂不支持导入，请改用元/㎡/天、元/月或元/工位/月的写法`)
  }

  const listingType = row.listingType
  const decorationStatus = row.decorationStatus
  const rentUnit = row.rentUnit
  const syncedAt = new Date().toISOString()

  const sharedData = {
    title: row.title,
    listingType,
    building: numericId(row.buildingId),
    area: row.area,
    rent: row.rentAmount,
    rentUnit,
    floor: row.floor === null ? null : String(row.floor),
    decorationStatus,
    availableFrom: row.availableFrom,
    // 语义 2：落地状态显式写死，不依赖 adminAutoPublish 的副作用（规格 D4：导入的房源直接上架）。
    reviewStatus: 'approved' as const,
    publicationStatus: 'published' as const,
    supplyVisibilityHold: 'normal' as const,
    dataSource: {
      source: 'manual-import' as const,
      externalId: row.externalId,
      syncedAt,
    },
  }

  const existingId = await findListingByExternalId(payload, req, row.externalId)
  if (existingId !== null) {
    // 语义 3：update 绝不传 slug。
    const updated = await payload.update({
      collection: 'listings',
      id: existingId,
      data: sharedData,
      overrideAccess: true,
      req,
    })
    return { id: updated.id, created: false }
  }

  try {
    const slug = await uniqueSlugFor(payload, req, 'listings', row.title)
    const created = await payload.create({
      collection: 'listings',
      data: { ...sharedData, slug },
      overrideAccess: true,
      req,
    })
    return { id: created.id, created: true }
  } catch (error) {
    // 语义 5：唯一索引冲突视为并发重复，重新按 externalId 查一次改走 update。
    if (!isUniqueViolation(error)) throw error
    const raceId = await findListingByExternalId(payload, req, row.externalId)
    if (raceId === null) throw error
    const updated = await payload.update({
      collection: 'listings',
      id: raceId,
      data: sharedData,
      overrideAccess: true,
      req,
    })
    return { id: updated.id, created: false }
  }
}

// ────────────────────────────────────────────────────────────
// 批处理入口
// ────────────────────────────────────────────────────────────

export async function runSupplyImportBatch(params: {
  payload: Payload
  req?: PayloadRequest
  type: 'buildings' | 'listings'
  validRows: ReadonlyArray<ValidBuildingRow | ValidListingRow>
}): Promise<ImportRunResult> {
  const { payload, req, type, validRows } = params
  const result: ImportRunResult = {
    created: 0,
    updated: 0,
    failed: 0,
    affectedIds: [],
    errors: [],
  }

  for (const row of validRows) {
    try {
      // 语义 4：单行独立 try/catch，失败不阻断后续行，也不回滚已成功的行。
      const outcome =
        type === 'buildings'
          ? await writeBuildingRow(payload, req, row as ValidBuildingRow)
          : await writeListingRow(payload, req, row as ValidListingRow)
      if (outcome.created) result.created += 1
      else result.updated += 1
      result.affectedIds.push(outcome.id)
    } catch (error) {
      result.failed += 1
      result.errors.push({ externalId: row.externalId, message: errorMessage(error) })
    }
  }

  return result
}

// ────────────────────────────────────────────────────────────
// 批次记录里的 validRows 结构守卫（Task 6 的 PersistedValidRow：ValidXxxRow + rowNumber，
// 未从 bulk-import-endpoint.ts 导出，这里按实际落库形状各写一份判断，不改变其定义）
// ────────────────────────────────────────────────────────────

function isNumberOrString(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string'
}

function isNullableNumberOrString(value: unknown): value is number | string | null {
  return value === null || isNumberOrString(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function toValidBuildingRow(value: unknown): ValidBuildingRow | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.externalId !== 'string') return null
  if (typeof row.name !== 'string') return null
  if (!isNumberOrString(row.cityId)) return null
  if (!isNumberOrString(row.districtId)) return null
  if (!isNullableNumberOrString(row.businessAreaId)) return null
  if (!isNullableString(row.address)) return null
  if (!isNullableNumber(row.totalFloors)) return null
  if (!isNullableNumber(row.grossFloorArea)) return null
  return {
    externalId: row.externalId,
    name: row.name,
    cityId: row.cityId,
    districtId: row.districtId,
    businessAreaId: row.businessAreaId,
    address: row.address,
    totalFloors: row.totalFloors,
    grossFloorArea: row.grossFloorArea,
  }
}

function toValidListingRow(value: unknown): ValidListingRow | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.externalId !== 'string') return null
  if (typeof row.title !== 'string') return null
  if (typeof row.listingType !== 'string') return null
  if (!isNumberOrString(row.buildingId)) return null
  if (!isNullableNumberOrString(row.cityId)) return null
  if (typeof row.area !== 'number') return null
  if (typeof row.rentAmount !== 'number') return null
  if (typeof row.rentUnit !== 'string') return null
  if (!isNullableNumber(row.floor)) return null
  if (!isNullableString(row.decorationStatus)) return null
  if (!isNullableString(row.availableFrom)) return null
  return {
    externalId: row.externalId,
    title: row.title,
    listingType: row.listingType,
    buildingId: row.buildingId,
    cityId: row.cityId,
    area: row.area,
    rentAmount: row.rentAmount,
    rentUnit: row.rentUnit,
    floor: row.floor,
    decorationStatus: row.decorationStatus,
    availableFrom: row.availableFrom,
  }
}

// ────────────────────────────────────────────────────────────
// affectedIds / writeErrors 的持久化辅助（评审 Task 7 第 1 轮 Critical 1 + Important 2）
//
// Critical 1：崩溃/实例回收后 recoverStaleSupplyImportJobs 会把陈旧 job 重新放回队列，
// 同一 batchId 的 handler 会再跑一次。整批重跑对行写入本身是幂等安全的（语义 1），
// 但如果每次 handler 进来都把 affectedIds 从空数组重新累积、再整体覆盖批次字段，
// 会在下面两种情况下把已经持久化的锚点冲掉：
//   1) 重跑尚未跑完所有分片就再次崩溃——本次已写的分片数比上次少，覆盖后批次字段
//      比真实情况小；
//   2) 某一行在上次成功、这次因为外部条件变化（比如引用的楼盘被删）转为失败——
//      它对应的已上架房源仍然真实存在，但这次的 chunkResult 不会再产出它的 id，
//      覆盖式写入会让这个真实存在、正在前台可见的对象永久丢失回滚锚点。
// 修法：handler 开始时把批次里已持久化的 affectedIds 读出来做种子，此后只做并集
// 合并（去重、保持已存在项在前），不再整体覆盖——已经落库的锚点只增不减。
//
// Important 2：chunkResult.errors 此前直接丢弃，运营只能看到 stats.failed 的数字，
// 看不到具体是哪几行、为什么失败。这里把错误累积进 rowErrors 这个既有 json 字段的
// 一个新增子键 writeErrors，与 Task 6 预检阶段写入的 errors/rawRows/rawRowNumbers
// 并列、互不覆盖——预检错误是"这行数据本身不合法"，写入错误是"数据合法但落库时
// 出了别的问题（比如并发下彻底失败、引用对象不存在）"，语义不同不能混在一个数组里。
// writeErrors **不做跨次运行的并集**：不同于 affectedIds（丢了等于丢失真实存在的
// 回滚锚点），错误信息反映的是"当前这次运行观察到的问题"，跨次保留旧错误反而可能
// 误导运营去修一个这次其实已经不存在的问题；每次运行以本次结果整体覆盖 writeErrors，
// 这一点在 Task 8 消费前必须清楚：writeErrors 是"最近一次运行的快照"，不是历史累计。
// ────────────────────────────────────────────────────────────

interface PersistedWriteError {
  externalId: string
  message: string
}

function isIdValue(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string'
}

/** 从批次的 json 字段里安全取出已持久化的 affectedIds（结构可能损坏/为空）。 */
function toIdArray(value: unknown): Array<number | string> {
  if (!Array.isArray(value)) return []
  return value.filter(isIdValue)
}

/** 并集合并：已存在的项保持原有顺序在前，新增项按出现顺序追加，去重。 */
function mergeIds(
  existing: ReadonlyArray<number | string>,
  incoming: ReadonlyArray<number | string>,
): Array<number | string> {
  const seen = new Set(existing.map(String))
  const merged = [...existing]
  for (const id of incoming) {
    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(id)
  }
  return merged
}

/** 批次 rowErrors 是自由 json 字段；取出既有对象形态（非对象/数组时按空对象处理），
 * 好让本次写入只替换 writeErrors 这一个子键，不动 Task 6 预检阶段写的其它键。 */
function toRowErrorsRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 行结构守卫失败时（json 字段被外部写坏），尽量取出 externalId 供错误列表定位；取不到就给占位。 */
function extractExternalIdForError(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null) {
    const externalId = (raw as Record<string, unknown>).externalId
    if (typeof externalId === 'string' && externalId.trim() !== '') return externalId
  }
  return '(未知编号)'
}

// ────────────────────────────────────────────────────────────
// TaskConfig：读批次 → running → 按 SUPPLY_IMPORT_CHUNK 分片写入 → 每片更新 stats →
// 完成后 completed；任务整体抛错则 failed，但保留已写入的 affectedIds（Task 9 回滚锚点）。
// ────────────────────────────────────────────────────────────

interface SupplyImportBatchStats {
  processed: number
  created: number
  updated: number
  failed: number
}

type SupplyImportTaskType = {
  input: { batchId: number }
  output: { created: number; updated: number; failed: number }
}

export const supplyImportTask: TaskConfig<SupplyImportTaskType> = {
  slug: SUPPLY_IMPORT_TASK,
  label: '批量导入写入',
  inputSchema: [{ name: 'batchId', type: 'number', required: true }],
  outputSchema: [
    { name: 'created', type: 'number', required: true },
    { name: 'updated', type: 'number', required: true },
    { name: 'failed', type: 'number', required: true },
  ],
  handler: async ({ input, req }) => {
    const payload = req.payload
    const batchId = input.batchId

    await payload.update({
      collection: 'supply-import-batches',
      id: batchId,
      data: { status: 'running' },
      overrideAccess: true,
      req,
    })

    const batch = await payload.findByID({
      collection: 'supply-import-batches',
      id: batchId,
      depth: 0,
      overrideAccess: true,
      req,
    })

    const rawRows = Array.isArray(batch.validRows) ? batch.validRows : []
    const rows: Array<ValidBuildingRow | ValidListingRow> = []
    // Important 2：结构守卫失败的行也要有一条 writeErrors 记录，不能只在 stats.failed
    // 里加一个数字却不说是哪一行。
    const writeErrors: PersistedWriteError[] = []
    let structuralFailures = 0
    for (const raw of rawRows) {
      const row = batch.type === 'buildings' ? toValidBuildingRow(raw) : toValidListingRow(raw)
      if (row) {
        rows.push(row)
      } else {
        structuralFailures += 1
        writeErrors.push({
          externalId: extractExternalIdForError(raw),
          message: '批次行数据结构异常，请重新预检',
        })
      }
    }

    const stats: SupplyImportBatchStats = {
      processed: 0,
      created: 0,
      updated: 0,
      failed: structuralFailures,
    }
    // Critical 1：种子必须来自批次里已经持久化的 affectedIds，不能从空数组重新累积——
    // 见上方大注释，整体覆盖会在崩溃重跑或行状态转失败时丢失已上架对象的回滚锚点。
    let affectedIds: Array<number | string> = toIdArray(batch.affectedIds)

    const persistRowErrors = (): Record<string, unknown> => ({
      ...toRowErrorsRecord(batch.rowErrors),
      writeErrors,
    })

    try {
      for (let i = 0; i < rows.length; i += SUPPLY_IMPORT_CHUNK) {
        const chunk = rows.slice(i, i + SUPPLY_IMPORT_CHUNK)
        const chunkResult = await runSupplyImportBatch({
          payload,
          req,
          type: batch.type,
          validRows: chunk,
        })
        stats.processed += chunk.length
        stats.created += chunkResult.created
        stats.updated += chunkResult.updated
        stats.failed += chunkResult.failed
        // Critical 1：并集合并，绝不整体覆盖——已持久化的锚点只增不减。
        affectedIds = mergeIds(affectedIds, chunkResult.affectedIds)
        writeErrors.push(...chunkResult.errors)

        // 分片进度：前端轮询靠 stats 显示进度。
        await payload.update({
          collection: 'supply-import-batches',
          id: batchId,
          data: { stats, affectedIds, rowErrors: persistRowErrors() },
          overrideAccess: true,
          req,
        })
      }
    } catch (error) {
      // 任务整体抛错 → failed，但保留已写入的 affectedIds，让 Task 9 的回滚仍有锚点。
      await payload
        .update({
          collection: 'supply-import-batches',
          id: batchId,
          data: {
            status: 'failed',
            stats,
            affectedIds,
            rowErrors: persistRowErrors(),
            finishedAt: new Date().toISOString(),
          },
          overrideAccess: true,
          req,
        })
        .catch(() => null)
      throw error
    }

    await payload.update({
      collection: 'supply-import-batches',
      id: batchId,
      data: {
        status: 'completed',
        finishedAt: new Date().toISOString(),
        stats,
        affectedIds,
        rowErrors: persistRowErrors(),
      },
      overrideAccess: true,
      req,
    })

    return { output: { created: stats.created, updated: stats.updated, failed: stats.failed } }
  },
}

// ────────────────────────────────────────────────────────────
// 陈旧 job 恢复：released 掉超过租约期仍 processing=true 的 job（进程崩溃/CloudRun 实例
// 回收等场景），让下一轮 autoRun 重新领取。同一批次的行写入是幂等的（语义 1），
// 整批重跑安全，不需要从半途断点续传。写法与 application-notify.ts 的
// recoverStaleCityPartnerNotificationJobs 一致：where 子句本身是原子的，
// 并发多个 reaper 幂等，新鲜 job（updated_at 晚于 cutoff）不会被误抢。
// ────────────────────────────────────────────────────────────

export async function recoverStaleSupplyImportJobs(payload: Payload, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SUPPLY_IMPORT_JOB_LEASE_MS).toISOString()
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
    [SUPPLY_IMPORT_QUEUE, cutoff, SUPPLY_IMPORT_TASK],
  )
  return result.rowCount ?? result.rows.length
}
