/**
 * 领域操作结果类型
 *
 * 用于领域服务的返回值，强制调用方显式处理失败路径（AGENTS.md §11）。
 *
 * 设计取舍：
 *   - 不抛异常走控制流 → 调用方必须解构 ok / error，避免漏处理错误。
 *   - 抛异常路径仍保留（DomainError），用于 access hook 等需要短路 HTTP 的场景。
 *   - 业务上预期会失败的“前置检查”优先使用 OperationResult；不可预期异常仍走 throw。
 */
import type { DomainError } from './errors'

export type OperationResult<TOk, TErr extends DomainError = DomainError> =
  | { ok: true; data: TOk }
  | { ok: false; error: TErr }

export function ok<TOk>(data: TOk): OperationResult<TOk, never> {
  return { ok: true, data }
}

export function err<TErr extends DomainError>(error: TErr): OperationResult<never, TErr> {
  return { ok: false, error }
}

/**
 * 幂等请求包装
 *
 * 业务动作必须支持幂等重试（AGENTS.md §10）。
 * 调用方传入 idempotencyKey，服务端按 key + aggregateId 去重。
 */
export type IdempotencyRequest<TPayload> = {
  /** 客户端生成的稳定幂等键（UUID 或业务唯一键拼接）。同一 key + aggregateId 重复请求返回首次结果。 */
  idempotencyKey: string
  /** 聚合根 ID（如 listing_id / lead_id）；用于和 idempotencyKey 组合去重 */
  aggregateId: string
  /** 业务负载 */
  payload: TPayload
}

export type IdempotencyResult<TOk> =
  | { status: 'executed'; result: TOk }
  | { status: 'replayed'; result: TOk }

/**
 * 批量操作逐条结果
 *
 * AGENTS.md §6.6 要求批量领取/转派限制为 50 条且逐条返回结果。
 */
export type BatchItemResult<TOk> = {
  index: number
  id: string
} & (
  | { ok: true; result: TOk }
  | { ok: false; error: DomainError }
)
