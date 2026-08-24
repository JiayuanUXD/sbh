import type { Endpoint, Where } from 'payload'
import { addDataAndFileToRequest } from 'payload'

import { canReadByCity, requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import type { PermissionContext } from '@/domain/auth/permission-context'
import { writeAuditFailed, writeAuditSuccess } from '@/domain/audit/audit-writer'
import { rollbackImportBatch } from '@/domain/supply-import/batch-rollback'
import { invalidateSupplyImportCache } from '@/domain/supply-import/cache-invalidation'
import { BUILDING_COLUMNS, validateBuildingRow, type ValidBuildingRow } from '@/domain/supply-import/building-row'
import { markDuplicateExternalIds } from '@/domain/supply-import/duplicate-check'
import { SUPPLY_IMPORT_QUEUE, SUPPLY_IMPORT_TASK } from '@/domain/supply-import/import-task'
import { LISTING_COLUMNS, validateListingRow, type ValidListingRow } from '@/domain/supply-import/listing-row'
import {
  mapBuildingMerchantRelationDocs,
  type BuildingMerchantRelationInput,
  type RawBuildingMerchantRelationDoc,
  type MerchantCandidate,
} from '@/domain/supply-import/resolve-merchant'
import {
  resolveDefaultSupplyMerchant,
  type MerchantLookupPort,
} from '@/domain/supply/default-merchant'
import {
  buildResolveTables,
  type BuildingCandidate,
  type RefLookupPort,
} from '@/domain/supply-import/resolve-refs'
import type { RawRow, RowContext, RowError } from '@/domain/supply-import/types'
import {
  buildBuildingReferenceWorkbook,
  buildErrorWorkbook,
  buildTemplateWorkbook,
  MAX_FILE_BYTES,
  parseWorkbook,
} from '@/domain/supply-import/workbook'
import type { Location } from '@/payload-types'

/**
 * 批量导入预检 / 执行 / 轮询 / 下载 endpoint（OPT-041 Task 6）
 *
 * 路由（顶层注册在 payload.config.ts，路径均不与任何 collection slug 首段冲突）：
 *   - POST /bulk-import/preflight                 multipart 上传 → 预检 → 落 preflight 批次
 *   - POST /bulk-import/batches/:id/execute        复核权限与城市范围 → queued → 入队
 *   - GET  /bulk-import/batches/:id                轮询状态与 stats
 *   - GET  /bulk-import/batches/:id/errors         下载错误表 xlsx
 *   - GET  /bulk-import/template                   下载空模板（?type=buildings|listings）
 *   - GET  /bulk-import/building-reference          下载楼盘对照表（按 ctx.cityIds 收窄）
 *   - POST /bulk-import/batches/:id/rollback       按批次回滚（下架而非删除，Task 9）
 *
 * 四条不可妥协的语义：
 *   1. 预检绝不写业务表：整个 preflight handler 里不出现对 buildings / listings 的 create / update，
 *      只写 supply-import-batches 一条批次记录。
 *   2. 权限在 endpoint 内执行：每个 handler 第一件事都是 guardImport；无权 / 未登录一律 403。
 *   3. execute 复核城市范围：预检通过 validateXxxRow 校验过一次，execute 再对 validRows 逐行
 *      canReadByCity 复核一次——预检与执行之间用户角色可能已变更。
 *   4. status !== 'preflight' 的批次执行请求返回 409，防止重复点击重复入队。
 */

/** 预检响应里内联返回的错误行上限；完整计数走 errorCount，完整清单走错误表下载。 */
export const PREFLIGHT_ERROR_PREVIEW_LIMIT = 50

type ImportType = 'buildings' | 'listings'

// ────────────────────────────────────────────────────────────
// 权限守卫（Step 3）
// ────────────────────────────────────────────────────────────

/** 统一守卫：无 data:import 一律 403。UI 隐藏不是权限控制；未登录同样 403。 */
async function guardImport(
  req: RequestContext,
): Promise<{ ok: true; ctx: PermissionContext } | { ok: false; response: Response }> {
  try {
    const ctx = await requireOperationPermission(req, 'data:import')
    return { ok: true, ctx }
  } catch (err) {
    const message = err instanceof Error ? err.message : '无权限'
    return { ok: false, response: Response.json({ ok: false, error: message }, { status: 403 }) }
  }
}

// ────────────────────────────────────────────────────────────
// 小工具：relationship 取 id / 查询参数解析
// ────────────────────────────────────────────────────────────

/** relationship 字段可能是裸 id，也可能是 depth>0 时populate 出的文档；统一取 id。 */
function relationId(value: number | string | { id: number | string } | null | undefined): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value.id
  return value
}

function cityDisplayName(city: number | Location | null | undefined): string {
  if (city && typeof city === 'object' && 'name' in city) return city.name
  return ''
}

function parseImportType(url: string | undefined): ImportType | null {
  if (!url) return null
  const raw = new URL(url, 'http://localhost').searchParams.get('type')
  return raw === 'buildings' || raw === 'listings' ? raw : null
}

