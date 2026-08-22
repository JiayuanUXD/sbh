import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import ExcelJS from 'exceljs'

// D11：createRollbackEndpoint 成功路径会触发 invalidateSupplyImportCache →
// revalidateTag。mock 掉 next/cache，好在下面直接断言"回滚成功后确实调用了缓存
// 失效"，而不必真的跑在 Next 请求上下文里。
const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }))
vi.mock('next/cache', () => ({ revalidateTag }))

import { createBulkImportEndpoints, PREFLIGHT_ERROR_PREVIEW_LIMIT } from '@/endpoints/bulk-import-endpoint'
import { BUILDING_COLUMNS } from '@/domain/supply-import/building-row'
import { LISTING_COLUMNS } from '@/domain/supply-import/listing-row'
import type { Role, User } from '@/payload-types'

/**
 * 批量导入端点测试（OPT-041 Task 6）。
 *
 * 用一个内存 mock payload 模拟：roles / users(仅取权限字段) / locations /
 * location-aliases / buildings / supply-import-batches / audit-logs。
 * 覆盖四条不可妥协语义 + 第一轮评审补的 5 条 Important：
 *   1. 预检不写业务表（buildings/listings 的 create 恒不被调用）
 *   2. 未登录 / 无权限一律 403
 *   3. execute 复核城市范围（同一操作者城市范围被收窄后再执行 → 403）
 *   4. status !== 'preflight' 执行请求 → 409
 *   5. 横向越权：GET 状态/错误表/execute/rollback 四条路由都要挡非本人（全局范围除外）
 *   6. isPersistedValidRowArray 是真结构守卫，损坏数据不当空数组放行
 *   7. rowNumbers[i] 不变量回归测试（含空行跳过）
 *   8. listings 分支覆盖（成功 + 批内查重用 '房源编号' 而不是 '楼盘编号'）
 *   9. execute 的 409 / 403 分支写 writeAuditFailed 留痕
 */

// ────────────────────────────────────────────────────────────
// 固定数据
// ────────────────────────────────────────────────────────────

const ROLE_ADM: Role = {
  id: 1,
  code: 'ADM',
  name: '平台管理员',
  isBuiltin: true,
  status: 'active',
  dataScope: 'global',
  menuPermissions: ['*'],
  operationPermissions: ['*'],
  fieldPermissions: ['*'],
  updatedAt: '',
  createdAt: '',
} as unknown as Role

const ROLE_OPS_SHANGHAI: Role = {
  id: 2,
  code: 'OPS',
  name: '运营（限上海）',
  isBuiltin: true,
  status: 'active',
  dataScope: 'city',
  menuPermissions: [],
  operationPermissions: ['data:import'],
  fieldPermissions: [],
  updatedAt: '',
  createdAt: '',
} as unknown as Role

const ROLE_NO_IMPORT: Role = {
  id: 3,
  code: 'CSR',
  name: '客服（无导入权限）',
  isBuiltin: true,
  status: 'active',
  dataScope: 'self',
  menuPermissions: [],
  operationPermissions: [],
  fieldPermissions: [],
  updatedAt: '',
  createdAt: '',
} as unknown as Role

const CITY_SH = { id: 10, name: '上海', type: 'city', parent: null }
const DISTRICT_PUDONG = { id: 20, name: '浦东新区', type: 'district', parent: 10 }
const CITY_BJ = { id: 11, name: '北京', type: 'city', parent: null }
const DISTRICT_CHAOYANG = { id: 21, name: '朝阳区', type: 'district', parent: 11 }
const LOCATIONS = [CITY_SH, DISTRICT_PUDONG, CITY_BJ, DISTRICT_CHAOYANG]

const BUILDING_SH = {
  id: 100,
  name: '环球金融中心',
  slug: 'huanqiu',
  city: 10,
  dataSource: { externalId: 'B-EXIST' },
}
const BUILDINGS = [BUILDING_SH]

// D10：房源导入要靠 building-merchant-relations 推出 listings.merchant。
// BUILDING_SH 默认配一条当前生效且合格的关系，让既有 listings 分支测试不用逐个改。
const MERCHANT_ACTIVE = {
  id: 500,
  name: '测试商户',
  status: 'active',
  qualificationStatus: 'valid',
  qualificationExpiresAt: null,
  serviceCities: [10],
}
const RELATION_ACTIVE = {
  id: 1,
  building: 100,
  merchant: MERCHANT_ACTIVE,
  effectiveFrom: '2020-01-01T00:00:00.000Z',
  effectiveTo: null,
}

function adminUser(): User {
  return {
    id: 900,
    name: 'admin',
    email: 'admin@example.com',
    status: 'active',
    sessionVersion: 1,
    roles: [1],
    cityScope: [],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
  } as unknown as User
}

function opsUserShanghai(): User {
  return {
    id: 901,
    name: 'ops-sh',
    email: 'ops-sh@example.com',
    status: 'active',
    sessionVersion: 1,
    roles: [2],
    cityScope: [10],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
  } as unknown as User
}

/** 任意 id + cityScope 的 OPS 用户；用于「同一操作者的城市范围被收窄」与「非本人访问」两类场景。 */
function opsUser(id: number, cityScope: number[]): User {
  return {
    id,
    name: `ops-${id}`,
    email: `ops-${id}@example.com`,
    status: 'active',
    sessionVersion: 1,
    roles: [2],
    cityScope,
    updatedAt: '',
    createdAt: '',
    collection: 'users',
  } as unknown as User
}

