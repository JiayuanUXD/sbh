import { describe, expect, it } from 'vitest'

import {
  DEFAULT_POOL_MAX,
  IDLE_IN_TRANSACTION_TIMEOUT_MS,
  buildPgSessionOptions,
  resolvePoolMax,
  resolveStatementTimeoutMs,
} from '@/lib/runtime/db-pool-options'

describe('连接池参数（2026-10-13 池满故障止损）', () => {
  it('池上限默认 20，不再沿用 node-postgres 的 10', () => {
    expect(resolvePoolMax({})).toBe(DEFAULT_POOL_MAX)
    expect(DEFAULT_POOL_MAX).toBeGreaterThan(10)
    expect(resolvePoolMax({ DB_POOL_MAX: '' })).toBe(DEFAULT_POOL_MAX)
  })

  it('DB_POOL_MAX 可覆盖，非法值直接报错而不是悄悄回落', () => {
    expect(resolvePoolMax({ DB_POOL_MAX: '30' })).toBe(30)
    expect(() => resolvePoolMax({ DB_POOL_MAX: 'abc' })).toThrow(/DB_POOL_MAX/)
    expect(() => resolvePoolMax({ DB_POOL_MAX: '1' })).toThrow(/2–100/)
    expect(() => resolvePoolMax({ DB_POOL_MAX: '500' })).toThrow(/2–100/)
  })

  it('语句超时默认关闭：迁移与运维脚本共用同一份 config，不能被误杀', () => {
    expect(resolveStatementTimeoutMs({})).toBeNull()
    expect(buildPgSessionOptions({})).toBe(
      `-c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
    )
  })

  it('设置 DB_STATEMENT_TIMEOUT_MS 后追加 statement_timeout，空闲事务超时始终保留', () => {
    expect(buildPgSessionOptions({ DB_STATEMENT_TIMEOUT_MS: '30000' })).toBe(
      '-c idle_in_transaction_session_timeout=120000 -c statement_timeout=30000',
    )
  })

  it('语句超时低于 1s 或不是整数视为配置错误', () => {
    expect(() => resolveStatementTimeoutMs({ DB_STATEMENT_TIMEOUT_MS: '500' })).toThrow(/1000/)
    expect(() => resolveStatementTimeoutMs({ DB_STATEMENT_TIMEOUT_MS: '30s' })).toThrow(
      /DB_STATEMENT_TIMEOUT_MS/,
    )
  })
})
