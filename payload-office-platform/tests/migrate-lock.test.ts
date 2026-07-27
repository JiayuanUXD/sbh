import { describe, it, expect, vi } from 'vitest'
import { closeMigrationDb, runMigrateLocked } from '../src/lib/runtime/migrate-lock'

const noop = () => undefined

describe('runMigrateLocked: advisory lock 互斥迁移', () => {
  it('首次拿到锁 -> 执行迁移并释放，不 sleep', async () => {
    const tryAcquire = vi.fn().mockResolvedValue(true)
    const release = vi.fn().mockResolvedValue(undefined)
    const runMigrate = vi.fn().mockResolvedValue(undefined)
    const sleep = vi.fn().mockResolvedValue(undefined)
    const now = () => 0

    const result = await runMigrateLocked({
      tryAcquire, release, runMigrate, sleep, now, maxWaitMs: 1000, pollMs: 100,
    })

    expect(result).toBe('acquired')
    expect(tryAcquire).toHaveBeenCalledTimes(1)
    expect(runMigrate).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('首次失败、第二次成功 -> sleep 一次后拿到锁', async () => {
    const tryAcquire = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const release = vi.fn().mockResolvedValue(undefined)
    const runMigrate = vi.fn().mockResolvedValue(undefined)
    const sleep = vi.fn().mockResolvedValue(undefined)
    const now = () => 0

    const result = await runMigrateLocked({
      tryAcquire, release, runMigrate, sleep, now, maxWaitMs: 1000, pollMs: 100,
    })

    expect(result).toBe('acquired')
    expect(tryAcquire).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(100)
    expect(runMigrate).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('一直拿不到锁且超时 -> timeout，不执行迁移、不释放', async () => {
    const tryAcquire = vi.fn().mockResolvedValue(false)
    const release = vi.fn().mockResolvedValue(undefined)
    const runMigrate = vi.fn().mockResolvedValue(undefined)
    const sleep = vi.fn().mockResolvedValue(undefined)
    // now 每次调用推进 400ms（含 start 消耗的第一次）：
    // start=0, while1: now=400<1000 进循环 tryAcquire(false)+sleep,
    // while2: now=800<1000 进循环 tryAcquire(false)+sleep,
    // while3: now=1200>=1000 退出 -> timeout
    let calls = 0
    const now = () => calls++ * 400

    const result = await runMigrateLocked({
      tryAcquire, release, runMigrate, sleep, now, maxWaitMs: 1000, pollMs: 100,
    })

    expect(result).toBe('timeout')
    expect(tryAcquire).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(runMigrate).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })

  it('迁移抛错 -> release 仍被调（finally），错误向上抛', async () => {
    const tryAcquire = vi.fn().mockResolvedValue(true)
    const release = vi.fn().mockResolvedValue(undefined)
    const runMigrate = vi.fn().mockRejectedValue(new Error('migrate failed'))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const now = () => 0

    await expect(
      runMigrateLocked({ tryAcquire, release, runMigrate, sleep, now, maxWaitMs: 1000, pollMs: 100 }),
    ).rejects.toThrow('migrate failed')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('release 抛错 -> 不影响结果（仍为 acquired）', async () => {
    const tryAcquire = vi.fn().mockResolvedValue(true)
    const release = vi.fn().mockRejectedValue(new Error('release failed'))
    const runMigrate = vi.fn().mockResolvedValue(undefined)
    const sleep = vi.fn().mockResolvedValue(undefined)
    const now = () => 0

    const result = await runMigrateLocked({
      tryAcquire, release, runMigrate, sleep, now, maxWaitMs: 1000, pollMs: 100,
    })

    expect(result).toBe('acquired')
    expect(runMigrate).toHaveBeenCalledTimes(1)
  })

  it('onStatus 回调在 acquired/timeout/retry 时被通知', async () => {
    const tryAcquire = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const release = vi.fn().mockResolvedValue(undefined)
    const runMigrate = vi.fn().mockResolvedValue(undefined)
    const sleep = vi.fn().mockResolvedValue(undefined)
    const now = () => 0
    const onStatus = vi.fn(noop)

    await runMigrateLocked({
      tryAcquire, release, runMigrate, sleep, now, maxWaitMs: 1000, pollMs: 100, onStatus,
    })

    // 第一次 retry（false），然后 acquired
    expect(onStatus).toHaveBeenCalledWith('retry')
    expect(onStatus).toHaveBeenCalledWith('acquired')
  })
})

describe('closeMigrationDb: 迁移脚本退出前释放连接池', () => {
  it('先清理 adapter，再关闭 PostgreSQL pool，避免进程因空闲连接悬挂', async () => {
    const calls: string[] = []
    const destroy = vi.fn(async () => {
      calls.push('destroy')
    })
    const end = vi.fn(async () => {
      calls.push('end')
    })

    await closeMigrationDb({ destroy, pool: { end } })

    expect(calls).toEqual(['destroy', 'end'])
  })

  it('adapter 清理失败时仍关闭 PostgreSQL pool', async () => {
    const end = vi.fn().mockResolvedValue(undefined)

    await expect(
      closeMigrationDb({
        destroy: vi.fn().mockRejectedValue(new Error('destroy failed')),
        pool: { end },
      }),
    ).rejects.toThrow('destroy failed')

    expect(end).toHaveBeenCalledTimes(1)
  })
})