function columnsForType(type: ImportType): readonly string[] {
  return type === 'buildings' ? BUILDING_COLUMNS : LISTING_COLUMNS
}

/** PermissionContext.userId 类型上是 number | string；本项目 Postgres 适配器下 ID 恒为 number。 */
function numericId(id: number | string): number {
  return typeof id === 'number' ? id : Number(id)
}

function routeId(req: RequestContext): string | number | undefined {
  const raw = (req.routeParams as Record<string, unknown> | undefined)?.id
  return typeof raw === 'string' || typeof raw === 'number' ? raw : undefined
}

/**
 * 批次可见性：全局范围（ADM，ctx.cityIds === 'all'）或本人创建的批次。
 * 不用 validRows[].cityId 做判据——那是自由 json 字段，损坏时判据会失效；
 * 用 batch.operator（create 时写入、只读字段）才是可信的归属锚点。
 * 只做「本人 or 全局」最小口径；放宽到同城/同团队可见是另一个决定，不在本任务里做。
 */
function isBatchVisibleTo(ctx: PermissionContext, batch: { operator?: unknown }): boolean {
  if (ctx.cityIds === 'all') return true
  const operator = batch.operator
  const operatorId =
    typeof operator === 'object' && operator !== null && 'id' in operator
      ? (operator as { id?: unknown }).id
      : operator
  return String(operatorId ?? '') === String(ctx.userId)
}

// ────────────────────────────────────────────────────────────
// 关系解析：locations / location-aliases / buildings 候选
// ────────────────────────────────────────────────────────────

function createRefLookupPort(req: RequestContext): RefLookupPort {
  return {
    async listLocations(kind) {
      const result = await req.payload.find({
        collection: 'locations',
        where: { type: { equals: kind } },
        depth: 0,
        limit: 0,
        overrideAccess: true,
        req,
      })
      return result.docs.map((doc) => ({
        id: doc.id,
        name: doc.name,
        kind: doc.type,
        parentId: relationId(doc.parent ?? null),
        // 最终评审 Critical 2：§7 要求城市/行政区 status=active，供 building-row.ts
        // 在 resolveLocation 命中后判定用。
        status: doc.status,
      }))
    },
    async listAliases(kind) {
      const result = await req.payload.find({
        collection: 'location-aliases',
        where: { kind: { equals: kind } },
        depth: 0,
        limit: 0,
        overrideAccess: true,
        req,
      })
      const mapped: Array<{ normalizedAlias: string; locationId: number | string }> = []
      for (const doc of result.docs) {
        const locationId = relationId(doc.location)
        if (locationId === null) continue
        mapped.push({ normalizedAlias: doc.normalizedAlias, locationId })
      }
      return mapped
    },
  }
}

/**
 * 楼盘商户关系一次性查全（D10，只有房源导入需要）。depth:1 展开 merchant，
 * 交给纯函数 mapBuildingMerchantRelationDocs 做字段搬运——不在这里重复那份映射。
 * 不按楼盘收窄：candidate buildings 本就已经一次性查全（loadBuildingCandidates
 * 同一套做法），量级不足以值得按行拆成 N+1 查询。
 */
async function loadBuildingMerchantRelations(req: RequestContext): Promise<BuildingMerchantRelationInput[]> {
  const result = await req.payload.find({
    collection: 'building-merchant-relations',
    depth: 1,
    limit: 0,
    overrideAccess: true,
    req,
  })
  return mapBuildingMerchantRelationDocs(result.docs as unknown as RawBuildingMerchantRelationDoc[])
}

/**
 * 供给商户候选一次性查全（OPT-045）：两张模板的「供给商户」列按名称解析用。
 *
 * `depth: 1` 让 `serviceCities` 展开——§10（服务城市覆盖楼盘城市）判定要拿城市 id，
 * depth:0 只有裸 id 数组时也能比对，但展开后与 `mapBuildingMerchantRelationDocs`
 * 走同一形状，少一处分支。
 *
 * **不按状态过滤**：停用 / 资质失效的商户也要查出来，否则运营填了一个停用商户的名字
 * 会得到「未找到该商户」——文案指错方向，她会去检查有没有拼错，而真正的问题是商户停用了。
 * 合格性由 `resolveMerchantByName` 判定并给出准确原因。
 */
async function loadMerchantCandidates(req: RequestContext): Promise<MerchantCandidate[]> {
  const result = await req.payload.find({
    collection: 'merchants',
    depth: 1,
    limit: 0,
    overrideAccess: true,
    req,
  })
  return (result.docs as unknown as Array<Record<string, unknown>>).map((doc) => ({
    id: doc.id as number | string,
    name: String(doc.name ?? ''),
    status: doc.status,
    qualificationStatus: doc.qualificationStatus,
    qualificationExpiresAt: doc.qualificationExpiresAt as string | Date | null | undefined,
    serviceCityIds: Array.isArray(doc.serviceCities)
      ? (doc.serviceCities as unknown[])
          .map((entry) =>
            typeof entry === 'object' && entry !== null && 'id' in entry
              ? ((entry as { id: unknown }).id as number | string)
              : (entry as number | string),
          )
          .filter((id) => id !== null && id !== undefined)
      : [],
  }))
}

