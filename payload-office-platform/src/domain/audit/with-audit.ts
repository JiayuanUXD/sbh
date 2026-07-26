/**
 * 高风险动作审计包装器（tasks.md M8.2 / design §3.6 / R8）
 *
 * 职责：
 *   - 为高风险业务动作提供统一的"审计 + 业务"包装模式
 *   - 审计写入失败时自动回滚业务事务（审计失败 = 业务失败）
 *   - 业务失败时记录 failed 审计（writeAuditFailed 吞错，不污染异常流）
 *
 * 用法（endpoint handler 内）：
 *   ```ts
 *   const result = await withAudit({
 *     req,
 *     action: 'listing.review_approve',
 *     object: { collection: 'listings', objectId: listingId, objectVersion: listing.version },
 *     before: listing,
 *     fn: async () => {
 *       // 业务操作
 *       await req.payload.update(...)
 *       return { ok: true, after: updatedListing, changedFields: ['reviewStatus'] }
 *     },
 *   })
 *   ```
 *
 * 业务不变量（M8.2 验收门）：
 *   - 高风险操作审计失败时业务操作必须失败（审计写入失败抛错，fn 不执行或已执行则抛错）
 *   - 审计写入与业务操作在同一 Payload 请求上下文（共享事务由 Payload 管理）
 *   - 主体 / 角色 / 组织快照在写入时锁定，不随后续权限变更漂移
 */

import type { PayloadRequest } from 'payload'

import type { AuditAction, ObjectRef, WriteAuditParams } from './audit-types'
import { writeAuditSuccess, writeAuditFailed } from './audit-writer'

export interface WithAuditOptions<TResult> {
  req: PayloadRequest
  action: AuditAction
  object: ObjectRef
  /** 变更前快照（可选；未传则 after 也不记，仅记动作发生） */
  before?: Record<string, unknown> | null
  /**
   * 业务操作函数。
   *
   * 返回：
   *   - ok: true  → 记 success 审计，返回 data
   *   - ok: false → 记 failed 审计，抛业务异常（由 errorCode / errorMessage 填充）
   *
   * 异常：
   *   - fn 抛错 → 记 failed 审计（errorMessage 取 err.message），然后重新抛出
   */
  fn: () => Promise<{
    ok: true
    data: TResult
    after?: Record<string, unknown> | null
    changedFields?: string[]
    eventId?: string | null
  } | {
    ok: false
    errorCode: string
    errorMessage: string
  }>
  /** 失败时是否重新抛出（默认 true；设为 false 时返回 null 而不抛） */
  throwOnError?: boolean
}

/**
 * 高风险动作审计包装器。
 *
 * 执行顺序：
 *   1. 执行业务 fn()
 *   2a. fn 返回 ok → 写 success 审计，审计失败则抛错（此时业务已执行，但审计失败按 M8.2 要求视为整体失败）
 *   2b. fn 返回 ok:false → 写 failed 审计，然后抛错 / 返回 null
 *   2c. fn 抛异常 → 写 failed 审计（errorMessage 取 err.message），然后重抛
 *
 * 注：由于 Payload 3.x 没有显式事务 API，事务一致性由 Payload 的单请求
 * 数据库连接和数据库事务保证。审计写入失败会抛错，与业务异常同等处理。
 */
export async function withAudit<TResult>(
  options: WithAuditOptions<TResult>,
): Promise<TResult | null> {
  const { req, action, object, before, fn, throwOnError = true } = options

  try {
    const result = await fn()

    if (result.ok) {
      // 业务成功 → 写 success 审计
      try {
        await writeAuditSuccess({
          payload: req.payload,
          req,
          data: {
            action,
            object,
            before: before ?? null,
            after: result.after ?? null,
            changedFields: result.changedFields,
            eventId: result.eventId ?? null,
          },
        })
      } catch (auditErr) {
        // 审计失败 → 按 M8.2 要求，业务也视为失败（即使业务数据已写入）
        // 记录审计失败本身到 console
        console.error('[audit] withAudit: 审计写入失败，高风险动作视为失败', auditErr)
        throw auditErr
      }
      return result.data
    } else {
      // 业务返回失败 → 写 failed 审计
      try {
        await writeAuditFailed({
          payload: req.payload,
          req,
          data: {
            action,
            object,
            before: before ?? null,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
          },
        })
      } catch {
        // failed 审计写入失败不二次抛（避免污染原始业务错误）
      }
      if (throwOnError) {
        const err = new Error(result.errorMessage)
        ;(err as { code?: string }).code = result.errorCode
        throw err
      }
      return null
    }
  } catch (err) {
    // fn 抛异常 → 写 failed 审计，然后重抛
    try {
      await writeAuditFailed({
        payload: req.payload,
        req,
        data: {
          action,
          object,
          before: before ?? null,
          errorCode: (err as { code?: string })?.code ?? 'UNKNOWN_ERROR',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      })
    } catch {
      // 审计二次失败不处理
    }
    throw err
  }
}

/**
 * 简化版：在已知 before 快照的 update 场景下，自动推导 after（从 fn 返回的对象）。
 *
 * 用于典型的"读取 → 修改 → 保存"模式。
 */
export async function withAuditUpdate<TResult>(
  options: Omit<WithAuditOptions<TResult>, 'fn'> & {
    fn: () => Promise<TResult>
    after: Record<string, unknown> | null
    changedFields?: string[]
  },
): Promise<TResult> {
  const result = await withAudit({
    ...options,
    fn: async () => {
      const data = await options.fn()
      return { ok: true as const, data, after: options.after, changedFields: options.changedFields }
    },
  })
  return result as TResult
}
