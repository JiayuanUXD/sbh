/**
 * OPT-069：从「站点设置 → 图片水印」触发全量重刷。
 *
 * 只负责投一个 job 进队列，实际重刷由 `rebakeWatermarkTask` 自投游标扫全表完成。
 * 幂等由任务侧的 `watermark.version` 判定保证，重复点不会重复烘焙。
 */

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { MEDIA_WATERMARK_QUEUE, MEDIA_WATERMARK_TASK } from '@/domain/media/watermark-rebake'
import { resolveWatermarkConfig } from '@/domain/media/watermark-settings'
import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { respondWithRouteError } from '@/lib/runtime/admin-route-error'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  // 与预览端点同样包进 try（理由见 `lib/runtime/admin-route-error.ts` 头注释）。
  // 这里比预览更要紧：投递失败时前端只会看到一个失败的请求，而「任务到底排上没有」
  // 是运营唯一能据以判断要不要重试的信息。
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: request.headers })
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // 与「站点设置」同权限：能改水印参数的人才能触发重刷。
    const ctx = await getPermissionContext({ user, payload } as RequestContext)
    if (!ctx || !hasOperationPermission(ctx, 'site_settings:manage')) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    // 开关关着时 `rebakeWatermarkTask` 会立刻早退、什么都不处理（见该任务顶部注释）——
    // 排了也是白排，还会让任务把早退原因埋进服务日志，运营只看得到前端一句「已加入队列」。
    // 这里提前查一次同一份配置，不排队、如实告知，而不是谎报排队成功。
    const watermarkConfig = await resolveWatermarkConfig(payload)
    if (!watermarkConfig.enabled) {
      return NextResponse.json({ queued: false, reason: 'disabled' })
    }

    await payload.jobs.queue({
      task: MEDIA_WATERMARK_TASK,
      queue: MEDIA_WATERMARK_QUEUE,
      input: {},
    })
    return NextResponse.json({ queued: true })
  } catch (error) {
    return respondWithRouteError('watermark-rebake', error)
  }
}
