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

/** 按错误类映射 HTTP 状态码；未命中的 DomainError 一律 400。 */
const STATUS_BY_CLASS: Array<[new (...args: never[]) => DomainError, number]> = [
  [ForbiddenError, 403],
  [NotFoundError, 404],
  [VersionConflictError, 409],
  [IllegalStateTransitionError, 409],
  [InvalidOperationError, 422],
]

export const domainErrorAfterError: AfterErrorHook = async ({ error }) => {
  if (!(error instanceof DomainError)) return
  const status = STATUS_BY_CLASS.find(([Cls]) => error instanceof Cls)?.[1] ?? 400
  return {
    status,
    response: { errors: [{ message: error.message }] },
  }
}