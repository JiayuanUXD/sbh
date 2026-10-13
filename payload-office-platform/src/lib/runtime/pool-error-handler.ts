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
 * `idle_in_transaction_session_timeout`（见 db-pool-options.ts）
 * 能安全启用的前提——那个超时被触发时，PG 正是通过连接级错误通知客户端的。
 *
 * ## 为什么池级错误只记日志，而借出连接错误还要兜底 `release(err)`
 *
 * - 空闲连接：`pool.emit('error')` 触发时，pg-pool 的 `idleListener` 已经把该
 *   client 移出池子并关闭了（源码注释：「once the pool emits an error the client
 *   has already been closed & purged and is unusable」）。
 * - 借出连接：pg-pool 在 `_acquireClient` 时会 `removeListener('error', idleListener)`，
 *   把移除职责交给借用方的 `client.release(err)`。如果连接是因事务泄漏被遗弃后触发
 *   `25P03`（`idle_in_transaction_session_timeout`），借用方早已丢失引用、永远不会
 *   调 `release(err)`；若这里只记日志不调 `client.release(err)`，死连接会永久留在
 *   `pool._clients` 里占住配额，攒够 `max`（默认 10）条后池子彻底僵死。
 */

import type { Payload } from 'payload'

type ClientLike = {
  on?: (event: 'error', listener: (err: Error) => void) => unknown
  release?: (err?: Error | boolean) => void
  connection?: {
    stream?: {
      setKeepAlive?: (enable?: boolean, initialDelay?: number) => unknown
    }
  }
}

type PoolOptionsLike = {
  keepAlive?: boolean
  keepAliveInitialDelayMillis?: number
  connectionTimeoutMillis?: number
}

type PoolLike = {
  options?: PoolOptionsLike
  _clients?: ClientLike[]
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

  // 公网 TencentDB 经 NAT 网关连接时，长时间无流量的 TCP 连接可能被中间设备静默丢弃；
  // 开启 TCP Keep-Alive（10s 起探）让 OS 及时识别半开连接并触发 error 回收，
  // 配合 connectionTimeoutMillis 避免池满或建连异常时请求无限挂起。
  if (pool.options && typeof pool.options === 'object') {
    pool.options.keepAlive ??= true
    pool.options.keepAliveInitialDelayMillis ??= 10_000
    pool.options.connectionTimeoutMillis ??= 10_000
  }

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
  // 只要 Client 上有 ≥1 个 'error' 监听者，Node 就不会因未处理事件退出；
  // 同时用 queueMicrotask 兜底调用 `client.release(err)`，确保被遗弃的借出连接
  // 触发 pg-pool 的 `_remove(client)` + `_pulseQueue()`，不会变成僵尸连接占满池配额。
  const attachClient = (client: ClientLike) => {
    if (!client || typeof client.on !== 'function') return
    const c = client as ClientLike & { [ATTACHED]?: boolean }
    if (c[ATTACHED]) return
    c[ATTACHED] = true
    client.connection?.stream?.setKeepAlive?.(true, 10_000)
    client.on('error', (err: Error) => {
      log('client')(err)
      queueMicrotask(() => {
        try {
          client.release?.(err)
        } catch {
          // 若借用方已同步归还连接，pg-pool 的 throwOnDoubleRelease 会抛错，此处安全忽略
        }
      })
    })
  }

  if (Array.isArray(pool._clients)) {
    for (const existingClient of pool._clients) {
      attachClient(existingClient)
    }
  }

  pool.on('connect', attachClient)
}