/**
 * 逐城市解析平台自营商户（OPT-045 §5.1），结果按城市 id 索引给行校验消费。
 *
 * **必须在这里带着 cityId 查**，不能只查一次拿一个全局默认值——D3 是七城各建一个，
 * 「哪个城市用哪个」正是 §10 要判的东西。行校验是纯函数、不查库，所以查询必须前移到这里。
 *
 * 只对本次导入实际出现的城市查（`cityIds`），不是七城全查——一批表格通常只涉及一两个城市。
 */
async function loadPlatformDefaultMerchants(
  req: RequestContext,
  cityIds: ReadonlyArray<number | string>,
): Promise<Map<string, number | string | null>> {
  const unique = [...new Set(cityIds.map((id) => String(id)))]
  const entries = await Promise.all(
    unique.map(async (cityId) => {
      // 与 Listings / BuildingMerchantRelations 两个既有调用点同一写法：
      // MerchantLookupPort 是刻意收窄的最小端口（便于单测 mock），与 BasePayload
      // 的完整签名不结构兼容，靠调用点显式转换。
      const resolved = await resolveDefaultSupplyMerchant(
        req.payload as unknown as MerchantLookupPort,
        { cityId, req },
      )
      return [cityId, resolved ?? null] as const
    }),
  )
  return new Map(entries)
}

/**
 * 楼盘候选一次性查全（供 resolveBuilding 匹配用）。不按城市收窄——收窄发生在逐行校验的
 * allowedCityIds。
 *
 * 最终评审 Critical 2：depth 从 0 改为 1，把 city / district 一并展开取 status——
 * §7（`public-building.ts`）判定楼盘是否为有效供给，需要楼盘自身 status /
 * operationalStatus / deletedAt，以及所属城市与行政区的 status。此前 depth:0 只取到
 * 裸 id，`isBuildingCandidatePublic` 拿不到这些字段就只能恒为 true，等于没校验。
 */
async function loadBuildingCandidates(req: RequestContext): Promise<BuildingCandidate[]> {
  const result = await req.payload.find({
    collection: 'buildings',
    depth: 1,
    limit: 0,
    overrideAccess: true,
    req,
  })
  return result.docs.map((doc) => ({
    id: doc.id,
    name: doc.name,
    slug: doc.slug,
    externalId: doc.dataSource?.externalId ?? null,
    cityId: relationId(doc.city ?? null),
    status: doc.status,
    operationalStatus: doc.operationalStatus,
    deletedAt: doc.deletedAt,
    cityStatus: typeof doc.city === 'object' && doc.city !== null ? doc.city.status : null,
    districtStatus: typeof doc.district === 'object' && doc.district !== null ? doc.district.status : null,
  }))
}

// ────────────────────────────────────────────────────────────
// 逐行校验分派（building-row / listing-row 共用同一套编排）
// ────────────────────────────────────────────────────────────

function runRowValidation<T extends { externalId: string }>(
  rows: readonly RawRow[],
  rowNumbers: readonly number[],
  validate: (
    row: RawRow,
    rowNumber: number,
    ctx: RowContext,
  ) => { ok: true; value: T } | { ok: false; errors: RowError[] },
  ctx: RowContext,
): { values: T[]; valueRowNumbers: number[]; errors: RowError[] } {
  const values: T[] = []
  const valueRowNumbers: number[] = []
  const errors: RowError[] = []
  rows.forEach((row, i) => {
    const result = validate(row, rowNumbers[i], ctx)
    if (result.ok) {
      values.push(result.value)
      valueRowNumbers.push(rowNumbers[i])
    } else {
      errors.push(...result.errors)
    }
  })
  return { values, valueRowNumbers, errors }
}

// ────────────────────────────────────────────────────────────
// 批次记录持久化形态（json 字段，自定，preflight 写 / execute+errors 读，闭环自洽）
// ────────────────────────────────────────────────────────────

/** validRows 持久化形态：附上原 Excel 行号，供 execute 复核城市范围时定位到具体行。 */
interface PersistedValidRow {
  rowNumber: number
  cityId: number | string | null
  [key: string]: unknown
}

function toPersistedValidRows<T extends { cityId: number | string | null }>(
  values: readonly T[],
  rowNumbers: readonly number[],
): PersistedValidRow[] {
  return values.map((value, i) => ({ rowNumber: rowNumbers[i], ...value }))
}

/**
 * 结构守卫，不是形式主义的 Array.isArray——validRows 是自由 json 字段，元素可能是
 * `{}` 或裸数字。execute 的城市复核直接读这里返回值的 `.cityId` 做安全判断
 * （见 createExecuteEndpoint），假装通过等于把越权检查关掉，等价于 `as`。
 */
function isPersistedValidRow(value: unknown): value is PersistedValidRow {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.rowNumber === 'number' && 'cityId' in row && 'externalId' in row
}

function isPersistedValidRowArray(value: unknown): value is PersistedValidRow[] {
  return Array.isArray(value) && value.every(isPersistedValidRow)
}

