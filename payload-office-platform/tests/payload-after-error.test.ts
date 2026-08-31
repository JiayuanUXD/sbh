import { describe, expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'

import {
  domainErrorAfterError,
  validationErrorDataAfterError,
} from '../src/domain/shared/payload-after-error'
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

/**
 * ValidationError 的 `data` 在生产构建下被 formatErrors 的 instanceof 丢掉（OPT-063）。
 *
 * 这批用例全部走**鸭子类型**构造错误对象，不 new 真的 ValidationError——正因为
 * 真实缺陷就是「对象长得对但 instanceof 不成立」，用真类反而验不到那条路径。
 */
function makeValidationLikeError(overrides: Record<string, unknown> = {}) {
  return {
    name: 'ValidationError',
    message: 'The following field is invalid: roomNumber',
    isPublic: true,
    status: 400,
    data: {
      collection: 'listings',
      errors: [{ path: 'roomNumber', message: '房间号「A-1201」在同一楼盘下已被「甲写字楼」占用，请换一个。' }],
    },
    ...overrides,
  }
}

async function runValidation(error: unknown, req: PayloadRequest, result?: unknown) {
  return validationErrorDataAfterError({ error, req, result } as never)
}

describe('validationErrorDataAfterError', () => {
  it('已登录 + 响应缺 data：把字段级文案补回去，且不改状态码', async () => {
    const error = makeValidationLikeError()
    // formatErrors 的降级形状：只有 message，没有 data
    const degraded = { errors: [{ message: error.message }] }

    const out = await runValidation(error, loggedIn, degraded)

    expect(out?.response).toEqual({
      errors: [{ name: 'ValidationError', message: error.message, data: error.data }],
    })
    // 不返回 status：沿用 routeError 从 err.status 算出的 400
    expect(out?.status).toBeUndefined()
  })

  it('响应里已经带着 data：不接管（instanceof 正常的环境）', async () => {
    const error = makeValidationLikeError()
    const intact = { errors: [{ name: 'ValidationError', message: error.message, data: error.data }] }

    expect(await runValidation(error, loggedIn, intact)).toBeUndefined()
  })

  it('匿名请求：一律不补，公开端点契约不变', async () => {
    const error = makeValidationLikeError()
    const degraded = { errors: [{ message: error.message }] }

    expect(await runValidation(error, anonymous, degraded)).toBeUndefined()
  })

  it('非公开错误：不补，避免把内部异常细节放出去', async () => {
    const internal = makeValidationLikeError({ isPublic: false, status: 500 })
    const degraded = { errors: [{ message: 'Something went wrong.' }] }

    expect(await runValidation(internal, loggedIn, degraded)).toBeUndefined()
  })

  it('形状不符的 data 一律不接管', async () => {
    const degraded = { errors: [{ message: 'x' }] }
    const cases: unknown[] = [
      makeValidationLikeError({ data: undefined }),
      makeValidationLikeError({ data: null }),
      makeValidationLikeError({ data: { collection: 'listings' } }), // 缺 errors
      makeValidationLikeError({ data: { errors: [] } }), // 空数组
      makeValidationLikeError({ data: { errors: [{ path: 'x' }] } }), // 缺 message
      makeValidationLikeError({ data: { errors: 'nope' } }),
      new Error('普通错误'),
      null,
      undefined,
    ]

    for (const error of cases) {
      expect(await runValidation(error, loggedIn, degraded), String(error)).toBeUndefined()
    }
  })

  it('与 domainErrorAfterError 作用域不相交：DomainError 不被本 hook 接管', async () => {
    const degraded = { errors: [{ message: '禁止' }] }
    const domainError = new ForbiddenError({ domain: 'auth', message: '禁止' })

    expect(await runValidation(domainError, loggedIn, degraded)).toBeUndefined()
  })
})
