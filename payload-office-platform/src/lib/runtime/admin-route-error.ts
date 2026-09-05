import { NextResponse } from 'next/server'

/**
 * 后台专用端点的异常出口：记日志 +（**仅在鉴权通过后**）把真实原因回给调用方。
 *
 * ## 为什么要把 message 回给前端
 *
 * OPT-069 上线后 `/api/watermark-preview` 在生产恒 500，排查时发现两条本该独立的
 * 观测通道同时是断的：
 *
 *   - 前端只有 `<img onError>`，拿不到状态码，把 401/403/5xx 一律显示成
 *     「预览需要『站点设置』管理权限」——排查因此先往权限方向走了一圈冤枉路；
 *   - 应用日志一时查不到（CLS 那个 topic 里只有平台 DNS 边车那一路）。
 *
 * 两条都断，线上异常就成了纯黑盒。所以让端点自己把原因带回去。
 *
 * ## `exposeDetail` 为什么是必填的
 *
 * 本参数刻意不给默认值：**每个调用点都必须自己回答「此刻鉴权通过了没有」**。
 *
 * 初版把整个处理函数包进一个 try，头注释还写着「调用方都在 `site_settings:manage`
 * 之后」——而 `getPayload` / `payload.auth` / `getPermissionContext` 恰恰在权限判定
 * **之前**，它们抛错时调用方可能还是匿名的。那时 DB 连接失败会带出主机与端口、
 * config-guard 的报错会逐条列出环境变量名，全被送给一个未经授权的请求。
 * （由 PR #153 的 code review 指出。注释承诺了代码没做到的事，是本仓库反复踩过的坑。）
 *
 *   - `exposeDetail: false` —— 鉴权链路上（含建 payload 实例、验会话、查权限）。
 *     只回 `{ error: 'internal_error' }`，现场全部留在服务端日志里。
 *   - `exposeDetail: true` —— 已确认调用方持有该端点要求的权限之后。
 *     回 `name` / `message`，因为看得到它的人本来就有权改这块配置。
 *
 * 两种情况下 **stack 都只进日志、不进响应**：它带容器内绝对路径，对定位没有额外
 * 价值，没必要送出进程。
 */
export function respondWithRouteError(
  scope: string,
  error: unknown,
  {
    exposeDetail,
    context = {},
  }: { exposeDetail: boolean; context?: Record<string, unknown> },
): NextResponse {
  const name = error instanceof Error ? error.name : typeof error
  const message = error instanceof Error ? error.message : String(error)

  // 日志不受 exposeDetail 影响：无论鉴权到哪一步，服务端都要留下完整现场。
  console.error(`[${scope}] failed`, {
    ...context,
    exposeDetail,
    name,
    message,
    stack: error instanceof Error ? error.stack : undefined,
  })

  if (!exposeDetail) {
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
  return NextResponse.json({ error: 'internal_error', name, message }, { status: 500 })
}
