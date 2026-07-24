import configPromise from '@payload-config'
import { getPayload } from 'payload'

// getPayload 会初始化 DB 适配器；构建期无 DB，强制运行时动态，禁止预渲染。
export const dynamic = 'force-dynamic'

export const GET = async (request: Request) => {
  const payload = await getPayload({
    config: configPromise,
  })

  return Response.json({
    message: 'This is an example of a custom route.',
  })
}
