/**
 * 给 Payload 的 PostgreSQL 连接池挂一个 `error` 处理器。
 *
 * ## 为什么必须有
 *
 * `node-postgres` 的 `Pool` 继承自 `EventEmitter`，连接出错时会
 * `pool.emit('error', err, client)`（见 `pg-pool/index.js` 的 `idleListener`）。
 * EventEmitter 的约定是：**`'error'` 事件没有监听者就直接 throw**，在 Node 里
 * 等于未捕获异常 → 进程退出 → 容器崩溃重启。
 *
 * 而 `@payloadcms/db-postgres` / `@payloadcms/drizzle` **都没有挂这个处理器**
 *（2026-08-24 全仓 grep 确认）。也就是说在加本文件之前，任何连接级错误
 * ——网络抖动、TencentDB 主备切换、数据库重启、空载事务超时被回收——
 * 都会让整个容器崩掉，而不是丢一条连接、由池子补一条新的。
 *
 * 这是与业务无关的潜伏缺陷，本身就该修；同时它也是
 * `idle_in_transaction_session_timeout`（见 payload.config.ts 的 pool 配置）
 * 能安全启用的前提——那个超时被触发时，PG 正是通过连接级错误通知客户端的。
 *
 * ## 为什么只记日志不做别的
 *
 * `pool.emit('error')` 触发时，pg-pool 已经把该 client 移出池子并关闭了
 *（源码注释：「once the pool emits an error the client has already been closed
 * & purged and is unusable」）。池子会在下次取用时自动补一条新连接，
 * 这里不需要、也不应该做恢复动作——只要不让进程死掉，并把事故留痕。
 */

import type { Payload } from 'payload'

type ClientLike = {
  on?: (event: 'error', listener: (err: Error) => void) => unknown
}

type PoolLike = {
  on?: {
    (event: 'error', listener: (err: Error) => void): unknown
    (event: 'connect', listener: (client: ClientLike) => void): unknown
  }
}

/** 幂等标记：`getPayload` 是单例，但热重载 / 多次 init 时不重复挂。 */
const ATTACHED = Symbol.for('sbh.poolErrorHandlerAttached')

export function attachPoolErrorHandler(payload: Payload): void {
  const db = payload.db as unknown as { pool?: PoolLike } | undefined
  const pool = db?.pool
  if (!pool || typeof pool.on !== 'function') return

  const marked = pool as PoolLike & { [ATTACHED]?: boolean }
  if (marked[ATTACHED]) return
  marked[ATTACHED] = true

  const log = (scope: 'pool' | 'client') => (err: Error) => {
    // 固定、不含 PII 的错误文本；连接串与参数一律不进日志。
    payload.logger.error(
      {
        errorCode: 'pg_pool_client_error',
        scope,
        message: err.message,
        // 空载事务超时是 25P03，单独标出来便于和 OPT-046 的泄漏问题对账
        pgCode: (err as { code?: string }).code ?? null,
      },
      'pg_pool_client_error',
    )
  }

  // ① 池内空闲连接出错 → pg-pool 的 idleListener 把它 emit 到 pool 上。
  pool.on('error', log('pool'))

  // ② 已借出但被遗弃的连接出错 → 错误 emit 在 **Client** 实例上，**不经过 pool**。
  //
  // 这条是 2026-08-24 多进程复现实测补上的：OPT-046 的泄漏连接正是「借出后再没归还」，
  // 被 idle_in_transaction_session_timeout 回收时报 25P03，而当时只挂了 ① 的版本
  // **一次都没触发**，三个复现进程全部以 `throw er; // Unhandled 'error' event` 崩溃。
  //
  // 也就是说：只加超时 + 只挂 pool 处理器，会把「连接池被泄漏拖垮」换成
  // 「每回收一次崩一次容器」——更糟。两条监听必须同时存在。
  //
  // 只要 Client 上有 ≥1 个 'error' 监听者，Node 就不会因未处理事件退出；
  // 借用方自己的 try/catch 照常收到 query 层面的 rejection，不受影响。
  pool.on('connect', (client: ClientLike) => {
    if (!client || typeof client.on !== 'function') return
    const c = client as ClientLike & { [ATTACHED]?: boolean }
    if (c[ATTACHED]) return
    c[ATTACHED] = true
    client.on('error', log('client'))
  })
}
