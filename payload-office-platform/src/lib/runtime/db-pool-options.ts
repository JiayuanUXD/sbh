/**
 * PostgreSQL 连接池参数（供 `payload.config.ts` 的 postgresAdapter 使用）。
 *
 * 2026-10-13 生产故障（sbh-223/226）：「首页正常、图片与其它页面全部挂死」，
 * 与 2026-08-24 OPT-046 同一指纹——池子被占满，凡是要查库的请求都在排队。
 * 本模块收口三项止损参数，取值理由逐项写在常量上。
 */

type PoolEnv = Readonly<Record<string, string | undefined>>

/**
 * 池上限。node-postgres 默认 10，而 Payload postgres adapter 启动时会永久借走 1 条
 * （`connectWithReconnect`，见 `src/lib/runtime/migrate-lock.ts` 的说明），实际只剩 9 条；
 * 冷首页一次就并发约 10 条查询，再叠加 Jobs 偶发泄漏（被 120s 空闲事务超时回收前一直占着），
 * 9 条没有余量。20 条 × CloudRun 上限 5 实例 = 100，仍在共享 TencentDB 的连接数预算内。
 * 可用 `DB_POOL_MAX` 覆盖。
 */
export const DEFAULT_POOL_MAX = 20

/**
 * 空闲连接回收时间。默认 10s 会让每次流量间歇后都经公网重新建连（含 TLS 握手）；
 * 半开连接已由 pool-error-handler 的 TCP keep-alive 识别，不靠短空闲回收兜底。
 */
export const POOL_IDLE_TIMEOUT_MS = 60_000

/**
 * 事务内空闲上限（OPT-046 止损，原写在 payload.config.ts）。正常事务里两条语句的间隔
 * 远小于 120s；超过就是泄漏，由 PG 主动断开，再由 pool-error-handler 把僵尸连接移出池子。
 */
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 120_000

/** 单条语句超时的下限：低于 1s 几乎必然误杀正常查询，视为配置错误。 */
const MIN_STATEMENT_TIMEOUT_MS = 1_000
const MAX_POOL_SIZE = 100

function parsePositiveInt(name: string, raw: string): number {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`[db-pool-options] ${name} 必须是正整数，实际为 "${raw}"`)
  }
  return Number(trimmed)
}

export function resolvePoolMax(env: PoolEnv): number {
  const raw = env.DB_POOL_MAX
  if (raw === undefined || raw.trim() === '') return DEFAULT_POOL_MAX
  const value = parsePositiveInt('DB_POOL_MAX', raw)
  if (value < 2 || value > MAX_POOL_SIZE) {
    throw new Error(`[db-pool-options] DB_POOL_MAX 必须在 2–${MAX_POOL_SIZE} 之间，实际为 ${value}`)
  }
  return value
}

/**
 * 单条语句超时，**默认不启用**，只由 Dockerfile 在启动 Web 服务那一步注入
 * （`exec env DB_STATEMENT_TIMEOUT_MS=30000 pnpm start`）。
 *
 * 为什么只给 Web 服务：同一份 payload.config 也被容器启动时的迁移进程
 * （`scripts/migrate-locked.ts`）和本地运维脚本加载，迁移里的建索引 / 回填可能远超 30s，
 * 不能被误杀。为什么 Web 需要：查询没有上限时，请求在网关 60s 处超时，
 * 语句却还在 PG 上跑，持续占着连接和共享库 CPU，拖慢后续所有冷查询。
 */
export function resolveStatementTimeoutMs(env: PoolEnv): number | null {
  const raw = env.DB_STATEMENT_TIMEOUT_MS
  if (raw === undefined || raw.trim() === '') return null
  const value = parsePositiveInt('DB_STATEMENT_TIMEOUT_MS', raw)
  if (value < MIN_STATEMENT_TIMEOUT_MS) {
    throw new Error(
      `[db-pool-options] DB_STATEMENT_TIMEOUT_MS 不能小于 ${MIN_STATEMENT_TIMEOUT_MS}，实际为 ${value}`,
    )
  }
  return value
}

/** 拼出 libpq `options` 会话参数（`-c key=value` 空格分隔）。 */
export function buildPgSessionOptions(env: PoolEnv): string {
  const parts = [`-c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`]
  const statementTimeout = resolveStatementTimeoutMs(env)
  if (statementTimeout !== null) parts.push(`-c statement_timeout=${statementTimeout}`)
  return parts.join(' ')
}
