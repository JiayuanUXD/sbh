import type { Endpoint } from 'payload'

import {
  collectAdminNavigationBadges,
} from '@/domain/admin-navigation/navigation-badges'
import type { AdminNavigationBadgeKey } from '@/domain/admin-navigation/navigation-types'
import {
  requireAdminContext,
  type RequestContext,
} from '@/domain/auth/access'
import { ForbiddenError } from '@/domain/shared/errors'

const AUTHENTICATION_ERROR_MESSAGE = '未登录或会话已失效'
const INTERNAL_ERROR_MESSAGE = '后台导航暂时不可用'

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
        if (caught instanceof ForbiddenError) {
          return Response.json(
            {
              ok: false,
              error: AUTHENTICATION_ERROR_MESSAGE,
            } satisfies AdminNavigationResponse,
            { status: 401 },
          )
        }

        const message =
          caught instanceof Error
            ? `${caught.name}: ${caught.message}`
            : String(caught)
        req.payload.logger?.error?.(
          `[admin-navigation] permission context failed: ${message}`,
        )
        return Response.json(
          {
            ok: false,
            error: INTERNAL_ERROR_MESSAGE,
          } satisfies AdminNavigationResponse,
          { status: 500 },
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
