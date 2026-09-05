/**
 * 事务安全护栏：让 hook 里的「查不到就当没有」不再连带回滚调用方的写入
 *
 * ## 这解决的是什么
 *
 * Payload 3.86 的每个 collection operation 都长这样（`findByID.ts:354`）：
 *
 * ```ts
 * } catch (error) {
 *   await killTransaction(args.req)
 *   throw error
 * }
 * ```
 *
 * 而 `killTransaction`（`utilities/killTransaction.ts:14`）做的是
 * `db.rollbackTransaction(req.transactionID)` + `delete req.transactionID`——
 * **回滚的是整个 req 上的事务**，不是这次查询自己的。
 *
 * 于是 hook 里这句人畜无害的写法：
 *
 * ```ts
 * try { return await req.payload.findByID({ collection: 'buildings', id, req }) }
 * catch { return null }
 * ```
 *
 * 一旦查不到（软删、外键悬空、权限不通），就把调用方那笔 `payload.update`
 * 的事务一并回滚了。更糟的是回滚后 `req.transactionID` 已经没了，
 * `updateByID` 结尾的 `commitTransaction(req)` 拿 `undefined` 去 commit，
 * drizzle 的实现查不到 session **直接 return、不抛错**：
 *
 * ```js
 * // @payloadcms/drizzle/dist/commitTransaction.js
 * if (!this.sessions[transactionID]) { return }
 * ```
 *
 * 净效果：调用方拿到一个字段已更新的 doc、没有任何异常，DB 里什么都没变。
 * 后台点「保存」/「移至回收站」提示成功，刷新后原封不动。
 *
 * 2026-08-31 在本地夹具库实测复现：软删 `west-nanjing-premium-center` 之后，
 * 对其旗下四条房源的 update 全部「成功返回、未落库」；恢复楼盘后全部落库。
 * 触发点是 `domain/public-catalog/supply-cache-hook.ts` 的城市反查。
 *
 * ## 两条护栏
 *
 * 1. `findByIdSafe` / `findSafe` / `findGlobalSafe` 走 `disableErrors: true`——
 *    Payload 在这条路径上**早于 catch 就 return null**，压根不进 `killTransaction`。
 * 2. 万一还是被拆了（别的异常路径、或将来 Payload 改实现），
 *    `assertTransactionIntact` 直接抛错。**宁可让调用方收到 500，
 *    也不能再返回一次假成功**——静默丢数据比报错难查一个数量级。
 *
 * ## 用在哪
 *
 * 任何跑在写入事务里的 hook（beforeChange / afterChange / beforeDelete /
 * afterDelete）里的旁路查询。纯读路径（页面、endpoint 里的 findByID）不需要，
 * 那里没有别人的事务可拆。
 */

import type { CollectionSlug, GlobalSlug, PayloadRequest, Where } from 'payload'

import { DomainError } from './errors'

/**
 * 调用方的写入事务已被回滚，本次写入不会落库。
 *
 * `isOperational: false`：这不是业务可预期错误，是系统缺陷信号，该进 5xx 告警。
 * 对应的 HTTP 状态在 `payload-after-error.ts` 的 `STATUS_BY_CLASS` 里映射成 500。
 */
export class TransactionAbortedError extends DomainError {
  constructor(params: { operation: string; details?: Record<string, unknown> }) {
    super({
      code: 'TRANSACTION_ABORTED',
      status: 500,
      domain: 'system',
      message: '写入事务已被回滚，本次保存未生效',
      isOperational: false,
      details: { operation: params.operation, ...params.details },
    })
  }
}

/** `req.transactionID` 可能是 Promise（Payload 允许），按引用比较即可。 */
function transactionIdOf(req: unknown): unknown {
  return (req as { transactionID?: unknown } | null | undefined)?.transactionID
}

/**
 * 断言 req 上的事务还是进来时那一笔。
 *
 * `captured` 为空表示进来时本就没有事务（脚本 / 纯读路径），不判——那里没有
 * 别人的写入会被连累。
 */
