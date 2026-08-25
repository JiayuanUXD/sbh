import { describe, expect, it } from 'vitest'

import {
  DomainError,
  ForbiddenError,
  IllegalStateTransitionError,
  InvalidOperationError,
  NotFoundError,
  VersionConflictError,
} from '@/domain/shared/errors'
import { domainErrorAfterError } from '@/domain/shared/payload-after-error'

/**
 * `DomainError` 的 `isPublic` / `status` 契约（OPT-052）。
 *
 * ## 守的是什么
 *
 * Payload 的**批量操作**（`deleteMany` / `updateMany`）自己 catch 每一条错误：
 *
 * ```js
 * // payload/dist/collections/operations/delete.js:223
 * const isPublic = error instanceof Error ? isErrorPublic(error, config) : false
 * ```
 *
 * 这发生在 `afterError` 钩子**之前**，所以 `domainErrorAfterError` 那条映射
 * 在批量路径上**根本轮不到**。`isErrorPublic` 的判据只认 `isPublic` 与 `status`：
 *
 * ```js
 * if (payloadError.isPublic === true) return true
 * if (payloadError.isPublic === false) return false
 * if (payloadError.status && payloadError.status !== 500) return true
 * return false
 * ```
 *
 * 真实教训（OPT-050）：后台批量删楼盘，守卫确实拦住了，运营看到的却是
 * 「Something went wrong.」——**而 10 条单测全绿**，因为它们断言的是「抛了什么错」，
 * 缺陷却在「错误怎么被序列化给客户端」。
 *
 * ## 这里断言的是「错误对象的形状」
 *
 * 不是「抛了错」。形状不对，文案就到不了运营眼前，而所有业务断言照样绿。
 */

const CASES = [
  { name: 'ForbiddenError', make: () => new ForbiddenError({ domain: 'supply', message: '无权' }), status: 403 },
  { name: 'NotFoundError', make: () => new NotFoundError({ domain: 'supply', resource: '楼盘', id: 1 }), status: 404 },
  {
    name: 'InvalidOperationError',
    make: () => new InvalidOperationError({ domain: 'supply', message: '不能这么干' }),
    status: 422,
  },
  {
    name: 'VersionConflictError',
    make: () =>
      new VersionConflictError({ domain: 'supply', resource: '楼盘', expectedVersion: 1, actualVersion: 2 }),
    status: 409,
  },
  {
    name: 'IllegalStateTransitionError',
    make: () =>
      new IllegalStateTransitionError({
        domain: 'supply',
        resource: '房源',
        from: 'draft',
        to: 'sold',
        allowedTransitions: ['published'],
      }),
    status: 409,
  },
] as const

/** 复刻 Payload 的 `isErrorPublic`（`payload/dist/utilities/isErrorPublic.js`）。 */
function isErrorPublic(error: unknown, debug = false): boolean {
  const e = error as { isPublic?: boolean; status?: number }
  if (debug) return true
  if (e.isPublic === true) return true
  if (e.isPublic === false) return false
  if (e.status && e.status !== 500) return true
  return false
}

describe.each(CASES)('$name', ({ make, status }) => {
  it('isPublic 为 true —— 否则批量操作会把文案换成「Something went wrong.」', () => {
    expect(make().isPublic).toBe(true)
  })

  it(`status 为 ${status}`, () => {
    expect(make().status).toBe(status)
  })

  it('能通过 Payload 的 isErrorPublic 判据（这才是真正的判据）', () => {
    expect(isErrorPublic(make())).toBe(true)
  })

  it('状态码与 domainErrorAfterError 的映射一致 —— 两处不同源就会漂', async () => {
    const mapped = (await domainErrorAfterError({
      error: make(),
      req: { user: { id: 1 } },
    } as never)) as { status?: number } | undefined
    expect(mapped?.status, '错误类的 status 与 afterError 钩子的映射不一致').toBe(status)
  })
})

describe('系统异常不得对外暴露', () => {
  it('isOperational:false → isPublic 为 false', () => {
    // 这类 message 可能来自底层库，含连接串、堆栈、表结构。
    // 无差别放开 isPublic 会把内部细节泄露给用户——这正是 Payload 默认隐藏的原因。
    const err = new DomainError({
      code: 'DB_DOWN',
      domain: 'supply',
      message: 'connect ECONNREFUSED 10.0.0.1:5432',
      isOperational: false,
    })
    expect(err.isPublic).toBe(false)
    expect(isErrorPublic(err)).toBe(false)
  })

  it('默认（不传 isOperational）视为业务错误，isPublic 为 true', () => {
    const err = new DomainError({ code: 'X', domain: 'supply', message: '业务规则不满足' })
    expect(err.isOperational).toBe(true)
    expect(err.isPublic).toBe(true)
  })
})

describe('status 绝不能是 500', () => {
  it('基类默认 400，不是 500', () => {
    // isErrorPublic 对 500 视为内部错误照样隐藏消息；而且业务规则用 500
    // 会让它进错误告警。
    expect(new DomainError({ code: 'X', domain: 'supply', message: 'x' }).status).toBe(400)
  })

  it('所有子类的 status 都不是 500', () => {
    for (const { name, make } of CASES) {
      expect(make().status, `${name} 的 status 是 500`).not.toBe(500)
    }
  })
})
