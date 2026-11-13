import { NextResponse } from 'next/server'
import {
  miniError,
  miniOk,
  miniRequestId,
  MINI_CACHE_CONTROL,
} from '@/domain/mini-program/response'
import { getMiniArticleDetail } from '@/lib/mini-program/catalog-service'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const requestId = miniRequestId()
  const { slug } = await context.params

  try {
    const resolution = await getMiniArticleDetail(slug)

    if (resolution.status === 'article_not_found') {
      return NextResponse.json(
        miniError('article_not_found', '文章不存在或已下架', requestId),
        {
          status: 404,
          headers: { 'Cache-Control': MINI_CACHE_CONTROL, 'X-Request-Id': requestId },
        },
      )
    }

    return NextResponse.json(
      miniOk(resolution.snapshot.data, { requestId, asOf: resolution.snapshot.asOf }),
      {
        headers: {
          'Cache-Control': MINI_CACHE_CONTROL,
          'X-Request-Id': requestId,
        },
      },
    )
  } catch (error) {
    console.error('getMiniArticleDetail failed with error:', error)
    return NextResponse.json(
      miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
      {
        status: 503,
        headers: { 'Cache-Control': MINI_CACHE_CONTROL, 'X-Request-Id': requestId },
      },
    )
  }
}
