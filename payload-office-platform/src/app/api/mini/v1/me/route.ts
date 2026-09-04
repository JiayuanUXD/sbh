import { getPayload } from 'payload'
import { NextResponse } from 'next/server'

import config from '@/payload.config'
import {
  createPayloadMiniUserAssetStore,
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

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function response(body: unknown, status: number, requestId: string): Response {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': MINI_CACHE_CONTROL,
      'X-Request-Id': requestId,
    },
  })
}

export async function GET(request: Request): Promise<Response> {
  const bearer = verifyMiniBearer(request)
  if (!bearer.ok) return bearer.response
  const requestId = miniRequestId()

  try {
    const payload = await getPayload({ config })
    const assets = await createPayloadMiniUserAssetStore(payload).findBySubject(bearer.subject)
    const context = createSearchContext('shanghai')
    const data = await projectMiniMeData(assets, {
      mediaOrigin: getSiteConfig().siteOrigin,
      resolveListing: (slug) => assertEffectiveListing(slug, context),
      resolveBuilding: (slug) => assertEffectiveBuilding(slug, context),
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
