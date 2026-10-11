import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  pending: vi.fn(),
  counts: vi.fn(),
  slice: vi.fn(),
}))
vi.mock('@/domain/auth/access', () => ({
  requireOperationPermission: mocks.permission,
}))
vi.mock('@/domain/supply-sync/source-sync-publish', () => ({
  pendingSourceSync: mocks.pending,
  sourcePublishCounts: mocks.counts,
  publishSourceSlice: mocks.slice,
}))
vi.mock('@/domain/supply-sync/source-sync-task', () => ({
  SOURCE_SYNC_QUEUE: 'source-sync',
  SOURCE_SYNC_TASK: 'run-source-sync',
}))
vi.mock('@/domain/supply-sync/source-sync-rollback', () => ({
  rollbackSourceSyncBatch: vi.fn(),
}))
import { createSourceSyncEndpoints } from '@/endpoints/source-sync-endpoint'

function request(body: unknown = { phase: 'buildings', afterId: 0 }) {
  return { json: async () => body } as PayloadRequest
}
function handler(method: 'get' | 'post') {
  return createSourceSyncEndpoints().find(
    (endpoint) => endpoint.path === '/source-sync/publish' && endpoint.method === method,
  )!.handler
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.permission.mockResolvedValue({
    roleCodes: ['ADM'],
    dataScope: 'global',
    cityIds: 'all',
  })
  mocks.pending.mockResolvedValue(false)
  mocks.counts.mockResolvedValue({ buildings: 2, listings: 3 })
  mocks.slice.mockResolvedValue({
    cursor: 10,
    processed: 2,
    published: 2,
    skipped: 0,
    errors: [],
    done: true,
  })
})
describe('采集发布入口', () => {
  it('预检返回草稿数量并要求完整发布权限', async () => {
    const response = (await handler('get')(request())) as Response
    expect(await response.json()).toEqual({
      ok: true,
      buildings: 2,
      listings: 3,
    })
    expect(mocks.permission.mock.calls.map((call) => call[1])).toEqual([
      'data:import',
      'building:update',
      'listing:update',
      'listing:review',
      'listing:publish',
    ])
  })
  it('有全局导入权限的运营仍不能触发管理员快捷发布', async () => {
    mocks.permission.mockResolvedValue({
      roleCodes: ['OPS'],
      dataScope: 'global',
      cityIds: 'all',
    })
    expect(((await handler('post')(request())) as Response).status).toBe(403)
    expect(mocks.slice).not.toHaveBeenCalled()
  })
  it('拒绝未完成同步和缺失发布权限', async () => {
    mocks.pending.mockResolvedValue(true)
    expect(((await handler('post')(request())) as Response).status).toBe(409)
    mocks.permission.mockRejectedValue(new Error('无权'))
    expect(((await handler('post')(request())) as Response).status).toBe(403)
    expect(mocks.slice).not.toHaveBeenCalled()
  })
  it.each([{ phase: 'retire' }, { phase: 'listings', afterId: -1 }, { phase: 'listings', afterId: '1' }])(
    '拒绝非法游标或阶段 %j',
    async (body) => {
      expect(((await handler('post')(request(body))) as Response).status).toBe(400)
      expect(mocks.slice).not.toHaveBeenCalled()
    },
  )
  it('按指定阶段与游标运行一段', async () => {
    const req = request({ phase: 'listings', afterId: 10 })
    expect(((await handler('post')(req)) as Response).status).toBe(200)
    expect(mocks.slice).toHaveBeenCalledWith(req, 'listings', 10)
  })
})
