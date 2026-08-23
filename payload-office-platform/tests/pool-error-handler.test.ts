/**
 * `lib/runtime/pool-error-handler` 单测
 *
 * 守护不变量：
 *   - 池子上确实挂上了 `error` 监听者（没有监听者 = EventEmitter 直接 throw = 容器崩）
 *   - 触发 error 时只记日志、不再抛出
 *   - 日志里带 pgCode，便于把 25P03（空载事务超时）与其它连接错误分开对账
 *   - 重复调用不重复挂（getPayload 是单例，热重载可能多次 init）
 *   - db 没有 pool（或 pool 不是 EventEmitter）时安全跳过，不炸启动
 *
 * 纯函数式验证，不连库。
 */

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { attachPoolErrorHandler } from '@/lib/runtime/pool-error-handler'

type FakePayload = {
  db: { pool?: unknown }
  logger: { error: ReturnType<typeof vi.fn> }
}

function makePayload(pool?: unknown): FakePayload {
  return { db: { pool }, logger: { error: vi.fn() } }
}

describe('attachPoolErrorHandler', () => {
  it('给池子挂上 error 监听者', () => {
    const pool = new EventEmitter()
    const payload = makePayload(pool)
    expect(pool.listenerCount('error')).toBe(0)
    attachPoolErrorHandler(payload as never)
    expect(pool.listenerCount('error')).toBe(1)
  })

  it('触发 error 时只记日志、不向外抛', () => {
    const pool = new EventEmitter()
    const payload = makePayload(pool)
    attachPoolErrorHandler(payload as never)

    const err = Object.assign(new Error('由于空载事务超时而终止连接'), { code: '25P03' })
    // 没有监听者时这一行会 throw；有监听者才不会。
    expect(() => pool.emit('error', err)).not.toThrow()
    expect(payload.logger.error).toHaveBeenCalledTimes(1)

    const [payloadArg, msg] = payload.logger.error.mock.calls[0]
    expect(msg).toBe('pg_pool_client_error')
    expect(payloadArg).toMatchObject({
      errorCode: 'pg_pool_client_error',
      pgCode: '25P03',
      message: '由于空载事务超时而终止连接',
    })
  })

  it('没有 pgCode 的普通连接错误也记得下来', () => {
    const pool = new EventEmitter()
    const payload = makePayload(pool)
    attachPoolErrorHandler(payload as never)
    pool.emit('error', new Error('connection terminated unexpectedly'))
    expect(payload.logger.error.mock.calls[0][0]).toMatchObject({ pgCode: null })
  })

  it('重复调用不重复挂监听者', () => {
    const pool = new EventEmitter()
    const payload = makePayload(pool)
    attachPoolErrorHandler(payload as never)
    attachPoolErrorHandler(payload as never)
    attachPoolErrorHandler(payload as never)
    expect(pool.listenerCount('error')).toBe(1)
  })

  it('db 上没有 pool 时安全跳过', () => {
    const payload = makePayload(undefined)
    expect(() => attachPoolErrorHandler(payload as never)).not.toThrow()
  })

  it('pool 不是 EventEmitter（没有 on 方法）时安全跳过', () => {
    const payload = makePayload({ query: () => undefined })
    expect(() => attachPoolErrorHandler(payload as never)).not.toThrow()
  })
})