/**
 * rowErrors 持久化形态：不只存 RowError[]，还存错误行的原始单元格文本，供
 * `/errors` 下载端点还原出「原表 + 错误原因」的可回填 xlsx——不这样存的话，
 * 下载时只剩报错单元格的 rawValue，同一行里校验通过的其它列文本会丢失。
 */
interface PersistedRowErrors {
  errors: RowError[]
  rawRows: RawRow[]
  rawRowNumbers: number[]
  [key: string]: unknown
}

function isPersistedRowErrors(value: unknown): value is PersistedRowErrors {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.errors) && Array.isArray(v.rawRows) && Array.isArray(v.rawRowNumbers)
}

const EMPTY_ROW_ERRORS: PersistedRowErrors = { errors: [], rawRows: [], rawRowNumbers: [] }

// ────────────────────────────────────────────────────────────
// Step 4: POST /bulk-import/preflight
// ────────────────────────────────────────────────────────────

function createPreflightEndpoint(): Endpoint {
  return {
    path: '/bulk-import/preflight',
    method: 'post',
    handler: async (reqIn) => {
      const req = reqIn as RequestContext

      // 1. 权限守卫
      const guard = await guardImport(req)
      if (!guard.ok) return guard.response
      const { ctx } = guard

      // 2. 取上传文件（multipart）；真实请求下 addDataAndFileToRequest 会解析
      //    Content-Type: multipart/... 并把文件挂到 req.file，非 multipart 请求无副作用。
      await addDataAndFileToRequest(req)
      const file = req.file
      if (!file) {
        return Response.json({ ok: false, code: 'NO_FILE', error: '未上传文件' }, { status: 400 })
      }

      // 3. 文件大小上限
      if (file.size > MAX_FILE_BYTES) {
        return Response.json({ ok: false, code: 'FILE_TOO_LARGE', error: '文件超过大小上限' }, { status: 400 })
      }

      // 4. 导入类型（?type=buildings|listings）
      const type = parseImportType(req.url)
      if (!type) {
        return Response.json({ ok: false, code: 'BAD_TYPE', error: 'type 参数只接受 buildings 或 listings' }, { status: 400 })
      }
      const columns = columnsForType(type)

      // 5. 解析工作簿
      const parsed = await parseWorkbook(file.data, file.name, columns)
      if (!parsed.ok) {
        return Response.json({ ok: false, code: parsed.code, error: parsed.message }, { status: 400 })
      }
      const { rows, rowNumbers } = parsed

      // 6. 关系解析表 + 楼盘候选 + 楼盘商户关系（D10，只有房源导入需要；楼盘导入
      //    传空数组——楼盘本身不需要商户，不该为它多打一次无谓的查询）（不写业务表，只读）
      const [tables, buildings, buildingMerchantRelations, merchants] = await Promise.all([
        buildResolveTables(createRefLookupPort(req)),
        loadBuildingCandidates(req),
        type === 'listings' ? loadBuildingMerchantRelations(req) : Promise.resolve([]),
        loadMerchantCandidates(req),
      ])

      // OPT-045 §5.1：平台自营商户回落必须按城市解析（D3 七城各一个），而城市要到
      // 行校验时才从单元格解析出来——鸡生蛋。这里按「本次操作者可导入的城市全集」
      // 预解析：至多七个城市，且都是走索引的小查询，比把查库塞进行校验（那会让纯函数
      // 变成异步、还会 N+1）划算得多。
      //
      // 只有房源导入需要回落——楼盘本身不挂商户，楼盘模板的商户列是显式填的。
      const importableCityIds =
        ctx.cityIds === 'all'
          ? (tables.locations.city ?? []).map((c) => c.id)
          : [...ctx.cityIds]
      const platformDefaultMerchantByCity =
        type === 'listings'
          ? await loadPlatformDefaultMerchants(req, importableCityIds)
          : undefined

      const rowCtx: RowContext = {
        tables,
        buildings,
        allowedCityIds: ctx.cityIds,
        buildingMerchantRelations,
        merchants,
        platformDefaultMerchantByCity,
        now: new Date(),
      }

      // 7 + 8. 逐行校验 + 批内编号查重（不重写查重逻辑，调用 Task 4 的 markDuplicateExternalIds）
      let persistedValidRows: PersistedValidRow[]
      let allErrors: RowError[]

      if (type === 'buildings') {
        const { values, valueRowNumbers, errors } = runRowValidation<ValidBuildingRow>(
          rows,
          rowNumbers,
          validateBuildingRow,
          rowCtx,
        )
        const dup = markDuplicateExternalIds(values, valueRowNumbers, '楼盘编号')
        persistedValidRows = toPersistedValidRows(dup.kept, dup.keptRowNumbers)
        allErrors = [...errors, ...dup.errors]
      } else {
        const { values, valueRowNumbers, errors } = runRowValidation<ValidListingRow>(
          rows,
          rowNumbers,
          validateListingRow,
          rowCtx,
        )
        const dup = markDuplicateExternalIds(values, valueRowNumbers, '房源编号')
        persistedValidRows = toPersistedValidRows(dup.kept, dup.keptRowNumbers)
        allErrors = [...errors, ...dup.errors]
      }

      allErrors.sort((a, b) => a.rowNumber - b.rowNumber)

      const errorRowNumbers = new Set(allErrors.map((e) => e.rowNumber))
      const rawRows: RawRow[] = []
      const rawRowNumbers: number[] = []
      rows.forEach((row, i) => {
        if (errorRowNumbers.has(rowNumbers[i])) {
          rawRows.push(row)
          rawRowNumbers.push(rowNumbers[i])
        }
      })
      const persistedRowErrors: PersistedRowErrors = { errors: allErrors, rawRows, rawRowNumbers }

      // 9. 只写 supply-import-batches——预检绝不写 buildings / listings
      const batch = await req.payload.create({
        collection: 'supply-import-batches',
        data: {
          type,
          status: 'preflight',
          operator: numericId(ctx.userId),
          fileName: file.name,
          rowCount: rows.length,
          validRows: persistedValidRows,
          rowErrors: persistedRowErrors,
        },
        overrideAccess: true,
        req,
      })

      // 10. 响应：rowErrors 只带前 PREFLIGHT_ERROR_PREVIEW_LIMIT 条，errorCount 是完整计数
      return Response.json({
        ok: true,
        batchId: batch.id,
        report: {
          rowCount: rows.length,
          validCount: persistedValidRows.length,
          errorCount: allErrors.length,
          rowErrors: allErrors.slice(0, PREFLIGHT_ERROR_PREVIEW_LIMIT),
        },
      })
    },
  }
}

