/**
 * 领域错误 → HTTP 响应映射（AfterErrorHook）
 *
 * Payload 的 routeError 只会把「公开错误」（Payload APIError / 带非 500 status 的 Error）
 * 原样返回给客户端，其余一律替换成 500 "Something went wrong."。领域层在 hook / 端点里
 * 抛出的 DomainError（如 protectLocation 的 VersionConflictError）因此会丢失具体文案，
 * 前端拿不到「已被他人修改」这类业务信息。
 *
 * 本 hook 在 config 级注册，于 routeError 兜底之后、真正响应之前执行，把 DomainError
 * 重新映射为对应的 HTTP 状态码与 message。不改任何既有错误码与错误文案，只是把
 * 领域错误原本就携带的 code/message 透传给客户端。
 *
 * —— 作用域限制（审核修复 P1-2）——
 * config 级 hook 对**所有** collection 与端点生效，包括 `/api/inquiries`、
 * `/api/supply-submissions`、`/api/corrections` 这些匿名可访问的公开端点。
 * 原实现会把内部业务错误文案连同 404/409/422 一并暴露给匿名调用方，
 * 既扩大了信息面，也给了「按状态码探测记录是否存在」的空间——而这一切
 * 只是为了让后台面板能拿到版本冲突提示。
 *
 * 因此**只对已登录请求生效**：`req.user` 为空时直接返回 undefined，
 * 让 Payload 保持原本的 500 兜底行为，公开端点的对外契约一个字都不变。
 */

import type { AfterErrorHook } from 'payload'

import {
  DomainError,
  ForbiddenError,
  IllegalStateTransitionError,
  InvalidOperationError,
  NotFoundError,
  VersionConflictError,
} from '@/domain/shared/errors'
import { TransactionAbortedError } from '@/domain/shared/transaction-safety'

/** 按错误类映射 HTTP 状态码；未命中的 DomainError 一律 400。 */
const STATUS_BY_CLASS: Array<[new (...args: never[]) => DomainError, number]> = [
  [ForbiddenError, 403],
  [NotFoundError, 404],
  [VersionConflictError, 409],
  [IllegalStateTransitionError, 409],
  [InvalidOperationError, 422],
  // 事务被回滚 = 写入没落库，必须以 5xx 暴露；给的是我们自己写死的固定文案，不含内部细节
  [TransactionAbortedError, 500],
]

export const domainErrorAfterError: AfterErrorHook = async ({ error, req }) => {
  if (!(error instanceof DomainError)) return
  // 匿名请求不透传领域文案，保持 Payload 原本的 500 兜底（见文件头「作用域限制」）
  if (!req?.user) return
  const status = STATUS_BY_CLASS.find(([Cls]) => error instanceof Cls)?.[1] ?? 400
  return {
    status,
    response: { errors: [{ message: error.message }] },
  }
}

/**
 * 补回 Payload `ValidationError` 被生产构建吞掉的 `data`（OPT-063）。
 *
 * ## 症状
 *
 * 生产构建下，字段级校验失败的响应体退化成
 * `{"errors":[{"message":"The following field is invalid: roomNumber"}]}`——
 * **没有 `data` 键**，我们精心写的中文文案（「房间号「X」在同一楼盘下已被「Y」占用」）
 * 到不了客户端。后台用户看到的是那句英文泛泛之词。`next dev` 下一切正常。
 *
 * ## 根因
 *
 * Payload 的 `formatErrors`（`payload/dist/utilities/formatErrors.js`）用
 * **`instanceof`** 决定要不要带上 `data`：
 *
 * ```js
 * if ((incoming instanceof ValidationError || incoming instanceof APIError) && incoming.data) {
 *   return { errors: [{ name, data: incoming.data, message }] }   // 带 data
 * }
 * if (incoming.name) { return { errors: [{ message }] } }         // 不带 data
 * ```
 *
 * 而 Turbopack 生产构建把 `payload` 拆进了两个 chunk：领域 hook 在应用 chunk
 * （`.next/server/chunks/ssr/_*.js`）里 `new ValidationError(...)`，`formatErrors`
 * 在 node_modules chunk（`.next/server/chunks/ssr/node_modules__pnpm_*.js`）里做
 * `instanceof`——**两个类身份，判定恒 false**，于是走进不带 `data` 的分支。
 * dev 模式模块实例共享，所以本地（含 `next start`）都复现不出来。
 *
 * 判据留档（CI run 33402781223 的服务端日志）：错误对象 `data` 完整、
 * `isPublic: true`、`status: 400` 一应俱全，`isErrorPublic` 是鸭子类型判断不会替换，
 * 唯一还能丢掉 `data` 的闸门就只剩 `formatErrors` 的 `instanceof`。
 *
 * ## 为什么修在这里，而不是关掉打包拆分
 *
 * `serverExternalPackages: ['payload']` 能治根，但它改的是整个应用的打包方式，
 * 影响构建产物、冷启动与部署，风险面远大于本次缺陷；而且**验证只能靠 CI 跑生产构建**，
 * 反馈环极慢。本 hook 走鸭子类型，`instanceof` 成不成立它都对：
 * 成立时响应里已有 `data`，直接放行不动手；不成立时才补回来。
 *
 * ## 作用域
 *
 * 与 `domainErrorAfterError` 同口径**只对已登录请求生效**：校验文案里会带上冲突记录的
 * 标题（「已被「XX 大厦 12 层」占用」），对匿名调用方属于信息泄露。公开端点
 * （`/api/inquiries` 等）的对外契约一个字不变。
 */

/** 单条字段错误的鸭子类型判据：至少要有字符串 message。 */
function hasStringMessage(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}

/** 从错误对象上读出形如 ValidationError 的 `data`；不合形状一律返回 null。 */
function readValidationErrorData(
  error: unknown,
): { collection?: unknown; errors: Array<{ message: string }> } | null {
  if (typeof error !== 'object' || error === null) return null
  const data = (error as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return null
  const errors = (data as { errors?: unknown }).errors
  if (!Array.isArray(errors) || errors.length === 0) return null
  if (!errors.every(hasStringMessage)) return null
  return data as { collection?: unknown; errors: Array<{ message: string }> }
}

/**
 * 复刻 Payload `isErrorPublic` 的判据（鸭子类型，跨 chunk 仍成立）。
 * 只有「本来就该给用户看」的错误才补 data，绝不把内部异常的细节放出去。
 */
function isPublicErrorLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { isPublic?: unknown; status?: unknown }
  if (candidate.isPublic === true) return true
  if (candidate.isPublic === false) return false
  return typeof candidate.status === 'number' && candidate.status !== 500
}

export const validationErrorDataAfterError: AfterErrorHook = async ({ error, req, result }) => {
  // 与 domainErrorAfterError 同口径：匿名请求不透传字段级文案（见上「作用域」）
  if (!req?.user) return
  if (!isPublicErrorLike(error)) return

  const data = readValidationErrorData(error)
  if (!data) return

  // instanceof 正常的环境（dev / 未拆 chunk 的构建）响应里已经带着 data，不重复接管。
  const firstError = (result as { errors?: Array<{ data?: unknown }> } | undefined)?.errors?.[0]
  if (firstError && firstError.data !== undefined) return

  const message =
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '校验未通过'

  // 不返回 status：沿用 routeError 从 err.status 算出的 400，避免与 Payload 判断分叉。
  return {
    response: { errors: [{ name: 'ValidationError', message, data }] },
  }
}