function noImportUser(): User {
  return {
    id: 902,
    name: 'csr',
    email: 'csr@example.com',
    status: 'active',
    sessionVersion: 1,
    roles: [3],
    cityScope: [],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
  } as unknown as User
}

// ────────────────────────────────────────────────────────────
// xlsx 构造
// ────────────────────────────────────────────────────────────

async function makeXlsxBuffer(columns: readonly string[], rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow([...columns])
  for (const row of rows) ws.addRow(row)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ────────────────────────────────────────────────────────────
// mock payload
// ────────────────────────────────────────────────────────────

interface MockPayload {
  find: ReturnType<typeof vi.fn>
  findByID: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

function makeMockPayload(
  roles: Role[],
  buildingMerchantRelations: Array<Record<string, unknown>> = [RELATION_ACTIVE],
): {
  payload: MockPayload
  batches: Map<number, Record<string, unknown>>
  listings: Map<number, Record<string, unknown>>
} {
  const batches = new Map<number, Record<string, unknown>>()
  // D11 回滚测试用：让 findByID/update 能操作一个"房源"文档，验证
  // createRollbackEndpoint 在 unpublished > 0 时真的触发了缓存失效。其余测试不碰
  // listings，留空即可。
  const listings = new Map<number, Record<string, unknown>>()
  let nextBatchId = 1
  let nextAuditId = 1

  const find = vi.fn(async (opts: { collection: string; where?: unknown }) => {
    const where = opts.where as
      | {
          id?: { in?: unknown[] }
          type?: { equals?: unknown }
          kind?: { equals?: unknown }
          city?: { in?: unknown[] }
        }
      | undefined

    if (opts.collection === 'roles') {
      const ids = where?.id?.in ?? []
      return { docs: roles.filter((r) => (ids as unknown[]).includes(r.id)) }
    }
    if (opts.collection === 'locations') {
      const kind = where?.type?.equals
      return { docs: LOCATIONS.filter((l) => l.type === kind) }
    }
    if (opts.collection === 'location-aliases') {
      return { docs: [] }
    }
    if (opts.collection === 'buildings') {
      let docs = BUILDINGS
      const cityIn = where?.city?.in
      if (cityIn) {
        docs = BUILDINGS.filter((b) => (cityIn as unknown[]).includes(b.city))
      }
      return { docs }
    }
    if (opts.collection === 'building-merchant-relations') {
      return { docs: buildingMerchantRelations }
    }
    return { docs: [] }
  })

  const findByID = vi.fn(async (opts: { collection: string; id: number | string }) => {
    if (opts.collection === 'supply-import-batches') {
      const batch = batches.get(Number(opts.id))
      if (!batch) throw new Error('not found')
      return batch
    }
    if (opts.collection === 'listings') {
      const doc = listings.get(Number(opts.id))
      if (!doc) throw new Error('not found')
      return doc
    }
    throw new Error(`unexpected findByID collection ${opts.collection}`)
  })

  const create = vi.fn(async (opts: { collection: string; data: Record<string, unknown> }) => {
    if (opts.collection === 'supply-import-batches') {
      const id = nextBatchId++
      const doc = { id, createdAt: '', updatedAt: '', ...opts.data }
      batches.set(id, doc)
      return doc
    }
    if (opts.collection === 'audit-logs') {
      return { id: nextAuditId++, auditId: `audit-${nextAuditId}` }
    }
    // 关键断言点：预检绝不该走到这里创建 buildings / listings
    throw new Error(`unexpected create on collection ${opts.collection}`)
  })

  const update = vi.fn(async (opts: { collection: string; id: number | string; data: Record<string, unknown> }) => {
    if (opts.collection === 'supply-import-batches') {
      const key = Number(opts.id)
      const existing = batches.get(key)
      if (!existing) throw new Error('not found')
      const updated = { ...existing, ...opts.data }
      batches.set(key, updated)
      return updated
    }
    if (opts.collection === 'listings') {
      const key = Number(opts.id)
      const existing = listings.get(key)
      if (!existing) throw new Error('not found')
      const updated = { ...existing, ...opts.data }
      listings.set(key, updated)
      return updated
    }
    throw new Error(`unexpected update on collection ${opts.collection}`)
  })

  return { payload: { find, findByID, create, update }, batches, listings }
}

function makeReq(params: {
  user?: User | null
  payload: MockPayload
  url?: string
  routeParams?: Record<string, unknown>
  file?: { data: Buffer; mimetype: string; name: string; size: number }
}): PayloadRequest {
  const req = {
    user: params.user ?? null,
    payload: params.payload,
    url: params.url,
    routeParams: params.routeParams,
    file: params.file,
    method: 'POST',
    // body 留空 → addDataAndFileToRequest 内部条件判定为假，直接跳过，不覆盖上面手工设置的 file
  }
  return req as unknown as PayloadRequest
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

// ────────────────────────────────────────────────────────────
// 路由契约（brief Step 1，逐字保留）
// ────────────────────────────────────────────────────────────

describe('createBulkImportEndpoints 路由契约', () => {
  const endpoints = createBulkImportEndpoints()

  it('注册七个路由，方法与路径固定', () => {
    expect(endpoints.map((e) => `${String(e.method).toUpperCase()} ${e.path}`).sort()).toEqual([
      'GET /bulk-import/batches/:id',
      'GET /bulk-import/batches/:id/errors',
      'GET /bulk-import/building-reference',
      'GET /bulk-import/template',
      'POST /bulk-import/batches/:id/execute',
      'POST /bulk-import/batches/:id/rollback',
      'POST /bulk-import/preflight',
    ])
  })

  it('未登录请求返回 403 而不是 200', async () => {
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')
    expect(preflight).toBeDefined()
    const req = {
      payload: { find: async () => ({ docs: [] }) },
      url: 'http://localhost/api/bulk-import/preflight',
    } as never
    const res = await preflight!.handler(req)
    expect(res.status).toBe(403)
  })
})

// ────────────────────────────────────────────────────────────
// 权限守卫：全部六条路由都要 403（无权限 / 未登录）
// ────────────────────────────────────────────────────────────

describe('guardImport：每条路由第一件事都是权限守卫', () => {
  it('无 data:import 权限的登录用户在全部七条路由上都得到 403', async () => {
    const endpoints = createBulkImportEndpoints()
    const { payload } = makeMockPayload([ROLE_NO_IMPORT])
    for (const endpoint of endpoints) {
      const req = makeReq({
        user: noImportUser(),
        payload,
        url: 'http://localhost/api/bulk-import/template?type=buildings',
        routeParams: { id: '1' },
      })
      const res = (await endpoint.handler(req)) as Response
      expect(res.status).toBe(403)
    }
  })
})

// ────────────────────────────────────────────────────────────
// preflight：语义 1（不写业务表）+ 截断 + 查重
// ────────────────────────────────────────────────────────────

describe('POST /bulk-import/preflight', () => {
  it('管理员上传合法楼盘表 → 200，只写 supply-import-batches，不碰 buildings/listings', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const { payload, batches } = makeMockPayload([ROLE_ADM])

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-001', '新楼盘', '上海', '浦东新区', '', '', '', ''],
    ])
    const req = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=buildings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
    })

    const res = (await preflight.handler(req)) as Response
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.ok).toBe(true)
    expect((body.report as { validCount: number }).validCount).toBe(1)
    expect((body.report as { errorCount: number }).errorCount).toBe(0)

    // 语义 1：create 只被 supply-import-batches 调用过，没有 buildings/listings
    expect(payload.create).toHaveBeenCalledTimes(1)
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'supply-import-batches' }),
    )
    expect(batches.size).toBe(1)
    const stored = batches.get(1)!
    expect(stored.status).toBe('preflight')
  })

  it('无文件 → 400 NO_FILE；类型非法 → 400 BAD_TYPE', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const { payload } = makeMockPayload([ROLE_ADM])

    const noFileReq = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=buildings',
    })
    const noFileRes = (await preflight.handler(noFileReq)) as Response
    expect(noFileRes.status).toBe(400)
    expect((await readJson(noFileRes)).code).toBe('NO_FILE')

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [])
    const badTypeReq = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=nope',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'x.xlsx', size: buf.length },
    })
    const badTypeRes = (await preflight.handler(badTypeReq)) as Response
    expect(badTypeRes.status).toBe(400)
    expect((await readJson(badTypeRes)).code).toBe('BAD_TYPE')
  })

  it('批内编号重复 → 走 markDuplicateExternalIds，重复行计入错误而不是被静默丢弃', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const { payload } = makeMockPayload([ROLE_ADM])

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-DUP', '楼盘甲', '上海', '浦东新区', '', '', '', ''],
      ['BLD-DUP', '楼盘乙', '上海', '浦东新区', '', '', '', ''],
    ])
    const req = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=buildings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
    })
    const res = (await preflight.handler(req)) as Response
    const body = await readJson(res)
    const report = body.report as { validCount: number; errorCount: number; rowErrors: Array<{ code: string }> }
    expect(report.validCount).toBe(1)
    expect(report.errorCount).toBe(1)
    expect(report.rowErrors[0].code).toBe('DUPLICATE_EXTERNAL_ID')
  })

  it('错误行超过预览上限 → 响应只带前 50 条，errorCount 仍是完整计数', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const { payload } = makeMockPayload([ROLE_ADM])

    // 60 行楼盘编号全部留空 → 每行都触发 REQUIRED 错误
    const rows = Array.from({ length: 60 }, (_, i) => ['', `楼盘${i}`, '上海', '浦东新区', '', '', '', ''])
    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, rows)
    const req = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=buildings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
    })
    const res = (await preflight.handler(req)) as Response
    const body = await readJson(res)
    const report = body.report as { errorCount: number; rowErrors: unknown[] }
    expect(report.errorCount).toBe(60)
    expect(report.rowErrors.length).toBe(PREFLIGHT_ERROR_PREVIEW_LIMIT)
  })

  it('OPS（限上海）导入含北京行的表 → 该行判为 CITY_OUT_OF_SCOPE 错误行，不静默跳过', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const { payload } = makeMockPayload([ROLE_OPS_SHANGHAI])

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-BJ', '北京楼盘', '北京', '朝阳区', '', '', '', ''],
    ])
    const req = makeReq({
      user: opsUserShanghai(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=buildings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
    })
    const res = (await preflight.handler(req)) as Response
    const body = await readJson(res)
    const report = body.report as { validCount: number; rowErrors: Array<{ code: string }> }
    expect(report.validCount).toBe(0)
    expect(report.rowErrors[0].code).toBe('CITY_OUT_OF_SCOPE')
  })

  it('rowNumbers[i] 不变量：跳过空行后错误行号仍是真实 Excel 行号，不退化成数组下标', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const { payload } = makeMockPayload([ROLE_ADM])

    // 第 2 行有效；第 3、5 行全空被跳过；第 4、6 行各触发一条错误。
    // 如果实现把 validate(row, rowNumbers[i], ctx) 误写成 validate(row, i, ctx)，
    // 在有空行被跳过、数组下标与 Excel 行号不再线性对应时，这里会立刻暴露
    // （下标序列是 0,1,2 而不是 2,4,6）。
    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-100', '有效楼盘', '上海', '浦东新区', '', '', '', ''],
      [],
      ['', '缺编号楼盘A', '上海', '浦东新区', '', '', '', ''],
      [],
      ['', '缺编号楼盘B', '上海', '浦东新区', '', '', '', ''],
    ])
    const req = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=buildings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
    })
    const res = (await preflight.handler(req)) as Response
    const body = await readJson(res)
    const report = body.report as { rowErrors: Array<{ rowNumber: number; column: string }> }
    expect(report.rowErrors.map((e) => e.rowNumber)).toEqual([4, 6])
    expect(report.rowErrors.every((e) => e.column === '楼盘编号')).toBe(true)
  })

  it('listings 分支：合法房源表 → 200，校验走的是 validateListingRow', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const { payload } = makeMockPayload([ROLE_ADM])

    const buf = await makeXlsxBuffer(LISTING_COLUMNS, [
      ['L-001', '环球金融中心 280㎡ 精装办公室', '传统办公室', 'B-EXIST', '280㎡', '4.5元/㎡/天', '12层', '精装带家具', '2026-09-01'],
    ])
    const req = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=listings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'listings.xlsx', size: buf.length },
    })
    const res = (await preflight.handler(req)) as Response
    expect(res.status).toBe(200)
    const body = await readJson(res)
    const report = body.report as { validCount: number; errorCount: number }
    expect(report.validCount).toBe(1)
    expect(report.errorCount).toBe(0)
  })

  it('listings 分支：批内房源编号重复 → 查重用列名 "房源编号"，不是 "楼盘编号"', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const { payload } = makeMockPayload([ROLE_ADM])

    const row = ['L-DUP', '环球金融中心 280㎡ 精装办公室', '传统办公室', 'B-EXIST', '280㎡', '4.5元/㎡/天', '12层', '精装带家具', '2026-09-01']
    const buf = await makeXlsxBuffer(LISTING_COLUMNS, [row, row])
    const req = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=listings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'listings.xlsx', size: buf.length },
    })
    const res = (await preflight.handler(req)) as Response
    const body = await readJson(res)
    const report = body.report as { validCount: number; errorCount: number; rowErrors: Array<{ code: string; column: string }> }
    expect(report.validCount).toBe(1)
    expect(report.errorCount).toBe(1)
    expect(report.rowErrors[0].code).toBe('DUPLICATE_EXTERNAL_ID')
    expect(report.rowErrors[0].column).toBe('房源编号')
  })

  it('D10：楼盘没有生效商户关系 → 预检阶段就判错误行，不是等写入才失败', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const { payload } = makeMockPayload([ROLE_ADM], [])

    const buf = await makeXlsxBuffer(LISTING_COLUMNS, [
      ['L-NOMERCHANT', '环球金融中心 280㎡ 精装办公室', '传统办公室', 'B-EXIST', '280㎡', '4.5元/㎡/天', '12层', '精装带家具', '2026-09-01'],
    ])
    const req = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=listings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'listings.xlsx', size: buf.length },
    })
    const res = (await preflight.handler(req)) as Response
    const body = await readJson(res)
    const report = body.report as { validCount: number; errorCount: number; rowErrors: Array<{ code: string; message: string }> }
    expect(report.validCount).toBe(0)
    expect(report.errorCount).toBe(1)
    expect(report.rowErrors[0].code).toBe('NO_SUPPLY_MERCHANT_RELATION')
    expect(report.rowErrors[0].message).toContain('楼盘「环球金融中心」')
  })

  it('D10：楼盘当前生效商户已停用 → 预检阶段判错误行，message 点出商户不合格', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const disabledRelation = { ...RELATION_ACTIVE, merchant: { ...MERCHANT_ACTIVE, status: 'disabled' } }
    const { payload } = makeMockPayload([ROLE_ADM], [disabledRelation])

    const buf = await makeXlsxBuffer(LISTING_COLUMNS, [
      ['L-DISABLED', '环球金融中心 280㎡ 精装办公室', '传统办公室', 'B-EXIST', '280㎡', '4.5元/㎡/天', '12层', '精装带家具', '2026-09-01'],
    ])
    const req = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=listings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'listings.xlsx', size: buf.length },
    })
    const res = (await preflight.handler(req)) as Response
    const body = await readJson(res)
    const report = body.report as { validCount: number; errorCount: number; rowErrors: Array<{ code: string; message: string }> }
    expect(report.validCount).toBe(0)
    expect(report.errorCount).toBe(1)
    expect(report.rowErrors[0].code).toBe('MERCHANT_INELIGIBLE')
    expect(report.rowErrors[0].message).toContain('已停用')
  })

  it('楼盘导入不查商户关系——建候选表时不该为楼盘导入多打一次无谓查询', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const { payload } = makeMockPayload([ROLE_ADM], [])
    payload.find.mockClear()

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-002', '新楼盘二', '上海', '浦东新区', '', '', '', ''],
    ])
    const req = makeReq({
      user: adminUser(),
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=buildings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
    })
    const res = (await preflight.handler(req)) as Response
    expect(res.status).toBe(200)
    const calledCollections = payload.find.mock.calls.map((call) => (call[0] as { collection: string }).collection)
    expect(calledCollections).not.toContain('building-merchant-relations')
  })
})

