import type { BasePayload, Endpoint, PayloadRequest, Where } from 'payload'

import {
  resolveDashboardStats,
  type DashboardStatsPayloadPort,
} from '@/domain/analytics/dashboard-stats'
import { requireAdminContext, type RequestContext } from '@/domain/auth/access'
import { ForbiddenError } from '@/domain/shared/errors'

const AUTHENTICATION_ERROR_MESSAGE = '未登录或会话已失效'
const INTERNAL_ERROR_MESSAGE = '运营数据暂时不可用'

const COUNT_COLLECTIONS = [
  'listings',
  'buildings',
  'leads',
  'listing-reports',
  'supply-submissions',
] as const
const FIND_COLLECTIONS = [
  ...COUNT_COLLECTIONS,
] as const

type CountCollection = (typeof COUNT_COLLECTIONS)[number]
type FindCollection = (typeof FIND_COLLECTIONS)[number]

function isCountCollection(collection: string): collection is CountCollection {
  return COUNT_COLLECTIONS.some((candidate) => candidate === collection)
}

function toCountCollection(collection: string): CountCollection {
  if (isCountCollection(collection)) return collection
  throw new Error(`dashboard-stats does not support counting collection: ${collection}`)
}

function isFindCollection(collection: string): collection is FindCollection {
  return FIND_COLLECTIONS.some((candidate) => candidate === collection)
}

function toFindCollection(collection: string): FindCollection {
  if (isFindCollection(collection)) return collection
  throw new Error(`dashboard-stats does not support finding collection: ${collection}`)
}

function toPayloadWhere(where: Record<string, unknown>): Where {
  if (typeof where !== 'object' || where === null || Array.isArray(where)) {
    throw new TypeError('dashboard-stats query must be a where object')
  }
  return where as Where
}

function isPayloadRequest(value: unknown): value is PayloadRequest {
  return typeof value === 'object' && value !== null && 'payload' in value
}

function requestOption(req: unknown): { req?: PayloadRequest } {
  if (req === undefined) return {}
  if (!isPayloadRequest(req)) {
    throw new TypeError('dashboard-stats requires a Payload request context')
  }
  return { req }
}

function queryDocuments(docs: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(docs)) throw new TypeError('dashboard-stats query returned invalid documents')

  const records: Array<Record<string, unknown>> = []
  for (const doc of docs) {
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
      throw new TypeError('dashboard-stats query returned a non-document value')
    }
    records.push(doc)
  }
  return records
}

/**
 * Bridges the broad domain query port to Payload's typed Local API.
 *
 * The domain service only emits the fixed collection/query shapes guarded
 * below. The adapter keeps Payload's collection generics at this boundary and
 * forwards the original request/access options without widening access.
 */
export function createDashboardStatsPayloadPort(
  payload: Pick<BasePayload, 'count' | 'find'>,
): DashboardStatsPayloadPort {
  return {
    async count({ collection, where, overrideAccess, req }) {
      return payload.count({
        collection: toCountCollection(collection),
        ...(where === undefined ? {} : { where: toPayloadWhere(where) }),
        overrideAccess,
        ...requestOption(req),
      })
    },
    async find({
      collection,
      where,
      depth,
      limit,
      page,
      pagination,
      select,
      sort,
      overrideAccess,
      req,
    }) {
      const result = await payload.find({
        collection: toFindCollection(collection),
        where: toPayloadWhere(where),
        depth,
        limit,
        page,
        pagination,
        ...(select === undefined ? {} : { select }),
        sort,
        overrideAccess,
        ...requestOption(req),
      })
      return {
        docs: queryDocuments(result.docs),
        hasNextPage: result.hasNextPage,
        nextPage: result.nextPage,
        page: result.page,
        totalPages: result.totalPages,
      }
    },
  }
}

export type DashboardStatsResponse =
  | { ok: true; stats: import('@/domain/analytics/dashboard-stats').DashboardStats }
  | { ok: false; error: string }

/** 统计结果按用户短缓存：概览是信息面板，60 秒陈旧可接受，换掉重复的重查询。 */
const STATS_CACHE_TTL_MS = 60_000
const STATS_CACHE_MAX_ENTRIES = 200

/** 仅登录用户可读取的非阻塞 Dashboard 统计接口（GET /api/dashboard-stats）。 */
export function createDashboardStatsEndpoint(): Endpoint {
  // 缓存放在闭包里：生产环境该工厂只在 payload.config 装配时调用一次（进程级缓存），
  // 单测每次新建端点即天然隔离。键按用户区分——计数携带 req 走 access，
  // 不同用户（数据范围不同）绝不能共享一份结果。
  const cache = new Map<string, { expiresAt: number; stats: unknown }>()

  return {
    path: '/dashboard-stats',
    method: 'get',
    handler: async (req) => {
      try {
        const ctx = await requireAdminContext(req as RequestContext)
        const cacheKey = String(ctx.userId)
        const cached = cache.get(cacheKey)
        if (cached && cached.expiresAt > Date.now()) {
          return Response.json({
            ok: true,
            stats: cached.stats,
          } as DashboardStatsResponse)
        }
        const stats = await resolveDashboardStats(
          createDashboardStatsPayloadPort(req.payload),
          req,
        )
        if (cache.size >= STATS_CACHE_MAX_ENTRIES) cache.clear()
        cache.set(cacheKey, { expiresAt: Date.now() + STATS_CACHE_TTL_MS, stats })
        return Response.json({ ok: true, stats } satisfies DashboardStatsResponse)
      } catch (caught) {
        if (caught instanceof ForbiddenError) {
          return Response.json(
            { ok: false, error: AUTHENTICATION_ERROR_MESSAGE } satisfies DashboardStatsResponse,
            { status: 401 },
          )
        }

        // Keep database/driver details out of both the response and logs. The
        // request-level logger still records the failed boundary for alerting.
        req.payload.logger?.error?.('[dashboard-stats] request failed')
        return Response.json(
          { ok: false, error: INTERNAL_ERROR_MESSAGE } satisfies DashboardStatsResponse,
          { status: 500 },
        )
      }
    },
  }
}
