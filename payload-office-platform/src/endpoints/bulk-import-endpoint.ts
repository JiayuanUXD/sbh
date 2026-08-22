import type { Endpoint, Where } from 'payload'
import { addDataAndFileToRequest } from 'payload'

import { canReadByCity, requireOperationPermission, type RequestContext } from '@/domain/auth/access'
import type { PermissionContext } from '@/domain/auth/permission-context'
import { writeAuditFailed, writeAuditSuccess } from '@/domain/audit/audit-writer'
import { BUILDING_COLUMNS, validateBuildingRow, type ValidBuildingRow } from '@/domain/supply-import/building-row'
import { markDuplicateExternalIds } from '@/domain/supply-import/duplicate-check'
import { LISTING_COLUMNS, validateListingRow, type ValidListingRow } from '@/domain/supply-import/listing-row'
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

/** 楼盘候选一次性查全（供 resolveBuilding 匹配用）。不按城市收窄——收窄发生在逐行校验的 allowedCityIds。 */
async function loadBuildingCandidates(req: RequestContext): Promise<BuildingCandidate[]> {
  const result = await req.payload.find({
    collection: 'buildings',
    depth: 0,
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

      // 6. 关系解析表 + 楼盘候选（不写业务表，只读）
      const [tables, buildings] = await Promise.all([
        buildResolveTables(createRefLookupPort(req)),
        loadBuildingCandidates(req),
      ])
      const rowCtx: RowContext = { tables, buildings, allowedCityIds: ctx.cityIds }

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

      // 4. 入队注入点：本任务只留口子，Task 7 接上真实 Jobs Queue 实现
      if (deps.queueImportJob) {
        await deps.queueImportJob(updated.id)
      }

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
  ]
}
