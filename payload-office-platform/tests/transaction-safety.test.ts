/**
 * 事务安全护栏（`@/domain/shared/transaction-safety`）
 *
 * 守护的核心事实（2026-08-31 在本地夹具库实测到的数据丢失）：
 *
 * Payload 的每个 collection operation 在 catch 里都会调 `killTransaction(req)`，
 * 而 `killTransaction` 会 **rollback 整个 req 上的事务并把 `req.transactionID` 删掉**：
 *
 *   payload/src/collections/operations/findByID.ts:354  → killTransaction(args.req)
 *   payload/src/utilities/killTransaction.ts:14         → db.rollbackTransaction(id); delete req.transactionID
 *
 * 于是 hook 里那句人畜无害的 `try { findByID } catch { return null }` 有一个
 * 谁都想不到的副作用：**它连带回滚了调用方那笔写入**。更糟的是回滚之后
 * `req.transactionID` 已经没了，`updateByID` 结尾的 `commitTransaction(req)` 拿
 * `undefined` 去 commit —— drizzle 的 `commitTransaction` 查不到 session 直接
 * `return`，不抛错。调用方拿到一个字段已更新的 doc，DB 里什么都没变。
 *
 * 所以这里锁两条：
 *   1. 「查不到」必须走 `disableErrors`，压根不进 Payload 的 catch，事务毫发无损；
 *   2. 万一还是被拆了（别的异常路径、将来 Payload 改实现），**必须抛错**，
 *      绝不允许再出现「返回成功、数据没落库」。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  TransactionAbortedError,
  assertTransactionIntact,
  findByIdSafe,
} from '@/domain/shared/transaction-safety'

type FakeReq = {
  transactionID?: string
  payload: { findByID: (args: Record<string, unknown>) => Promise<unknown> }
}

/**
 * 按 Payload 3.86 的真实契约造假：
 *   - 软删文档只在 `trash: true` 时可见；
 *   - 不可见时，`disableErrors: true` 返回 null（不碰事务），
 *     否则先 killTransaction 再抛 —— 这正是 bug 的传播路径。
 */
function makeReq(docs: Record<string, Record<string, unknown>>, withTransaction = true) {
  const req: FakeReq = {
    transactionID: withTransaction ? 'txn-1' : undefined,
    payload: {
      findByID: async (args) => {
        const doc = docs[`${String(args.collection)}:${String(args.id)}`]
        const visible = doc && (doc.deletedAt == null || args.trash === true)
        if (!visible) {
          if (args.disableErrors === true) return null
          delete req.transactionID
          throw new Error('NotFound')
        }
        return doc
      },
    },
  }
  return req
}

describe('findByIdSafe', () => {
  it('查得到就原样返回', async () => {
    const req = makeReq({ 'buildings:5': { id: 5, city: 7 } })
    await expect(
      findByIdSafe({ req: req as never, collection: 'buildings', id: 5, operation: 'test' }),
    ).resolves.toEqual({ id: 5, city: 7 })
    expect(req.transactionID).toBe('txn-1')
  })

  it('查不到返回 null，且不动调用方的事务', async () => {
    const req = makeReq({})
    await expect(
      findByIdSafe({ req: req as never, collection: 'buildings', id: 5, operation: 'test' }),
    ).resolves.toBeNull()
    // 这一条就是整个 bug：旧写法在这里会把 txn-1 回滚掉
    expect(req.transactionID).toBe('txn-1')
  })

  it('trash: true 能读到软删文档', async () => {
    const req = makeReq({ 'buildings:5': { id: 5, deletedAt: '2026-08-31T00:00:00.000Z' } })
    await expect(
      findByIdSafe({ req: req as never, collection: 'buildings', id: 5, operation: 'test' }),
    ).resolves.toBeNull()
    await expect(
      findByIdSafe({
        req: req as never, collection: 'buildings', id: 5, trash: true, operation: 'test',
      }),
    ).resolves.toEqual({ id: 5, deletedAt: '2026-08-31T00:00:00.000Z' })
  })

  it('查询把事务拆了就必须抛错，不能吞成 null', async () => {
    const req = makeReq({})
    req.payload.findByID = async () => {
      // 模拟 Payload 其它异常路径：先 killTransaction 再抛
      delete req.transactionID
      throw new Error('boom')
    }
    await expect(
      findByIdSafe({ req: req as never, collection: 'buildings', id: 5, operation: 'supply-cache:building' }),
    ).rejects.toBeInstanceOf(TransactionAbortedError)
  })

  it('req 上本来就没有事务时保持「查不到就 null」的旧行为', async () => {
    const req = makeReq({}, false)
    req.payload.findByID = async () => {
      throw new Error('boom')
    }
    await expect(
      findByIdSafe({ req: req as never, collection: 'buildings', id: 5, operation: 'test' }),
    ).resolves.toBeNull()
  })
})

describe('assertTransactionIntact', () => {
  it('事务 id 没变就放行', () => {
    expect(() => assertTransactionIntact({ transactionID: 'a' }, 'a', 'test')).not.toThrow()
  })

  it('事务 id 消失就抛 TransactionAbortedError', () => {
    expect(() => assertTransactionIntact({}, 'a', 'test')).toThrow(TransactionAbortedError)
  })

  it('事务 id 被换成另一笔也算被拆', () => {
    expect(() => assertTransactionIntact({ transactionID: 'b' }, 'a', 'test')).toThrow(
      TransactionAbortedError,
    )
  })

  it('本来就没有事务时不判', () => {
    expect(() => assertTransactionIntact({}, undefined, 'test')).not.toThrow()
  })

  it('错误里带上定位标签，便于从日志反查是哪一段拆的事务', () => {
    const error = (() => {
      try {
        assertTransactionIntact({}, 'a', 'supply-cache:building')
        return null
      } catch (e) {
        return e as TransactionAbortedError
      }
    })()
    expect(error?.details).toMatchObject({ operation: 'supply-cache:building' })
    expect(error?.isOperational).toBe(false)
  })
})

describe('回归：这条 bug 的完整传播链', () => {
  it('旧写法（try/catch 吞 NotFound）会静默回滚调用方事务', async () => {
    const req = makeReq({})
    const legacyLoad = async () => {
      try {
        return await req.payload.findByID({ collection: 'buildings', id: 5, req })
      } catch {
        return null
      }
    }
    const spy = vi.fn()
    await legacyLoad().then(spy)

    expect(spy).toHaveBeenCalledWith(null) // 调用方以为「只是查不到」
    expect(req.transactionID).toBeUndefined() // 实际上整笔写入已经被回滚
  })
})
