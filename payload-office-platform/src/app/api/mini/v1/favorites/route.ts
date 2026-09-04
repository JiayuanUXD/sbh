import { getPayload } from 'payload'
import { NextResponse } from 'next/server'

import config from '@/payload.config'
import {
  createPayloadMiniUserAssetStore,
  removeFavorite,
  upsertFavorite,
  verifyMiniBearer,
  type MiniFavoriteTarget,
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

import { readBoundedJsonBody } from '../bounded-json-body'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 4 * 1024
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG_LENGTH = 160

function response(body: unknown, status: number, requestId: string): Response {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': MINI_CACHE_CONTROL,
      'X-Request-Id': requestId,
    },
  })
}

function invalid(requestId: string, status: number, field: string): Response {
  return response(
    miniError('invalid_request', '请求参数无效', requestId, [field]),
    status,
    requestId,
  )
}

function parseTarget(value: unknown): MiniFavoriteTarget | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('targetType') || !keys.includes('targetSlug')) return null
  const targetType = Object.getOwnPropertyDescriptor(value, 'targetType')?.value
  const targetSlug = Object.getOwnPropertyDescriptor(value, 'targetSlug')?.value
  if (
    (targetType !== 'listing' && targetType !== 'building')
    || typeof targetSlug !== 'string'
    || targetSlug.length < 1
    || targetSlug.length > MAX_SLUG_LENGTH
    || !SLUG_PATTERN.test(targetSlug)
  ) {
    return null
  }
  return { targetType, targetSlug }
}

async function verifiedTarget(target: MiniFavoriteTarget): Promise<boolean> {
  const context = createSearchContext('shanghai')
  return target.targetType === 'listing'
    ? Boolean(await assertEffectiveListing(target.targetSlug, context))
    : Boolean(await assertEffectiveBuilding(target.targetSlug, context))
}

async function mutate(request: Request, action: 'put' | 'delete'): Promise<Response> {
  const bearer = verifyMiniBearer(request)
  if (!bearer.ok) return bearer.response
  const requestId = miniRequestId()

  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? ''
  if (contentType !== 'application/json') return invalid(requestId, 415, 'invalid_content_type')
  const body = await readBoundedJsonBody(request, MAX_BODY_BYTES)
  if (!body.ok) {
    return invalid(requestId, body.error === 'body_too_large' ? 413 : 400, body.error)
  }
  const target = parseTarget(body.value)
  if (!target) return invalid(requestId, 422, 'invalid_body')

  try {
    if (!(await verifiedTarget(target))) {
      const code = target.targetType === 'listing' ? 'listing_not_found' : 'building_not_found'
      return response(
        miniError(code, '收藏目标已失效或不存在', requestId),
        404,
        requestId,
      )
    }
    const payload = await getPayload({ config })
    const store = createPayloadMiniUserAssetStore(payload)
    if (action === 'put') {
      const result = await upsertFavorite(store, bearer.subject, target)
      return response(miniWriteOk({
        favorite: true,
        created: result.created,
        targetType: target.targetType,
        targetSlug: target.targetSlug,
      }, requestId), 200, requestId)
    }
    const result = await removeFavorite(store, bearer.subject, target)
    return response(miniWriteOk({
      favorite: false,
      removed: result.removed,
      targetType: target.targetType,
      targetSlug: target.targetSlug,
    }, requestId), 200, requestId)
  } catch {
    return response(
      miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
      503,
      requestId,
    )
  }
}

export function PUT(request: Request): Promise<Response> {
  return mutate(request, 'put')
}

export function DELETE(request: Request): Promise<Response> {
  return mutate(request, 'delete')
}