export function assertTransactionIntact(
  req: unknown,
  captured: unknown,
  operation: string,
): void {
  if (captured === undefined || captured === null) return
  if (transactionIdOf(req) === captured) return
  throw new TransactionAbortedError({ operation })
}

export interface FindByIdSafeArgs {
  req: PayloadRequest
  collection: CollectionSlug
  id: number | string
  /** 定位标签，进 TransactionAbortedError.details，便于从日志反查是哪一段拆的事务。 */
  operation: string
  depth?: number
  /** 软删文档是否可见。反查所属城市这类「文档还在、只是被软删」的场景要开。 */
  trash?: boolean
}

/**
 * hook 内的旁路查询：查不到返回 null，且**保证不动调用方的事务**。
 *
 * 替代 `try { req.payload.findByID(...) } catch { return null }`——
 * 那个写法的副作用见本文件头部。
 */
export async function findByIdSafe<T = Record<string, unknown>>(
  args: FindByIdSafeArgs,
): Promise<T | null> {
  const { req, collection, id, operation, depth, trash } = args
  const captured = transactionIdOf(req)

  let doc: unknown = null
  try {
    doc = await req.payload.findByID({
      collection,
      id,
      depth,
      trash,
      // 关键：走这条路径时 Payload 在 catch 之前就 return null，不会 killTransaction
      disableErrors: true,
      req,
    })
  } catch {
    // disableErrors 只挡「查不到」。真出别的异常（权限、DB 故障）时 Payload
    // 已经 killTransaction 过了，下面那句会把它变成一个响亮的错误。
    doc = null
  }

  assertTransactionIntact(req, captured, operation)
  return (doc as T | null) ?? null
}

export interface FindSafeArgs {
  req: PayloadRequest
  collection: CollectionSlug
  where: Where
  /** 定位标签，进 TransactionAbortedError.details，便于从日志反查是哪一段拆的事务。 */
  operation: string
  depth?: number
  limit?: number
  /** 软删文档是否可见。反查引用关系时通常要开：软删的文档照样握着外键。 */
  trash?: boolean
}

/**
 * hook 内的旁路列表查询：出错返回 null，且**保证不动调用方的事务**。
 *
 * 与 `findByIdSafe` 的两点差别：
 *   - 返回 `null` 表示「这次查询没成功」，`[]` 表示「查成功了，没有命中」。
 *     调用方要能区分——把查询失败当成「没有引用」会静默漏掉副作用，
 *     那正是本仓库反复栽跟头的失效形状。
 *   - `find` 的 `disableErrors` 只挡「集合/字段找不到」这类错误，
 *     真出 DB 故障时 Payload 已经 `killTransaction` 过了，由
 *     `assertTransactionIntact` 把它变成一个响亮的错误而不是静默丢写入。
 */
export async function findSafe<T = Record<string, unknown>>(
  args: FindSafeArgs,
): Promise<T[] | null> {
  const { req, collection, where, operation, depth, limit, trash } = args
  const captured = transactionIdOf(req)

  let docs: unknown[] | null = null
  try {
    const result = await req.payload.find({
      collection,
      where,
      depth,
      limit,
      trash,
      overrideAccess: true,
      disableErrors: true,
      req,
    })
    docs = Array.isArray(result?.docs) ? result.docs : []
  } catch {
    docs = null
  }

  assertTransactionIntact(req, captured, operation)
  return docs as T[] | null
}

export interface FindGlobalSafeArgs {
  req: PayloadRequest
  slug: GlobalSlug
  operation: string
  depth?: number
}

/**
 * hook 内的旁路 Global 查询。语义与 `findSafe` 一致：`null` = 查询失败，
 * 而不是「这个 Global 没内容」（从没保存过的 Global 会返回一个空对象）。
 */
export async function findGlobalSafe<T = Record<string, unknown>>(
  args: FindGlobalSafeArgs,
): Promise<T | null> {
  const { req, slug, operation, depth } = args
  const captured = transactionIdOf(req)

  let doc: unknown = null
  try {
    doc = await req.payload.findGlobal({ slug, depth, overrideAccess: true, req })
  } catch {
    doc = null
  }

  assertTransactionIntact(req, captured, operation)
  return (doc as T | null) ?? null
}
