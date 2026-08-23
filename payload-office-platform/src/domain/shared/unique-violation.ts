/**
 * 唯一约束冲突（SQLSTATE 23505）判定 —— 全仓唯一实现
 *
 * ## 为什么需要这个文件
 *
 * 本项目多处用「先查一次 → 没有就写 → 撞唯一索引说明并发重放 → 按幂等成功处理」
 * 这套软幂等 + DB 兜底的写法（`.agent/supply.md`「幂等键 = sha256(...)，DB 唯一索引兜底」）。
 * 兜底能不能生效，全看 catch 里那句判定认不认得住 23505。
 *
 * 而在本项目实际在跑的 Payload 3.86 + `@payloadcms/db-postgres`(drizzle 3.86) 组合下，
 * `@payloadcms/drizzle/dist/upsertRow/handleUpsertError.js` 会在 upsertRow 的两个 catch
 * （主表 insert 与全部子表写入都被它包住）里，把**所有** 23505 —— 不限于 Payload 自己
 * 认识的 `unique: true` 字段，也包括本项目迁移自建的复合唯一索引、局部唯一索引、
 * 表达式唯一索引 —— 在离开 `create()` / `update()` / `jobs.queue()` 之前就**重新构造**
 * 成一个 `ValidationError`。新对象的 `.cause` 是 `{ id, collection, errors, global }`
 * 这个 results 对象，**不含 `code`**，原始 pg 错误（`code` / `constraint` / `detail`）
 * 已被彻底吞掉。
 *
 * 所以形如 `record.code === '23505'`（逐层查 `error.cause`）的判定对这套适配器**恒为 false**。
 * 真库注入实测（leads / supply_submissions / information_corrections /
 * city_partner_applications / notifications / payload_jobs 六张表逐个验证）拿到的形状：
 *
 * ```
 * ctor=ValidationError  code=undefined  status=400
 * data.errors = [{ message: '值必须是唯一的', path: 'idempotencyKey' | null, tableName: 'leads' }]
 * cause       = { id, collection, errors, global }        ← 没有 code
 * ```
 *
 * ## 判据选择
 *
 * 用 `data.errors[].tableName`，不用 message 正则：
 *   - `tableName` 由适配器直接写入，六张表实测全部存在且准确；
 *   - `message` 走 i18n（本项目默认 zh，实测是「值必须是唯一的」；英文环境是
 *     "Value must be unique"），按文案匹配会随语言配置漂移。
 *
 * `path`（camelCase 字段名）只在**约束名是 Payload 自己生成的**时候才有值：
 *   - `supply_submissions_idempotency_key_idx` / `information_corrections_idempotency_key_idx`
 *     / `city_partner_applications_idempotency_key_idx` → `path='idempotencyKey'`；
 *   - 迁移自建的 `leads_idempotency_key_uniq_idx`（局部索引）、
 *     `eventId_recipient_type_idx`（复合索引）、
 *     `payload_jobs_city_partner_notify_event_active_uq`（局部表达式索引）
 *     → 适配器映射不回字段，`path` 为 `null`。
 * 因此 `path` 只作为**加强**条件：给了就拒绝 path 不同的其它唯一字段，但仍接受 `null`。
 *
 * ## 仍然保留裸 pg 分支的原因
 *
 * `code === '23505'` 的逐层遍历没有删掉：Local API 之外仍有直接走
 * `payload.db` / `executor.execute(sql...)` 的裸 SQL 路径（如
 * `domain/city-partner-application/public-service.ts` 的 `SELECT ... FOR UPDATE`），
 * 那些路径不经过 handleUpsertError，原始 pg 错误会原样冒出来。裸分支沿用各调用点
 * 原有的 marker 收窄（约束名 / detail / message 里必须出现表名或列名），语义不变。
 *
 * ## 使用约定
 *
 * 判定为真**不等于**可以直接当幂等成功返回。调用点应保持「再独立读一次确认目标行确实
 * 存在」的二次校验（`/api/inquiries`、`public-service.ts`、两个通知消费器都是这么做的），
 * 这样即便判定误命中了同表上的其它唯一约束，也不会把无关错误静默吞成幂等成功。
 */

import { ValidationError } from 'payload'

/** 最多向下追多少层 `cause`，与各调用点原实现保持一致。 */
const MAX_CAUSE_DEPTH = 5

export type UniqueViolationMatcher = Readonly<{
  /**
   * 物理表名（snake_case），如 `'leads'`。
   * 既用于匹配 `ValidationError.data.errors[].tableName`，
   * 也用于裸 pg 错误的 marker 收窄。
   */
  tableName: string
  /**
   * 可选：物理列名（snake_case），如 `'idempotency_key'`。
   * 只用于裸 pg 分支——自建索引的约束名常常不含表名
   *（例：`eventId_recipient_type_idx`），列名才是可靠 marker。
   */
  column?: string
  /**
   * 可选：Payload 字段路径（camelCase），如 `'idempotencyKey'`。
   * 给了就要求 `ValidationError` 条目的 `path` 等于它或为 `null`
   *（自建索引映射不回字段时适配器写 `null`），借此排除同表其它唯一字段。
   */
  path?: string
}>

type ValidationErrorEntry = Readonly<{
  message?: unknown
  path?: unknown
  tableName?: unknown
}>

function validationErrorEntries(error: unknown): readonly ValidationErrorEntry[] {
  if (!(error instanceof ValidationError)) return []
  const data = (error as { data?: { errors?: unknown } }).data
  const errors = data?.errors
  return Array.isArray(errors) ? (errors as readonly ValidationErrorEntry[]) : []
}

/** drizzle 适配器把 23505 转成的 ValidationError（本项目实际路径）。 */
function matchesAdapterValidationError(
  error: unknown,
  matcher: UniqueViolationMatcher,
): boolean {
  return validationErrorEntries(error).some((entry) => {
    if (entry.tableName !== matcher.tableName) return false
    if (matcher.path !== undefined && entry.path !== null && entry.path !== matcher.path) return false
    return true
  })
}

/** 未经适配器包装的原始 pg 错误（裸 SQL 路径）。 */
function matchesRawPostgresError(
  error: unknown,
  matcher: UniqueViolationMatcher,
): boolean {
  let candidate: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && candidate && typeof candidate === 'object'; depth += 1) {
    const record = candidate as Record<string, unknown>
    if (record.code === '23505') {
      const marker = [record.constraint, record.detail, record.message]
        .filter((part): part is string => typeof part === 'string')
        .join(' ')
        .toLowerCase()
      if (marker.includes(matcher.tableName)) return true
      if (matcher.column && marker.includes(matcher.column)) return true
    }
    candidate = record.cause
  }
  return false
}

/**
 * 判断 `error` 是否为 `matcher` 指定表上的唯一约束冲突。
 *
 * 两条路径任一命中即为真：
 *   1. drizzle 适配器转换出的 `ValidationError`（本项目 Local API 写入的实际形状）；
 *   2. 未经包装的原始 pg 错误 `code === '23505'`（裸 SQL 路径）。
 */
export function isUniqueViolation(
  error: unknown,
  matcher: UniqueViolationMatcher,
): boolean {
  return matchesAdapterValidationError(error, matcher) || matchesRawPostgresError(error, matcher)
}
