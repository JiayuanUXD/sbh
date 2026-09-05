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
import { getPermissionContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 与「站点设置」同权限：能改水印参数的人才能触发重刷。
  const ctx = await getPermissionContext({ user, payload } as never)
  if (!ctx || !hasOperationPermission(ctx, 'site_settings:manage')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  await payload.jobs.queue({
    task: MEDIA_WATERMARK_TASK,
    queue: MEDIA_WATERMARK_QUEUE,
    input: {},
  })
  return NextResponse.json({ queued: true })
}