// ────────────────────────────────────────────────────────────
// Step 5: POST /bulk-import/batches/:id/execute
// ────────────────────────────────────────────────────────────

function createExecuteEndpoint(deps: { queueImportJob?: (batchId: number | string) => Promise<void> }): Endpoint {
  return {
    path: '/bulk-import/batches/:id/execute',
    method: 'post',
    handler: async (reqIn) => {
      const req = reqIn as RequestContext

      // 1. 权限守卫
      const guard = await guardImport(req)
      if (!guard.ok) return guard.response
      const { ctx } = guard

      const id = routeId(req)
      if (id === undefined) {
        return Response.json({ ok: false, error: '缺少批次 ID' }, { status: 400 })
      }

      let batch
      try {
        batch = await req.payload.findByID({
          collection: 'supply-import-batches',
          id,
          depth: 0,
          overrideAccess: true,
          req,
        })
      } catch {
        return Response.json({ ok: false, error: '批次不存在' }, { status: 404 })
      }

      // 归属校验：全局范围（ADM）或本人创建的批次；放在状态判断之前，
      // 不让非本人先从 409/403 的差异里探到"这批次存在且处于什么状态"。
      if (!isBatchVisibleTo(ctx, batch)) {
        await writeAuditFailed({
          payload: req.payload,
          req,
          data: {
            action: 'data.import',
            object: { collection: 'supply-import-batches', objectId: id, objectVersion: 1 },
            errorCode: 'FORBIDDEN',
            errorMessage: '尝试执行非本人创建的导入批次',
          },
        })
        return Response.json({ ok: false, code: 'FORBIDDEN', error: '无权操作该导入批次' }, { status: 403 })
      }

      // status !== 'preflight' → 409，防止重复点击重复入队
      if (batch.status !== 'preflight') {
        await writeAuditFailed({
          payload: req.payload,
          req,
          data: {
            action: 'data.import',
            object: { collection: 'supply-import-batches', objectId: id, objectVersion: 1 },
            errorCode: 'BAD_STATE',
            errorMessage: `批次状态为 ${String(batch.status)}，不处于可执行状态`,
          },
        })
        return Response.json({ ok: false, code: 'BAD_STATE', error: '批次不处于可执行状态' }, { status: 409 })
      }

      // validRows 结构守卫：json 字段理论上可能被外部直接写坏；损坏时不当空数组静默放行
      // （那等于把下面的城市复核变成"空循环恒通过"），直接拒绝执行，要求重新预检。
      if (!isPersistedValidRowArray(batch.validRows)) {
        return Response.json(
          { ok: false, code: 'CORRUPTED_BATCH', error: '批次数据结构异常，请重新预检' },
          { status: 409 },
        )
      }

      // 2. 复核城市范围：预检时校验过一次，这里对 validRows 逐行再校验一次——
      //    预检与执行之间用户角色可能已变更，有任一越权行 → 403。
      const validRows = batch.validRows
      const outOfScopeRow = validRows.find((row) => !canReadByCity(ctx, row.cityId))
      if (outOfScopeRow) {
        await writeAuditFailed({
          payload: req.payload,
          req,
          data: {
            action: 'data.import',
            object: { collection: 'supply-import-batches', objectId: id, objectVersion: 1 },
            errorCode: 'CITY_OUT_OF_SCOPE',
            errorMessage: `第 ${outOfScopeRow.rowNumber} 行的城市不在当前操作者的可导入范围内`,
          },
        })
        return Response.json(
          { ok: false, code: 'CITY_OUT_OF_SCOPE', error: '存在超出当前城市范围的行，请重新预检' },
          { status: 403 },
        )
      }

      // 3. status='queued' + startedAt
      const updated = await req.payload.update({
        collection: 'supply-import-batches',
        id,
        data: { status: 'queued', startedAt: new Date().toISOString() },
        overrideAccess: true,
        req,
      })

      // 4. 入队：默认走真实 Jobs Queue（Task 7）。deps.queueImportJob 仍保留为可选注入点
      //    ——单测（tests/supply-import-endpoint.test.ts）用它验证「execute 触发了入队」
      //    而不必真的起 Jobs Queue；不传时才落到下面的真实实现，两者行为在生产环境等价。
      const queueImportJob =
        deps.queueImportJob ??
        (async (batchId: number | string) => {
          await req.payload.jobs.queue({
            task: SUPPLY_IMPORT_TASK,
            queue: SUPPLY_IMPORT_QUEUE,
            input: { batchId: numericId(batchId) },
            overrideAccess: true,
            req,
          })
        })
      await queueImportJob(updated.id)

      // 5. 审计
      await writeAuditSuccess({
        payload: req.payload,
        req,
        data: {
          action: 'data.import',
          object: {
            collection: 'supply-import-batches',
            objectId: updated.id,
            // 该集合没有版本字段；409 的状态守卫已经提供了"同一批次不可重复执行"的幂等保护，
            // 这里固定写 1，与 export-controls.ts 对无版本对象的处理口径一致。
            objectVersion: 1,
          },
          after: { type: updated.type, validCount: validRows.length },
        },
      })

      return Response.json({ ok: true, batchId: updated.id, status: updated.status })
    },
  }
}

