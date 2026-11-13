import { NextResponse } from 'next/server'
import {
  miniError,
  miniOk,
  miniRequestId,
  MINI_CACHE_CONTROL,
} from '@/domain/mini-program/response'
import { getMiniArticles } from '@/lib/mini-program/catalog-service'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const requestId = miniRequestId()

  try {
    const snapshot = await getMiniArticles(new URL(request.url))

    return NextResponse.json(
      miniOk(snapshot.data, { requestId, asOf: snapshot.asOf }),
      {
        headers: {
          'Cache-Control': MINI_CACHE_CONTROL,
          'X-Request-Id': requestId,
        },
      },
    )
  } catch (error) {
    console.error('getMiniArticles failed with error:', error)
    return NextResponse.json(
      miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
      {
        status: 503,
        headers: { 'Cache-Control': MINI_CACHE_CONTROL, 'X-Request-Id': requestId },
      },
    )
  }
}
