import { NextResponse } from 'next/server'

/**
 * 后台专用端点的异常出口：记日志 + **把真实原因回给（已鉴权的）调用方**。
 *
 * ## 为什么要把 message 回给前端
 *
 * OPT-069 上线后 `/api/watermark-preview` 在生产恒 500，排查时发现两条本该独立的
 * 观测通道同时是断的：
 *
 *   - 前端只有 `<img onError>`，拿不到状态码，把 500 显示成「预览需要『站点设置』
 *     管理权限」——排查因此先往权限方向走了一圈冤枉路；
 *   - 容器日志在 CLS 里查不到应用自己的输出（该 topic 里只有平台 DNS 边车那一路），
 *     服务配置的 `LogSetId` / `LogTopicId` 都是空串。
 *
 * 两条都断，线上异常就成了纯黑盒：只能靠本地复现做排除法，而「本地跑得通」恰恰是
 * 这类环境相关故障的常态。所以让端点自己把原因带回去。
 *
 * 安全上是成立的：调用本函数的两个端点都在 `site_settings:manage` 之后，调用方是后台
 * 管理员而非匿名访客。**只回 name/message，不回 stack**——stack 带容器内绝对路径，
 * 对定位没有额外价值，没必要送出进程。
 *
 * 仍然照常 `console.error`：日志采集修好之后那才是主渠道，响应里这份是兜底，
 * 两者都在，不是二选一。
 */
export function respondWithRouteError(
  scope: string,
  error: unknown,
  context: Record<string, unknown> = {},
): NextResponse {
  const name = error instanceof Error ? error.name : typeof error
  const message = error instanceof Error ? error.message : String(error)

  console.error(`[${scope}] failed`, {
    ...context,
    name,
    message,
    stack: error instanceof Error ? error.stack : undefined,
  })

  return NextResponse.json({ error: 'internal_error', name, message }, { status: 500 })
}
