/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* OPT-088：在 Payload 生成的六个 REST 处理器外包一层，把 members 的 auth 端点封成 404。
   Payload 不会重写本文件（只有 create-payload-app 生成它）；若将来重新生成，须把包装恢复。 */
import config from '@payload-config'
import '@payloadcms/next/css'
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from '@payloadcms/next/routes'
import { isBlockedMemberAuthPath } from '@/domain/member/rest-fence'

type RouteContext = { params: Promise<{ slug: string[] }> }
type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>

function withMemberFence(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    const { slug } = await context.params
    if (isBlockedMemberAuthPath(slug)) return new Response(null, { status: 404 })
    return handler(request, context)
  }
}

export const GET = withMemberFence(REST_GET(config) as unknown as RouteHandler)
export const POST = withMemberFence(REST_POST(config) as unknown as RouteHandler)
export const DELETE = withMemberFence(REST_DELETE(config) as unknown as RouteHandler)
export const PATCH = withMemberFence(REST_PATCH(config) as unknown as RouteHandler)
export const PUT = withMemberFence(REST_PUT(config) as unknown as RouteHandler)
export const OPTIONS = withMemberFence(REST_OPTIONS(config) as unknown as RouteHandler)
