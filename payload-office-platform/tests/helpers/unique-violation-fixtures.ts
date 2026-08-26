/**
 * 唯一约束冲突错误的**真实**形状 fixture
 *
 * 这些形状不是推演出来的，是 2026-08-23 在本地 PostgreSQL 真库上注入冲突、
 * 走一次真实 `payload.create()` / `payload.jobs.queue()` 后打印下来的。
 *
 * 之所以专门抽这个 fixture：本仓库此前多个测试用
 * `Object.assign(new Error('duplicate key'), { code: '23505' })` 伪造冲突错误，
 * 而 `@payloadcms/drizzle` 的 `upsertRow/handleUpsertError.js` 实际上会把所有
 * 23505 重新构造成 `ValidationError`（`.cause` 里没有 `code`）。伪造的形状让
 * 「23505 → 幂等成功」的兜底测试常绿，真实路径却从来没被触发过——六处调用点
 * 的兜底因此死了很久没人发现。测试再造这种形状就等于再埋一次同样的雷。
 *
 * 六张表真库实测：`tableName` 全部存在且准确；`path` 只在约束名是 Payload 自己
 * 生成时才有值（`unique: true` 字段），迁移自建的复合 / 局部 / 表达式唯一索引
 * 一律为 `null`。
 */

import { ValidationError } from 'payload'

/**
 * 适配器转换后的形状（Local API 写入撞唯一索引时**实际**抛出的东西）。
 *
 * @param collection Payload collection slug，如 `'leads'`
 * @param tableName  物理表名，如 `'leads'`
 * @param path       Payload 能把约束名映射回字段时的字段名；自建索引传 `null`
 */
export function adapterUniqueViolation(
  collection: string,
  tableName: string,
  path: string | null,
): ValidationError {
  return new ValidationError({
    collection,
    errors: [{
      // 本项目 i18n 默认 zh，实测就是这句；英文环境是 'Value must be unique'。
      // 判定不依赖文案，这里保留真实值只是为了 fixture 忠实。
      message: '值必须是唯一的',
      path,
      tableName,
    } as never],
  })
}

/**
 * 未经适配器包装的原始 pg 错误形状（裸 SQL 路径才会出现）。
 * 真实 pg 唯一冲突一定带 `constraint` 与 `detail`，fixture 必须一起给，
 * 否则测出来的是一个现实中不存在的错误。
 */
export function rawPostgresUniqueViolation(
  constraint: string,
  detail: string,
): Error & { code: string; constraint: string; detail: string } {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
    detail,
  })
}

/** leads：迁移自建局部唯一索引 `leads_idempotency_key_uniq_idx`，path 实测为 null。 */
export const leadsUniqueViolation = (): ValidationError =>
  adapterUniqueViolation('leads', 'leads', null)

/** supply_submissions：Payload 生成的 `unique: true` 索引，path 实测为 'idempotencyKey'。 */
export const supplySubmissionUniqueViolation = (): ValidationError =>
  adapterUniqueViolation('supply-submissions', 'supply_submissions', 'idempotencyKey')

/** information_corrections：同上。 */
export const correctionUniqueViolation = (): ValidationError =>
  adapterUniqueViolation('information-corrections', 'information_corrections', 'idempotencyKey')

/** city_partner_applications：同上。 */
export const cityPartnerUniqueViolation = (): ValidationError =>
  adapterUniqueViolation('city-partner-applications', 'city_partner_applications', 'idempotencyKey')

/** notifications：复合唯一索引 `eventId_recipient_type_idx`，path 实测为 null。 */
export const notificationUniqueViolation = (): ValidationError =>
  adapterUniqueViolation('notifications', 'notifications', null)

/** payload_jobs：局部表达式唯一索引，path 实测为 null。 */
export const payloadJobUniqueViolation = (): ValidationError =>
  adapterUniqueViolation('payload-jobs', 'payload_jobs', null)
