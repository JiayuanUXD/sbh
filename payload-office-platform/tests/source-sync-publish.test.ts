import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

const io = vi.hoisted(() => ({
  createReq: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  audit: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('payload', () => ({
  createLocalReq: io.createReq,
  initTransaction: io.begin,
  commitTransaction: io.commit,
  killTransaction: io.rollback,
}))
vi.mock('@/domain/audit/with-audit', () => ({ withAudit: io.audit }))
vi.mock('@/domain/supply-import/cache-invalidation', () => ({
  invalidateSupplyImportCache: io.invalidate,
}))
import { publishSourceSlice, sourcePublishWhere } from '@/domain/supply-sync/source-sync-publish'

const building = {
  id: 1,
  version: 1,
  status: 'published',
  operationalStatus: 'active',
  city: { id: 1, status: 'active' },
  district: { status: 'active' },
}
const listing = {
  id: 2,
  version: 1,
  publicationStatus: 'draft',
  reviewStatus: 'not_submitted',
  supplyVisibilityHold: 'normal',
  building,
  merchant: {
    id: 1,
    status: 'active',
    qualificationStatus: 'valid',
    serviceCities: [1],
  },
}
function fixture(docs: unknown[], current: unknown[]) {
  const find = vi.fn().mockResolvedValueOnce({ docs, hasNextPage: false })
  for (const doc of current) find.mockResolvedValueOnce({ docs: [doc] })
  const update = vi.fn(async () => ({
    publicationStatus: 'published',
    reviewStatus: 'approved',
  }))
  const count = vi.fn(async () => ({ totalDocs: 0 }))
  const payload = { find, update, count }
  return {
    req: { payload, user: { id: 1 } } as unknown as PayloadRequest,
    find,
    update,
    count,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  io.createReq.mockImplementation(async (_options, payload) => ({
    payload,
    context: {},
  }))
  io.begin.mockImplementation(async (req) => {
    req.transactionID = 'tx'
    return true
  })
  io.commit.mockResolvedValue(undefined)
  io.rollback.mockResolvedValue(undefined)
  io.audit.mockImplementation(async ({ fn }) => (await fn()).data)
})
describe('采集发布分段', () => {
  it('只扫描来源相符且正常未审核草稿', () => {
    expect(sourcePublishWhere('listings', 7)).toEqual({
      and: [
        { 'dataSource.source': { equals: 'huizuxuanzhi' } },
        { deletedAt: { exists: false } },
        { id: { greater_than: 7 } },
        { publicationStatus: { equals: 'draft' } },
        { reviewStatus: { equals: 'not_submitted' } },
        { supplyVisibilityHold: { equals: 'normal' } },
      ],
    })
  })
  it('楼盘审计失败回滚，后续对象使用独立请求仍能发布', async () => {
    const f = fixture(
      [{ id: 1 }, { id: 3 }],
      [
        { ...building, status: 'draft' },
        { ...building, id: 3, status: 'draft' },
      ],
    )
    io.audit.mockRejectedValueOnce(new Error('审计失败'))
    const result = await publishSourceSlice(f.req, 'buildings', 0)
    expect(result).toMatchObject({
      cursor: 3,
      processed: 2,
      published: 1,
      errors: [{ id: 1, message: '审计失败' }],
      done: true,
    })
    expect(io.rollback).toHaveBeenCalledOnce()
    expect(io.commit).toHaveBeenCalledOnce()
    expect(io.createReq.mock.results[0].value).not.toBe(io.createReq.mock.results[1].value)
    expect(io.invalidate).toHaveBeenCalledOnce()
  })
  it('举报暂停阻止房源写入', async () => {
    const f = fixture([{ id: 2 }], [listing])
    f.count.mockResolvedValue({ totalDocs: 1 })
    const result = await publishSourceSlice(f.req, 'listings', 0)
    expect(result.published).toBe(0)
    expect(f.update).not.toHaveBeenCalled()
    expect(result.errors[0]?.message).toBe('房源存在有效举报暂停')
  })
  it('有效房源沿用管理员保存钩子，不在服务内直接改写审核轴', async () => {
    const f = fixture([{ id: 2 }], [listing])
    const result = await publishSourceSlice(f.req, 'listings', 0)
    expect(result).toMatchObject({ published: 1, errors: [], done: true })
    expect(f.update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'listings',
        data: { version: 1 },
        overrideAccess: false,
      }),
    )
    expect(io.commit).toHaveBeenCalledOnce()
  })
  it('停用楼盘与缺失商户均 fail closed', async () => {
    const f = fixture(
      [{ id: 2 }, { id: 3 }],
      [
        {
          ...listing,
          building: { ...building, operationalStatus: 'inactive' },
        },
        { ...listing, id: 3, merchant: null },
      ],
    )
    const result = await publishSourceSlice(f.req, 'listings', 0)
    expect(result.errors).toHaveLength(2)
    expect(f.update).not.toHaveBeenCalled()
  })
  it('提交失败不计入已发布', async () => {
    const f = fixture([{ id: 1 }], [{ ...building, status: 'draft' }])
    io.commit.mockRejectedValueOnce(new Error('提交失败'))
    expect((await publishSourceSlice(f.req, 'buildings', 0)).published).toBe(0)
    expect(io.invalidate).not.toHaveBeenCalled()
  })
  it('并发上限为四个对象，预算耗尽后游标停在完整组末尾且仅失效一次缓存', async () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
    }))
    const f = fixture(
      candidates,
      candidates.map(({ id }) => ({ ...building, id, status: 'draft' })),
    )
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(21_000)
    try {
      const result = await publishSourceSlice(f.req, 'buildings', 0)
      expect(result).toMatchObject({
        cursor: 4,
        processed: 4,
        published: 4,
        errors: [],
        done: false,
      })
      expect(io.createReq).toHaveBeenCalledTimes(4)
      expect(io.commit).toHaveBeenCalledTimes(4)
      expect(io.invalidate).toHaveBeenCalledOnce()
    } finally {
      clock.mockRestore()
    }
  })
})