// ────────────────────────────────────────────────────────────
// execute：语义 3（复核城市范围）+ 语义 4（409）
// ────────────────────────────────────────────────────────────

describe('POST /bulk-import/batches/:id/execute', () => {
  async function preflightBuildingBatch(payload: MockPayload, user: User): Promise<number> {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-001', '新楼盘', '上海', '浦东新区', '', '', '', ''],
    ])
    const req = makeReq({
      user,
      payload,
      url: 'http://localhost/api/bulk-import/preflight?type=buildings',
      file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
    })
    const res = (await preflight.handler(req)) as Response
    const body = await readJson(res)
    return body.batchId as number
  }

  it('status !== preflight → 409，防止重复点击重复入队，并写 writeAuditFailed 留痕', async () => {
    const endpoints = createBulkImportEndpoints()
    const execute = endpoints.find((e) => e.path === '/bulk-import/batches/:id/execute')!
    const { payload, batches } = makeMockPayload([ROLE_ADM])
    const batchId = await preflightBuildingBatch(payload, adminUser())
    batches.set(batchId, { ...batches.get(batchId)!, status: 'queued' })

    const req = makeReq({ user: adminUser(), payload, routeParams: { id: String(batchId) } })
    const res = (await execute.handler(req)) as Response
    expect(res.status).toBe(409)
    expect((await readJson(res)).code).toBe('BAD_STATE')
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'audit-logs',
        data: expect.objectContaining({ action: 'data.import', result: 'failed', errorCode: 'BAD_STATE' }),
      }),
    )
  })

  it('同一操作者的城市范围被预检后收窄 → execute 复核发现越权行 → 403 CITY_OUT_OF_SCOPE，不入队，并写审计', async () => {
    const endpoints = createBulkImportEndpoints()
    const execute = endpoints.find((e) => e.path === '/bulk-import/batches/:id/execute')!
    const { payload } = makeMockPayload([ROLE_OPS_SHANGHAI])
    // 同一个人（id 901）先以「上海范围」预检出一条上海楼盘行（cityId=10）
    const opsBefore = opsUser(901, [10])
    const batchId = await preflightBuildingBatch(payload, opsBefore)

    // execute 时同一个人（id 901 不变，模拟操作者归属不变）的账号 cityScope 被
    // 后台改成了北京——这是"预检与执行之间用户角色可能已变更"的真实场景，
    // 不是换了另一个人（换人属于 Important 1 的归属越权，另有专门用例）。
    const opsAfterNarrowed = opsUser(901, [11])

    const req = makeReq({ user: opsAfterNarrowed, payload, routeParams: { id: String(batchId) } })
    const res = (await execute.handler(req)) as Response
    expect(res.status).toBe(403)
    const body = await readJson(res)
    expect(body.code).toBe('CITY_OUT_OF_SCOPE')
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'audit-logs',
        data: expect.objectContaining({ action: 'data.import', result: 'failed', errorCode: 'CITY_OUT_OF_SCOPE' }),
      }),
    )
  })

  it('非本人创建的批次 → execute 返回 403 FORBIDDEN（不是 CITY_OUT_OF_SCOPE），并写审计', async () => {
    const endpoints = createBulkImportEndpoints()
    const execute = endpoints.find((e) => e.path === '/bulk-import/batches/:id/execute')!
    const { payload } = makeMockPayload([ROLE_OPS_SHANGHAI])
    // 操作者 A（901）预检出一条上海行
    const batchId = await preflightBuildingBatch(payload, opsUser(901, [10]))

    // 操作者 B（905）同样持 data:import 且城市范围同为上海（不是城市越权），
    // 但不是这条批次的创建者 → 应该被归属校验挡住，而不是被城市校验放行。
    const otherOperator = opsUser(905, [10])
    const req = makeReq({ user: otherOperator, payload, routeParams: { id: String(batchId) } })
    const res = (await execute.handler(req)) as Response
    expect(res.status).toBe(403)
    const body = await readJson(res)
    expect(body.code).toBe('FORBIDDEN')
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'audit-logs',
        data: expect.objectContaining({ action: 'data.import', result: 'failed', errorCode: 'FORBIDDEN' }),
      }),
    )
  })

  it('validRows 结构损坏（非法元素）→ 409 CORRUPTED_BATCH，不当空数组放行绕过城市复核', async () => {
    const endpoints = createBulkImportEndpoints()
    const execute = endpoints.find((e) => e.path === '/bulk-import/batches/:id/execute')!
    const { payload, batches } = makeMockPayload([ROLE_ADM])
    const batchId = await preflightBuildingBatch(payload, adminUser())
    // 直接把持久化的 validRows 改坏：裸数字 / 空对象都不满足 PersistedValidRow 结构
    batches.set(batchId, { ...batches.get(batchId)!, validRows: [1, {}, 'x'] })

    const req = makeReq({ user: adminUser(), payload, routeParams: { id: String(batchId) } })
    const res = (await execute.handler(req)) as Response
    expect(res.status).toBe(409)
    expect((await readJson(res)).code).toBe('CORRUPTED_BATCH')
  })

  it('权限与城市范围都通过 → 200，status 变为 queued，写入审计，调用 queueImportJob 注入点', async () => {
    const { payload, batches } = makeMockPayload([ROLE_ADM])
    const batchId = await preflightBuildingBatch(payload, adminUser())

    const queueImportJob = vi.fn(async () => {})
    const endpoints = createBulkImportEndpoints({ queueImportJob })
    const execute = endpoints.find((e) => e.path === '/bulk-import/batches/:id/execute')!

    const req = makeReq({ user: adminUser(), payload, routeParams: { id: String(batchId) } })
    const res = (await execute.handler(req)) as Response
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body.status).toBe('queued')
    expect(batches.get(batchId)!.status).toBe('queued')
    expect(queueImportJob).toHaveBeenCalledWith(batchId)
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'audit-logs',
        data: expect.objectContaining({ action: 'data.import', result: 'success' }),
      }),
    )
  })

  it('批次不存在 → 404', async () => {
    const endpoints = createBulkImportEndpoints()
    const execute = endpoints.find((e) => e.path === '/bulk-import/batches/:id/execute')!
    const { payload } = makeMockPayload([ROLE_ADM])
    const req = makeReq({ user: adminUser(), payload, routeParams: { id: '9999' } })
    const res = (await execute.handler(req)) as Response
    expect(res.status).toBe(404)
  })
})

