/**
 * OPT-069：从「站点设置 → 图片水印」触发全量重刷；OPT-112：查进度。
 *
 * - `POST` 只负责投一个 job 进队列，实际重刷由 `rebakeWatermarkTask` 自投游标扫全表完成。
 *   幂等由任务侧的 `watermark.version` 判定保证，重复点不会重复烘焙。
 * - `GET` 回「已完成 / 总数」与链条是否在跑，供按钮显示进度。
 */

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { computeWatermarkVersion } from '@/domain/media/watermark'
import {
  hasActiveRebakeChain,
  MEDIA_WATERMARK_QUEUE,
  MEDIA_WATERMARK_TASK,
  readRebakeProgress,
} from '@/domain/media/watermark-rebake'
import { resolveWatermarkConfig } from '@/domain/media/watermark-settings'
import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { respondWithRouteError } from '@/lib/runtime/admin-route-error'

export const dynamic = 'force-dynamic'

type Payload = Awaited<ReturnType<typeof getPayload>>

/**
 * 鉴权段与业务段分开 catch，理由同预览端点：这一段跑在权限判定之前，
 * 抛错时调用方可能还是匿名的，不能把原始异常消息送出去
 * （见 `lib/runtime/admin-route-error.ts` 的 `exposeDetail`）。
 *
 * 与「站点设置」同权限：能改水印参数的人才能触发重刷、看进度。
 */
async function authorize(request: Request): Promise<{ payload: Payload } | { response: Response }> {
  try {
    // `cron: true`：Payload 只在这样取实例时启动任务 cron（后台页面经 initReq 会带，自定义路由
    // 默认不带）。本路由排的重刷段、要回收的陈旧段都靠它跑；新实例若只收到本路由的请求，
    // 不带就没人跑（OPT-112 本地验收时实测）。与 supply-submissions 路由同一做法。
    const payload = await getPayload({ config, cron: true })
    const { user } = await payload.auth({ headers: request.headers })
    if (!user) return { response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }

    const ctx = await getPermissionContext({ user, payload } as RequestContext)
    if (!ctx || !hasOperationPermission(ctx, 'site_settings:manage')) {
      return { response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
    }
    return { payload }
  } catch (error) {
    return {
      response: respondWithRouteError('watermark-rebake', error, {
        exposeDetail: false,
        context: { phase: 'authorize' },
      }),
    }
  }
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authorize(request)
  if ('response' in auth) return auth.response
  const { payload } = auth

  try {
    const watermarkConfig = await resolveWatermarkConfig(payload)
    // 开关关着时没有「当前版本」可言（不烘），数了也没有意义。
    if (!watermarkConfig.enabled) return NextResponse.json({ enabled: false })

    const progress = await readRebakeProgress(payload, computeWatermarkVersion(watermarkConfig))
    return NextResponse.json({ enabled: true, ...progress })
  } catch (error) {
    // 已过权限校验，可以回真实原因：按钮据此显示「读取进度失败」，而不是一直转圈。
    return respondWithRouteError('watermark-rebake', error, {
      exposeDetail: true,
      context: { phase: 'progress' },
    })
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authorize(request)
  if ('response' in auth) return auth.response
  const { payload } = auth

  try {
    // 开关关着时 `rebakeWatermarkTask` 会立刻早退、什么都不处理（见该任务顶部注释）——
    // 排了也是白排，还会让任务把早退原因埋进服务日志，运营只看得到前端一句「已加入队列」。
    // 这里提前查一次同一份配置，不排队、如实告知，而不是谎报排队成功。
    const watermarkConfig = await resolveWatermarkConfig(payload)
    if (!watermarkConfig.enabled) {
      return NextResponse.json({ queued: false, reason: 'disabled' })
    }

    // OPT-112：已有链在跑就不再开一条。生产上「点了没反应」就再点，每点一次多一条从 id 0
    // 起步的链。两位管理员恰好同时点仍可能各排一条——任务侧「同一时刻只跑一段」兜得住，
    // 这里不为它加锁。
    if (await hasActiveRebakeChain(payload)) {
      return NextResponse.json({ queued: false, reason: 'running' })
    }

    await payload.jobs.queue({
      task: MEDIA_WATERMARK_TASK,
      queue: MEDIA_WATERMARK_QUEUE,
      input: {},
    })
    return NextResponse.json({ queued: true })
  } catch (error) {
    // 投递失败时前端只会看到一个失败的请求，而「任务到底排上没有」是运营唯一能据以
    // 判断要不要重试的信息——这一段在权限确认之后，可以回真实原因。
    return respondWithRouteError('watermark-rebake', error, {
      exposeDetail: true,
      context: { phase: 'queue' },
    })
  }
}
