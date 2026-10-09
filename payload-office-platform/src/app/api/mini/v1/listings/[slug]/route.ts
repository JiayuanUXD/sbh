import { NextResponse } from 'next/server'
import {
  miniError,
  miniOk,
  miniRequestId,
  MINI_CACHE_CONTROL,
} from '@/domain/mini-program/response'
import { getMiniListingDetail } from '@/lib/mini-program/catalog-service'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const requestId = miniRequestId()
  const city = new URL(request.url).searchParams.get('city') ?? ''
  const { slug } = await context.params

  try {
    const resolution = await getMiniListingDetail(city, slug)

    if (resolution.status === 'city-not-found') {
      return NextResponse.json(
        miniError('city_not_found', '城市暂未开放', requestId),
        {
          status: 404,
          headers: { 'Cache-Control': MINI_CACHE_CONTROL, 'X-Request-Id': requestId },
        },
      )
    }

    if (resolution.status === 'listing-not-found') {
      return NextResponse.json(
        miniError('listing_not_found', '房源已失效或不存在', requestId),
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
  } catch {
    return NextResponse.json(
      miniError('service_unavailable', '服务暂不可用，请稍后重试', requestId),
      {
        status: 503,
        headers: { 'Cache-Control': MINI_CACHE_CONTROL, 'X-Request-Id': requestId },
      },
    )
  }
}