// ────────────────────────────────────────────────────────────
// POST /bulk-import/batches/:id/rollback（Task 9）
//
// 归属校验与 execute 复用同一道「本人 or 全局」判据（isBatchVisibleTo），
// 下面只补两条 mock 层能覆盖到的场景；状态迁移本身（下架而非删除、幂等、
// 文档仍然存在）由 tests/supply-import-rollback-postgres.test.ts 真库覆盖——
// 这里的 mock payload 对 buildings/listings 的 findByID/update 没有实现，
// 用 affectedIds 为空的批次（预检阶段就是这样）绕开，只验证权限守卫 + 审计。
// ────────────────────────────────────────────────────────────

describe('POST /bulk-import/batches/:id/rollback', () => {
  it('非本人创建的批次 → rollback 返回 403 FORBIDDEN，并写审计', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const rollback = endpoints.find((e) => e.path === '/bulk-import/batches/:id/rollback')!
    const { payload } = makeMockPayload([ROLE_OPS_SHANGHAI])

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-001', '新楼盘', '上海', '浦东新区', '', '', '', ''],
    ])
    const preflightRes = (await preflight.handler(
      makeReq({
        user: opsUser(901, [10]),
        payload,
        url: 'http://localhost/api/bulk-import/preflight?type=buildings',
        file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
      }),
    )) as Response
    const batchId = (await readJson(preflightRes)).batchId as number

    // 另一个持 data:import 权限、同城市范围的用户，不是这条批次的创建者
    const res = (await rollback.handler(
      makeReq({ user: opsUser(905, [10]), payload, routeParams: { id: String(batchId) } }),
    )) as Response
    expect(res.status).toBe(403)
    const body = await readJson(res)
    expect(body.code).toBe('FORBIDDEN')
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'audit-logs',
        data: expect.objectContaining({ action: 'data.import', result: 'failed', errorCode: 'FORBIDDEN' }),
      }),
    )
  })

  it('批次不存在 → 404', async () => {
    const endpoints = createBulkImportEndpoints()
    const rollback = endpoints.find((e) => e.path === '/bulk-import/batches/:id/rollback')!
    const { payload } = makeMockPayload([ROLE_ADM])
    const req = makeReq({ user: adminUser(), payload, routeParams: { id: '9999' } })
    const res = (await rollback.handler(req)) as Response
    expect(res.status).toBe(404)
  })

  it('全局范围操作者可回滚非本人批次；affectedIds 为空时 unpublished/skipped 都是 0，并写成功审计', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const rollback = endpoints.find((e) => e.path === '/bulk-import/batches/:id/rollback')!
    const { payload } = makeMockPayload([ROLE_OPS_SHANGHAI, ROLE_ADM])

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-001', '新楼盘', '上海', '浦东新区', '', '', '', ''],
    ])
    const preflightRes = (await preflight.handler(
      makeReq({
        user: opsUser(901, [10]),
        payload,
        url: 'http://localhost/api/bulk-import/preflight?type=buildings',
        file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
      }),
    )) as Response
    const batchId = (await readJson(preflightRes)).batchId as number

    const res = (await rollback.handler(
      makeReq({ user: adminUser(), payload, routeParams: { id: String(batchId) } }),
    )) as Response
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body).toMatchObject({ ok: true, unpublished: 0, skipped: 0, failed: 0 })
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'audit-logs',
        data: expect.objectContaining({
          action: 'data.import',
          result: 'success',
          after: { rollback: true, unpublished: 0 },
        }),
      }),
    )
  })

  it('评审 Important：rollbackImportBatch 抛出意料之外的异常时，返回结构化错误而不是裸 500，并写失败审计', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const rollback = endpoints.find((e) => e.path === '/bulk-import/batches/:id/rollback')!
    const { payload } = makeMockPayload([ROLE_ADM])

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-001', '新楼盘', '上海', '浦东新区', '', '', '', ''],
    ])
    const preflightRes = (await preflight.handler(
      makeReq({
        user: adminUser(),
        payload,
        url: 'http://localhost/api/bulk-import/preflight?type=buildings',
        file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
      }),
    )) as Response
    const batchId = (await readJson(preflightRes)).batchId as number

    // 端点自己为归属校验做的第一次 findByID 必须成功（拿到真实批次）；
    // rollbackImportBatch 内部紧接着做的第二次 findByID（同一批次）改为抛出，
    // 模拟"两次查询之间发生了意料之外的问题"——验证端点这一层有兜底，
    // 不是让异常冒成裸 500、把"这次回滚到底有没有部分生效"这个事实吞掉。
    const originalFindByID = payload.findByID as (opts: {
      collection: string
      id: number | string
    }) => Promise<unknown>
    let batchLookupCount = 0
    payload.findByID = vi.fn(async (opts: { collection: string; id: number | string }) => {
      if (opts.collection === 'supply-import-batches' && Number(opts.id) === batchId) {
        batchLookupCount += 1
        if (batchLookupCount >= 2) throw new Error('模拟的数据库瞬时故障')
      }
      return originalFindByID(opts)
    })

    const res = (await rollback.handler(
      makeReq({ user: adminUser(), payload, routeParams: { id: String(batchId) } }),
    )) as Response
    expect(res.status).toBe(500)
    const body = await readJson(res)
    expect(body.ok).toBe(false)
    expect(body.code).toBe('ROLLBACK_FAILED')
    expect(payload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'audit-logs',
        data: expect.objectContaining({ action: 'data.import', result: 'failed', errorCode: 'ROLLBACK_FAILED' }),
      }),
    )
  })

  it('D11：真的下架了文档（unpublished > 0）→ 触发一次公共缓存失效', async () => {
    revalidateTag.mockClear()
    const endpoints = createBulkImportEndpoints()
    const rollback = endpoints.find((e) => e.path === '/bulk-import/batches/:id/rollback')!
    const { payload, batches, listings } = makeMockPayload([ROLE_ADM])

    listings.set(123, { id: 123, publicationStatus: 'published' })
    // 直接造批次记录（绕开 payload.create 这个宽松类型的 mock，避免和它的调用签名
    // 纠缠）——本用例只关心 rollback handler 拿到这条批次后的行为。
    const batchId = 501
    batches.set(batchId, {
      id: batchId,
      type: 'listings',
      status: 'completed',
      operator: 900,
      affectedIds: [123],
      validRows: [{ rowNumber: 2, externalId: 'L-001', cityId: 10 }],
      stats: { processed: 1, created: 1, updated: 0, failed: 0 },
    })

    const res = (await rollback.handler(
      makeReq({ user: adminUser(), payload, routeParams: { id: String(batchId) } }),
    )) as Response
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body).toMatchObject({ ok: true, unpublished: 1 })
    expect(listings.get(123)?.publicationStatus).toBe('unpublished')

    // 核心断言：revalidateTag 真的被调过——不是只把 unpublished 数字改对，
    // 前台缓存也要被失效，止血承诺才成立。
    expect(revalidateTag).toHaveBeenCalled()
  })

  it('D11：unpublished === 0（纯幂等空操作）→ 不触发缓存失效，没有可刷新的内容', async () => {
    revalidateTag.mockClear()
    const endpoints = createBulkImportEndpoints()
    const rollback = endpoints.find((e) => e.path === '/bulk-import/batches/:id/rollback')!
    const { payload, batches } = makeMockPayload([ROLE_ADM])

    const batchId = 502
    batches.set(batchId, {
      id: batchId,
      type: 'listings',
      status: 'completed',
      operator: 900,
      affectedIds: [],
      stats: { processed: 0, created: 0, updated: 0, failed: 0 },
    })

    const res = (await rollback.handler(
      makeReq({ user: adminUser(), payload, routeParams: { id: String(batchId) } }),
    )) as Response
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body).toMatchObject({ ok: true, unpublished: 0 })
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────
// GET 状态轮询
// ────────────────────────────────────────────────────────────

describe('GET /bulk-import/batches/:id', () => {
  it('返回状态与统计', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const status = endpoints.find((e) => e.path === '/bulk-import/batches/:id')!
    const { payload } = makeMockPayload([ROLE_ADM])

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-001', '新楼盘', '上海', '浦东新区', '', '', '', ''],
    ])
    const preflightRes = (await preflight.handler(
      makeReq({
        user: adminUser(),
        payload,
        url: 'http://localhost/api/bulk-import/preflight?type=buildings',
        file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
      }),
    )) as Response
    const batchId = (await readJson(preflightRes)).batchId as number

    const res = (await status.handler(
      makeReq({ user: adminUser(), payload, routeParams: { id: String(batchId) } }),
    )) as Response
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect((body.batch as { status: string }).status).toBe('preflight')
    expect((body.batch as { validCount: number }).validCount).toBe(1)
  })

  it('横向越权：非本人、非全局范围的用户读别人的批次状态 → 403 FORBIDDEN', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const status = endpoints.find((e) => e.path === '/bulk-import/batches/:id')!
    const { payload } = makeMockPayload([ROLE_OPS_SHANGHAI])

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [
      ['BLD-001', '新楼盘', '上海', '浦东新区', '', '', '', ''],
    ])
    const preflightRes = (await preflight.handler(
      makeReq({
        user: opsUser(901, [10]),
        payload,
        url: 'http://localhost/api/bulk-import/preflight?type=buildings',
        file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
      }),
    )) as Response
    const batchId = (await readJson(preflightRes)).batchId as number

    // 另一个持 data:import 权限、同城市范围的用户，不是这条批次的创建者
    const res = (await status.handler(
      makeReq({ user: opsUser(905, [10]), payload, routeParams: { id: String(batchId) } }),
    )) as Response
    expect(res.status).toBe(403)
    expect((await readJson(res)).code).toBe('FORBIDDEN')
  })
})

