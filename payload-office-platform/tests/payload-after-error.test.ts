import { describe, expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'

import { domainErrorAfterError } from '../src/domain/shared/payload-after-error'
import {
  ForbiddenError,
  IllegalStateTransitionError,
  InvalidOperationError,
  NotFoundError,
  VersionConflictError,
} from '../src/domain/shared/errors'

/**
 * 领域错误 → HTTP 映射（config 级 afterError）
 *
 * 关键不变量（审核修复 P1-2）：**只对已登录请求生效**。
 * 该 hook 对所有 collection 与端点生效，含 /api/inquiries 等匿名公开端点；
 * 对匿名请求透传领域文案会扩大信息面并给出记录存在性探测的空间。
 */

function makeReq(user: unknown): PayloadRequest {
  return { user } as unknown as PayloadRequest
}

const loggedIn = makeReq({ id: 1, email: 'a@b.c' })
const anonymous = makeReq(null)

async function run(error: unknown, req: PayloadRequest) {
  return domainErrorAfterError({ error, req } as never)
}

describe('domainErrorAfterError', () => {
  it('已登录：按错误类映射状态码并透传 message', async () => {
    const cases: Array<[unknown, number]> = [
      [new ForbiddenError({ domain: 'auth', message: '禁止' }), 403],
      [new NotFoundError({ domain: 'geography', resource: '区域', id: 9 }), 404],
      [
        new VersionConflictError({
          domain: 'geography',
          resource: '商圈扩展',
          expectedVersion: 1,
          actualVersion: 2,
        }),
        409,
      ],
      [
        new IllegalStateTransitionError({
          domain: 'supply',
          resource: '房源',
          from: 'draft',
          to: 'archived',
          allowedTransitions: ['published'],
        }),
        409,
      ],
      [
        new InvalidOperationError({ domain: 'geography', code: 'X', message: '非法操作' }),
        422,
      ],
    ]
    for (const [error, status] of cases) {
      const res = (await run(error, loggedIn)) as { status: number; response: unknown }
      expect(res?.status, String(error)).toBe(status)
      expect(res.response).toEqual({
        errors: [{ message: (error as Error).message }],
      })
    }
  })

  it('匿名请求：一律不接管，保持 Payload 原本的 500 兜底', async () => {
    const errors = [
      new ForbiddenError({ domain: 'auth', message: '禁止' }),
      new NotFoundError({ domain: 'geography', resource: '区域', id: 9 }),
      new InvalidOperationError({ domain: 'geography', code: 'X', message: '内部业务文案' }),
    ]
    for (const error of errors) {
      await expect(run(error, anonymous)).resolves.toBeUndefined()
    }
  })

  it('req 缺失（无请求上下文）也不接管', async () => {
    const error = new NotFoundError({ domain: 'geography', resource: '区域', id: 9 })
    await expect(domainErrorAfterError({ error } as never)).resolves.toBeUndefined()
  })

  it('非领域错误一律不接管（已登录也不接管）', async () => {
    await expect(run(new Error('boom'), loggedIn)).resolves.toBeUndefined()
    await expect(run(new TypeError('bad'), loggedIn)).resolves.toBeUndefined()
  })
})
