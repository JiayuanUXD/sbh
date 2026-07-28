import type { Endpoint } from 'payload'

import {
  collectAdminNavigationBadges,
} from '@/domain/admin-navigation/navigation-badges'
import type { AdminNavigationBadgeKey } from '@/domain/admin-navigation/navigation-types'
import {
  requireAdminContext,
  type RequestContext,
} from '@/domain/auth/access'

export type AdminNavigationResponse =
  | {
      ok: true
      badges: Partial<Record<AdminNavigationBadgeKey, number>>
      asOf: string
    }
  | { ok: false; error: string }

export function createAdminNavigationEndpoint(): Endpoint {
  return {
    path: '/admin-navigation',
    method: 'get',
    handler: async (req) => {
      let permission
      try {
        permission = await requireAdminContext(req as RequestContext)
      } catch (caught) {
        const error = caught instanceof Error ? caught.message : '未登录'
        return Response.json(
          { ok: false, error } satisfies AdminNavigationResponse,
          { status: 401 },
        )
      }

      const asOf = new Date()
      const badges = await collectAdminNavigationBadges({
        permission,
        asOf,
        count: async (query) => {
          const result = await req.payload.count({
            collection: query.collection,
            where: query.where,
            req,
            overrideAccess: false,
          })
          return result.totalDocs
        },
        onError: (key, error) => {
          req.payload.logger?.error?.(
            `[admin-navigation] ${key} badge count failed: ${error.message}`,
          )
        },
      })

      return Response.json({
        ok: true,
        badges,
        asOf: asOf.toISOString(),
      } satisfies AdminNavigationResponse)
    },
  }
}