// ────────────────────────────────────────────────────────────
// 下载三件套
// ────────────────────────────────────────────────────────────

describe('下载端点', () => {
  it('GET /bulk-import/template?type=buildings 返回只有表头的 xlsx', async () => {
    const endpoints = createBulkImportEndpoints()
    const template = endpoints.find((e) => e.path === '/bulk-import/template')!
    const { payload } = makeMockPayload([ROLE_ADM])
    const res = (await template.handler(
      makeReq({ user: adminUser(), payload, url: 'http://localhost/api/bulk-import/template?type=buildings' }),
    )) as Response
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml')

    const arrayBuf = await res.arrayBuffer()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(arrayBuf))
    const ws = wb.worksheets[0]
    expect(ws.rowCount).toBe(1)
  })

  it('GET /bulk-import/template?type=bogus → 400 BAD_TYPE', async () => {
    const endpoints = createBulkImportEndpoints()
    const template = endpoints.find((e) => e.path === '/bulk-import/template')!
    const { payload } = makeMockPayload([ROLE_ADM])
    const res = (await template.handler(
      makeReq({ user: adminUser(), payload, url: 'http://localhost/api/bulk-import/template?type=bogus' }),
    )) as Response
    expect(res.status).toBe(400)
  })

  it('GET /bulk-import/batches/:id/errors 返回带错误原因列的 xlsx，可回填原表数据', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const errors = endpoints.find((e) => e.path === '/bulk-import/batches/:id/errors')!
    const { payload } = makeMockPayload([ROLE_ADM])

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [['', '缺编号的楼盘', '上海', '浦东新区', '', '', '', '']])
    const preflightRes = (await preflight.handler(
      makeReq({
        user: adminUser(),
        payload,
        url: 'http://localhost/api/bulk-import/preflight?type=buildings',
        file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
      }),
    )) as Response
    const batchId = (await readJson(preflightRes)).batchId as number

    const res = (await errors.handler(
      makeReq({ user: adminUser(), payload, routeParams: { id: String(batchId) } }),
    )) as Response
    expect(res.status).toBe(200)
    const arrayBuf = await res.arrayBuffer()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(arrayBuf))
    const ws = wb.worksheets[0]
    // 表头 + 1 条错误行
    expect(ws.rowCount).toBe(2)
    const headerRow = ws.getRow(1).values as unknown[]
    expect(headerRow).toContain('错误原因')
    // 原表其它列（楼盘名称）要保留，供运营回填后重新上传
    const dataRow = ws.getRow(2).values as unknown[]
    expect(dataRow).toContain('缺编号的楼盘')
  })

  it('横向越权：非本人、非全局范围的用户下载别人的错误表 → 403 FORBIDDEN', async () => {
    const endpoints = createBulkImportEndpoints()
    const preflight = endpoints.find((e) => e.path === '/bulk-import/preflight')!
    const errors = endpoints.find((e) => e.path === '/bulk-import/batches/:id/errors')!
    const { payload } = makeMockPayload([ROLE_OPS_SHANGHAI])

    const buf = await makeXlsxBuffer(BUILDING_COLUMNS, [['', '缺编号的楼盘', '上海', '浦东新区', '', '', '', '']])
    const preflightRes = (await preflight.handler(
      makeReq({
        user: opsUser(901, [10]),
        payload,
        url: 'http://localhost/api/bulk-import/preflight?type=buildings',
        file: { data: buf, mimetype: 'application/vnd.ms-excel', name: 'buildings.xlsx', size: buf.length },
      }),
    )) as Response
    const batchId = (await readJson(preflightRes)).batchId as number

    const res = (await errors.handler(
      makeReq({ user: opsUser(905, [10]), payload, routeParams: { id: String(batchId) } }),
    )) as Response
    expect(res.status).toBe(403)
    expect((await readJson(res)).code).toBe('FORBIDDEN')
  })

  it('GET /bulk-import/building-reference 按 ctx.cityIds 收窄查询', async () => {
    const endpoints = createBulkImportEndpoints()
    const reference = endpoints.find((e) => e.path === '/bulk-import/building-reference')!
    const { payload } = makeMockPayload([ROLE_OPS_SHANGHAI])

    const res = (await reference.handler(
      makeReq({ user: opsUserShanghai(), payload, url: 'http://localhost/api/bulk-import/building-reference' }),
    )) as Response
    expect(res.status).toBe(200)
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'buildings', where: { city: { in: [10] } } }),
    )
  })
})