// ────────────────────────────────────────────────────────────
// Step 6a: GET /bulk-import/batches/:id
// ────────────────────────────────────────────────────────────

/** 批次 affectedIds 是自由 json 字段，结构可能损坏；安全取出合法 id 列表。 */
function toAffectedIdArray(value: unknown): Array<number | string> {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is number | string => typeof v === 'number' || typeof v === 'string')
}

/**
 * D11 评审第 1 轮 Important 1：缓存失效放在这里而不是 import-task.ts 的 Job
 * handler——那个 handler 由 Jobs Queue cron autoRun 驱动，跑在请求/渲染上下文
 * 之外，`revalidateTag` 在那种上下文调用会抛错，且
 * `revalidatePublicCacheTags` 把这类异常逐个吞成 console.error，"导入后立即
 * 可见" 会静默退化回 cached-queries.ts 的 5 分钟 TTL——等于没修。这个 GET
 * 端点跑在真实请求上下文里，观察到批次进入终态（completed/failed）且
 * affectedIds 非空时触发一次失效。revalidateTag 幂等，轮询多触发几次不是
 * 问题，不为"恰好一次"专门加 schema 字段（会牵出迁移）。
 * 失败只记日志，不影响本次状态查询本身的响应。
 */
async function invalidateSupplyImportCacheOnTerminalStatus(
  req: RequestContext,
  batch: { id: number | string; status?: unknown; affectedIds?: unknown; validRows?: unknown },
): Promise<void> {
  if (batch.status !== 'completed' && batch.status !== 'failed') return
  const affectedIds = toAffectedIdArray(batch.affectedIds)
  if (affectedIds.length === 0) return

  const cityIds = isPersistedValidRowArray(batch.validRows)
    ? batch.validRows
        .map((row) => row.cityId)
        .filter((id): id is number | string => id !== null && id !== undefined)
    : []

  try {
    await invalidateSupplyImportCache(req.payload, req, cityIds, 'supply_import')
  } catch (error) {
    console.error('[bulk-import] cache_invalidation_failed', {
      batchId: batch.id,
      status: batch.status,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function createBatchStatusEndpoint(): Endpoint {
  return {
    path: '/bulk-import/batches/:id',
    method: 'get',
    handler: async (reqIn) => {
      const req = reqIn as RequestContext
      const guard = await guardImport(req)
      if (!guard.ok) return guard.response
      const { ctx } = guard

      const id = routeId(req)
      if (id === undefined) {
        return Response.json({ ok: false, error: '缺少批次 ID' }, { status: 400 })
      }

      let batch
      try {
        batch = await req.payload.findByID({
          collection: 'supply-import-batches',
          id,
          depth: 0,
          overrideAccess: true,
          req,
        })
      } catch {
        return Response.json({ ok: false, error: '批次不存在' }, { status: 404 })
      }

      // 归属校验：全局范围（ADM）或本人创建的批次，不然任何持 data:import 的用户
      // 都能读到别人的批次状态（其中可能含地址、联系方式等敏感原始数据）。
      if (!isBatchVisibleTo(ctx, batch)) {
        return Response.json({ ok: false, code: 'FORBIDDEN', error: '无权查看该导入批次' }, { status: 403 })
      }

      // D11：批次进入终态且确实写入过东西时触发一次公共缓存失效——见函数头注释。
      await invalidateSupplyImportCacheOnTerminalStatus(req, batch)

      const validRows = isPersistedValidRowArray(batch.validRows) ? batch.validRows : []
      const rowErrors = isPersistedRowErrors(batch.rowErrors) ? batch.rowErrors : EMPTY_ROW_ERRORS

      return Response.json({
        ok: true,
        batch: {
          id: batch.id,
          type: batch.type,
          status: batch.status,
          fileName: batch.fileName,
          rowCount: batch.rowCount,
          validCount: validRows.length,
          errorCount: rowErrors.errors.length,
          stats: batch.stats,
          startedAt: batch.startedAt,
          finishedAt: batch.finishedAt,
          createdAt: batch.createdAt,
          updatedAt: batch.updatedAt,
        },
      })
    },
  }
}

// ────────────────────────────────────────────────────────────
// 下载 handler 共用响应构造（Step 6）
// ────────────────────────────────────────────────────────────

function xlsxResponse(buffer: Buffer, name: string): Response {
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`,
    },
  })
}

// ────────────────────────────────────────────────────────────
// Step 6b: GET /bulk-import/batches/:id/errors
// ────────────────────────────────────────────────────────────

function createBatchErrorsEndpoint(): Endpoint {
  return {
    path: '/bulk-import/batches/:id/errors',
    method: 'get',
    handler: async (reqIn) => {
      const req = reqIn as RequestContext
      const guard = await guardImport(req)
      if (!guard.ok) return guard.response
      const { ctx } = guard

      const id = routeId(req)
      if (id === undefined) {
        return Response.json({ ok: false, error: '缺少批次 ID' }, { status: 400 })
      }

      let batch
      try {
        batch = await req.payload.findByID({
          collection: 'supply-import-batches',
          id,
          depth: 0,
          overrideAccess: true,
          req,
        })
      } catch {
        return Response.json({ ok: false, error: '批次不存在' }, { status: 404 })
      }

      // 归属校验：错误表里含完整原始单元格文本（地址、联系方式都可能在里面），
      // 不能让任何持 data:import 的用户下载别人的错误表。
      if (!isBatchVisibleTo(ctx, batch)) {
        return Response.json({ ok: false, code: 'FORBIDDEN', error: '无权查看该导入批次' }, { status: 403 })
      }

      const persisted = isPersistedRowErrors(batch.rowErrors) ? batch.rowErrors : EMPTY_ROW_ERRORS
      const columns = batch.type === 'buildings' ? BUILDING_COLUMNS : LISTING_COLUMNS
      const buffer = await buildErrorWorkbook(columns, persisted.rawRows, persisted.rawRowNumbers, persisted.errors)

      return xlsxResponse(buffer, `${batch.fileName ?? 'import'}-错误表`)
    },
  }
}

// ────────────────────────────────────────────────────────────
// Step 6c: GET /bulk-import/template
// ────────────────────────────────────────────────────────────

function createTemplateEndpoint(): Endpoint {
  return {
    path: '/bulk-import/template',
    method: 'get',
    handler: async (reqIn) => {
      const req = reqIn as RequestContext
      const guard = await guardImport(req)
      if (!guard.ok) return guard.response

      const type = parseImportType(req.url)
      if (!type) {
        return Response.json({ ok: false, code: 'BAD_TYPE', error: 'type 参数只接受 buildings 或 listings' }, { status: 400 })
      }

      const buffer = await buildTemplateWorkbook(columnsForType(type))
      const name = type === 'buildings' ? '楼盘导入模板' : '房源导入模板'
      return xlsxResponse(buffer, name)
    },
  }
}

// ────────────────────────────────────────────────────────────
// Step 6d: GET /bulk-import/building-reference
// ────────────────────────────────────────────────────────────

function createBuildingReferenceEndpoint(): Endpoint {
  return {
    path: '/bulk-import/building-reference',
    method: 'get',
    handler: async (reqIn) => {
      const req = reqIn as RequestContext
      const guard = await guardImport(req)
      if (!guard.ok) return guard.response
      const { ctx } = guard

      // 按 ctx.cityIds 收窄——OPS 不该看到非授权城市的楼盘清单
      const where: Where | undefined =
        ctx.cityIds === 'all' ? undefined : { city: { in: Array.from(ctx.cityIds) } }

      const result = await req.payload.find({
        collection: 'buildings',
        where,
        depth: 1,
        limit: 0,
        overrideAccess: true,
        req,
      })

      const rows = result.docs.map((doc) => ({
        externalId: doc.dataSource?.externalId ?? null,
        name: doc.name,
        slug: doc.slug,
        city: cityDisplayName(doc.city),
      }))

      const buffer = await buildBuildingReferenceWorkbook(rows)
      return xlsxResponse(buffer, '楼盘对照表')
    },
  }
}

// ────────────────────────────────────────────────────────────
// Task 9: POST /bulk-import/batches/:id/rollback
//
// 回滚是补偿"导入直接上架、绕过审核闸门"这个产品决定的唯一止血手段——出事时
// 凭批次的 affectedIds 把整批撤下前台。三条不可妥协的语义（详见
// domain/supply-import/batch-rollback.ts 顶部注释）：下架而非删除、幂等、
// 文档仍然存在。这里只负责权限守卫（与 execute 同一道归属校验，回滚是更危险的
// 写操作，不能漏）+ 审计，状态迁移逻辑全部委托给 rollbackImportBatch。
// ────────────────────────────────────────────────────────────

function createRollbackEndpoint(): Endpoint {
  return {
    path: '/bulk-import/batches/:id/rollback',
    method: 'post',
    handler: async (reqIn) => {
      const req = reqIn as RequestContext

      // 1. 权限守卫
      const guard = await guardImport(req)
      if (!guard.ok) return guard.response
      const { ctx } = guard

      const id = routeId(req)
      if (id === undefined) {
        return Response.json({ ok: false, error: '缺少批次 ID' }, { status: 400 })
      }

      let batch
      try {
        batch = await req.payload.findByID({
          collection: 'supply-import-batches',
          id,
          depth: 0,
          overrideAccess: true,
          req,
        })
      } catch {
        return Response.json({ ok: false, error: '批次不存在' }, { status: 404 })
      }

      // 归属校验：与 execute / 状态轮询 / 错误表下载同一道「本人 or 全局」判据——
      // 回滚是更危险的写操作（批量下架），不能比只读接口松。
      if (!isBatchVisibleTo(ctx, batch)) {
        await writeAuditFailed({
          payload: req.payload,
          req,
          data: {
            action: 'data.import',
            object: { collection: 'supply-import-batches', objectId: id, objectVersion: 1 },
            errorCode: 'FORBIDDEN',
            errorMessage: '尝试回滚非本人创建的导入批次',
          },
        })
        return Response.json({ ok: false, code: 'FORBIDDEN', error: '无权操作该导入批次' }, { status: 403 })
      }

      // 2. 状态迁移：下架而非删除、幂等、保留文档，逐条容错全部在 rollbackImportBatch
      //    里完成（单条 id 的异常已经在那一层兜住、计入 failed，不会冒泡到这里）。
      //    这里仍包一层 try/catch 兜意料之外的异常（比如两次 findByID 之间批次被
      //    并发改动的竞态）——评审 Important：不能让运营看到裸 500 却猜不出这次
      //    回滚到底有没有部分生效，异常时要走结构化错误 + 审计留痕，而不是让框架
      //    的默认 500 兜底把"已部分生效"这个事实吞掉。
      let result
      try {
        result = await rollbackImportBatch({
          payload: req.payload,
          req,
          batchId: batch.id,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '回滚执行时发生未预期的异常'
        await writeAuditFailed({
          payload: req.payload,
          req,
          data: {
            action: 'data.import',
            object: { collection: 'supply-import-batches', objectId: batch.id, objectVersion: 1 },
            errorCode: 'ROLLBACK_FAILED',
            errorMessage: message,
          },
        })
        return Response.json(
          {
            ok: false,
            code: 'ROLLBACK_FAILED',
            error: '回滚执行异常，本批可能只部分生效，请核对批次状态后再决定是否重试',
          },
          { status: 500 },
        )
      }
      const { unpublished, skipped, failed } = result

      // D11：回滚成功后触发一次公共缓存失效——「一键下架」的止血承诺不能只靠
      // cached-queries.ts 的 5 分钟 TTL 兜底。只在真的有文档被下架时才失效
      // （unpublished === 0 时这次回滚是纯粹的幂等空操作，缓存里没有需要刷新的内容）；
      // 城市从 batch.validRows 取（预检时persist 的快照，完成 7 天后才会被清空，
      // 回滚通常发生在这个窗口内）——取不到就传空数组，交给
      // invalidateSupplyImportPublicCache 自己的"全城市兜底"降级语义处理，不在这里
      // 另外发明。失败只记日志，不影响回滚本身已经成功的事实。
      if (unpublished > 0) {
        const cityIds = isPersistedValidRowArray(batch.validRows)
          ? batch.validRows
              .map((row) => row.cityId)
              .filter((id): id is number | string => id !== null && id !== undefined)
          : []
        await invalidateSupplyImportCache(req.payload, req, cityIds, 'supply_import_rollback').catch((error) => {
          console.error('[bulk-import] cache_invalidation_failed', {
            batchId: batch.id,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }

      // 3. 审计
      await writeAuditSuccess({
        payload: req.payload,
        req,
        data: {
          action: 'data.import',
          object: { collection: 'supply-import-batches', objectId: batch.id, objectVersion: 1 },
          after: { rollback: true, unpublished },
        },
      })

      return Response.json({ ok: true, batchId: batch.id, unpublished, skipped, failed })
    },
  }
}

// ────────────────────────────────────────────────────────────
// 汇总注册
// ────────────────────────────────────────────────────────────

export function createBulkImportEndpoints(deps?: {
  queueImportJob?: (batchId: number | string) => Promise<void>
}): Endpoint[] {
  return [
    createPreflightEndpoint(),
    createExecuteEndpoint(deps ?? {}),
    createBatchStatusEndpoint(),
    createBatchErrorsEndpoint(),
    createTemplateEndpoint(),
    createBuildingReferenceEndpoint(),
    createRollbackEndpoint(),
  ]
}
