import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/api/health` 是部署冒烟与 CloudRun 探针共用的端点。2026-10-13 池满故障里，
 * 它原先的 `find({ collection: 'users', limit: 0 })`（drizzle 把 limit 0 当成不限，
 * 每次探活都读整张用户表）和页面查询抢同一个池子，冒烟一次 15s 超时就判发布失败。
 * 这里钉住：探活只做 `select 1`，不碰业务表；查库失败如实报 503。
 */

const poolQueryMock = vi.fn()
const findMock = vi.fn()
const getPayloadMock = vi.fn()

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, getPayload: (...args: unknown[]) => getPayloadMock(...args) }
})
vi.mock('@/payload.config', () => ({ default: {} }))

import { GET } from '@/app/api/health/route'

describe('/api/health 轻量探活', () => {
  beforeEach(() => {
    poolQueryMock.mockReset()
    findMock.mockReset()
    getPayloadMock.mockReset()
    getPayloadMock.mockResolvedValue({ db: { pool: { query: poolQueryMock } }, find: findMock })
  })

  it('只执行 select 1，不查询任何业务集合', async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] })

    const res = await GET()
    const body = (await res.json()) as { status: string; checks: Record<string, string> }

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.checks).toEqual({ payload: 'ok', db: 'ok' })
    expect(poolQueryMock).toHaveBeenCalledTimes(1)
    expect(poolQueryMock).toHaveBeenCalledWith('select 1')
    expect(findMock).not.toHaveBeenCalled()
  })

  it('查库失败（含池满等待超时）时返回 503 degraded', async () => {
    poolQueryMock.mockRejectedValue(new Error('timeout exceeded when trying to connect'))

    const res = await GET()
    const body = (await res.json()) as { status: string; checks: Record<string, string> }

    expect(res.status).toBe(503)
    expect(body.status).toBe('degraded')
    expect(body.checks.db).toBe('fail')
  })

  it('拿不到连接池时同样判 db fail，而不是假装健康', async () => {
    getPayloadMock.mockResolvedValue({ db: {}, find: findMock })

    const res = await GET()
    const body = (await res.json()) as { checks: Record<string, string> }

    expect(res.status).toBe(503)
    expect(body.checks.db).toBe('fail')
  })
})
