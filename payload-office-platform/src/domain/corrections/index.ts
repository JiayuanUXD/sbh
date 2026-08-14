/**
 * P1 Task 6 信息纠错领域模块入口
 *
 * 模块组成：
 *   - schema：纠错请求白名单校验（类别 7 类、targetType listing/building、description ≤500）
 *   - idempotency：幂等键 sha256(requestId | targetType | targetSlug | category)
 *   - privacy-log：脱敏日志（不含 description 正文、不含原始 IP）
 *   - correction-event-publisher：发布 'correction.created' 到 Outbox
 *   - correction-protect：Collection beforeChange 兜底（create 强制 new、update 事实不可改）
 */

export * from './schema'
export * from './idempotency'
export * from './privacy-log'
export * from './correction-event-publisher'
export * from './correction-protect'
