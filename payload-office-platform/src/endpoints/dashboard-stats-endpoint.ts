import type { BasePayload, Endpoint, PayloadRequest, Where } from 'payload'

import {
  resolveDashboardStats,
  type DashboardStatsPayloadPort,
} from '@/domain/analytics/dashboard-stats'
import { requireAdminContext, type RequestContext } from '@/domain/auth/access'
import { ForbiddenError } from '@/domain/shared/errors'

const AUTHENTICATION_ERROR_MESSAGE = '未登录或会话已失效'
const INTERNAL_ERROR_MESSAGE = '运营数据暂时不可用'

const COUNT_COLLECTIONS = ['listings', 'buildings', 'leads'] as const
const FIND_COLLECTIONS = [
  ...COUNT_COLLECTIONS,
  'listing-reports',
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
    async find({ collection, where, depth, limit, page, pagination, sort, overrideAccess, req }) {
      const result = await payload.find({
        collection: toFindCollection(collection),
        where: toPayloadWhere(where),
        depth,
        limit,
        page,
        pagination,
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

/** 仅登录用户可读取的非阻塞 Dashboard 统计接口（GET /api/dashboard-stats）。 */
export function createDashboardStatsEndpoint(): Endpoint {
  return {
    path: '/dashboard-stats',
    method: 'get',
    handler: async (req) => {
      try {
        await requireAdminContext(req as RequestContext)
        const stats = await resolveDashboardStats(
          createDashboardStatsPayloadPort(req.payload),
          req,
        )
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
