import { getPayload } from 'payload'
import { NextResponse } from 'next/server'

import config from '@/payload.config'
import {
  createPayloadMiniUserAssetStore,
  MINI_ME_FAVORITES_PAGE_LIMIT,
  MINI_ME_INQUIRIES_PAGE_LIMIT,
  projectMiniMeData,
  verifyMiniBearer,
} from '@/domain/mini-program/user-assets'
import {
  MINI_CACHE_CONTROL,
  miniError,
  miniRequestId,
  miniWriteOk,
} from '@/domain/mini-program/response'
import {
  assertEffectiveBuilding,
  assertEffectiveListing,
  createSearchContext,
} from '@/domain/public-catalog'
import { getSiteConfig } from '@/lib/frontend/site-config'
import { readMiniTrustedProxyRuntimeConfig } from '@/lib/mini-program/runtime-config'
import type { PoolLike } from '@/lib/rate-limit-pg'

import { resolveMiniTrustedClientIp, runMiniSubjectRateLimit } from '../rate-limit-state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function response(
  body: unknown,
  status: number,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': MINI_CACHE_CONTROL,
      'X-Request-Id': requestId,
      ...headers,
    },
  })
}

export async function GET(request: Request): Promise<Response> {
  const bearer = verifyMiniBearer(request)
  if (!bearer.ok) return bearer.response
  const requestId = miniRequestId()

  const proxyConfig = readMiniTrustedProxyRuntimeConfig()
  const client = proxyConfig.ok
    ? resolveMiniTrustedClientIp(request, proxyConfig.value.trustedProxyHops)
    : { ok: false as const }
  if (!client.ok) {
    return response(
      miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
      503,
      requestId,
    )
  }

  try {
    const payload = await getPayload({ config })
    const rate = await runMiniSubjectRateLimit(
      client.clientIp,
      bearer.subject,
      'mini-me-read',
      (payload.db as unknown as { pool: PoolLike }).pool,
    )
    if (!rate.allowed) {
      if (rate.storeFailed) {
        return response(
          miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
          503,
          requestId,
        )
      }
      return response(
        miniError('rate_limited', '请求过于频繁，请稍后重试', requestId),
        429,
        requestId,
        { 'Retry-After': String(rate.retryAfterSeconds) },
      )
    }
    const store = createPayloadMiniUserAssetStore(payload)
    const [favorites, inquiries] = await Promise.all([
      store.findBySubjectAndKinds(
        bearer.subject,
        ['favorite-listing', 'favorite-building'],
        MINI_ME_FAVORITES_PAGE_LIMIT,
      ),
      store.findBySubjectAndKinds(
        bearer.subject,
        ['inquiry'],
        MINI_ME_INQUIRIES_PAGE_LIMIT,
      ),
    ])
    const context = createSearchContext('shanghai')
    const data = await projectMiniMeData([...favorites.records, ...inquiries.records], {
      mediaOrigin: getSiteConfig().siteOrigin,
      resolveListing: (slug) => assertEffectiveListing(slug, context),
      resolveBuilding: (slug) => assertEffectiveBuilding(slug, context),
    }, {
      favorites: { limit: MINI_ME_FAVORITES_PAGE_LIMIT, hasMore: favorites.hasMore },
      inquiries: { limit: MINI_ME_INQUIRIES_PAGE_LIMIT, hasMore: inquiries.hasMore },
    })
    return response(miniWriteOk(data, requestId), 200, requestId)
  } catch {
    return response(
      miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
      503,
      requestId,
    )
  }
}
