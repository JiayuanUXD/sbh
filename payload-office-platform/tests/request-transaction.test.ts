import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'

import {
  TransactionAbortedError,
  runInRequestTransaction,
} from '@/domain/shared/transaction-safety'

/**
 * runInRequestTransaction（OPT-113）：让「业务写 + 审计写」落在同一笔事务里。
 *
 * 自定义端点没有请求级事务，`payload.update({ req })` 会自开自提；审计随后另起一笔。
 * 审计写失败时业务已经落库——M8.2「审计失败 = 业务失败」就成了空话。
 * 这里用 Payload 自己的 init / commit / kill 把两笔写包进同一事务。
 */

function makeReq(opts: { transactionID?: string; hasTransactions?: boolean } = {}) {
  const beginTransaction = vi.fn(async () => 'tx-new')
  const commitTransaction = vi.fn(async () => undefined)
  const rollbackTransaction = vi.fn(async () => undefined)
  const db =
    opts.hasTransactions === false
      ? {}
      : { beginTransaction, commitTransaction, rollbackTransaction }
  const req = {
    payload: { db },
    ...(opts.transactionID ? { transactionID: opts.transactionID } : {}),
  } as unknown as PayloadRequest
  return { req, beginTransaction, commitTransaction, rollbackTransaction }
}

describe('runInRequestTransaction', () => {
  it('自己开的事务：成功后提交，返回 fn 的结果', async () => {
    const { req, beginTransaction, commitTransaction, rollbackTransaction } = makeReq()
    const seen: unknown[] = []
    const result = await runInRequestTransaction(req, 'test', async () => {
      seen.push((req as { transactionID?: unknown }).transactionID)
      return 42
    })
    expect(result).toBe(42)
    expect(beginTransaction).toHaveBeenCalledTimes(1)
    // fn 执行时 req 上挂的就是这笔事务——payload.update / 审计写都会复用它
    expect(seen).toEqual(['tx-new'])
    expect(commitTransaction).toHaveBeenCalledWith('tx-new')
    expect(rollbackTransaction).not.toHaveBeenCalled()
  })

  it('fn 抛错（如审计写失败）：回滚整笔事务并原样抛出', async () => {
    const { req, commitTransaction, rollbackTransaction } = makeReq()
    const boom = new Error('audit insert failed')
    await expect(
      runInRequestTransaction(req, 'test', async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(rollbackTransaction).toHaveBeenCalledWith('tx-new')
    expect(commitTransaction).not.toHaveBeenCalled()
  })

  it('进来时已有事务：不另开、不提交也不回滚（归外层管）', async () => {
    const { req, beginTransaction, commitTransaction, rollbackTransaction } = makeReq({
      transactionID: 'tx-outer',
    })
    await runInRequestTransaction(req, 'test', async () => 'ok')
    await expect(
      runInRequestTransaction(req, 'test', async () => {
        throw new Error('x')
      }),
    ).rejects.toThrow('x')
    expect(beginTransaction).not.toHaveBeenCalled()
    expect(commitTransaction).not.toHaveBeenCalled()
    expect(rollbackTransaction).not.toHaveBeenCalled()
  })

  it('事务在 fn 内被链路拆掉（killTransaction）：宁可报错，不返回假成功', async () => {
    const { req, commitTransaction } = makeReq()
    await expect(
      runInRequestTransaction(req, 'test', async () => {
        delete (req as { transactionID?: unknown }).transactionID
        return 'looks fine'
      }),
    ).rejects.toBeInstanceOf(TransactionAbortedError)
    expect(commitTransaction).not.toHaveBeenCalled()
  })

  it('适配器不支持事务：直接执行 fn', async () => {
    const { req } = makeReq({ hasTransactions: false })
    await expect(runInRequestTransaction(req, 'test', async () => 'ok')).resolves.toBe('ok')
  })
})
