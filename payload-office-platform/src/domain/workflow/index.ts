/**
 * 领域：事件、待办、通知和 SLA（domain/workflow）
 *
 * 职责边界（AGENTS.md §4, §10, tasks.md M6.3-M6.7）：
 *   - 事务 Outbox（Domain Events）
 *   - 待办注册表（来源 / 取消 / 自动闭环）
 *   - SLA 扫描任务（首次跟进 / 公海回收 / 30 天房源维护）
 *   - 站内通知（与业务状态解耦，失败可重试）
 *
 * 业务不变量（AGENTS.md §10）：
 *   - 跨对象副作用使用事务 Outbox
 *   - 领域事件必须有稳定 event_id、聚合 ID 和聚合版本
 *   - 消费器必须幂等，重复投递不能生成重复待办 / 通知 / 审计
 *   - 待办由来源业务事件完成或取消，不允许只在待办页手工标记完成
 *   - 高风险操作的业务写入、事件和审计必须位于同一事务或可靠编排中
 *
 * 模块导出：
 *   - event-types：事件类型 / 聚合类型枚举与守卫（M6.3）
 *   - event-publisher：publishEvent 纯函数 + buildEventId（M6.3）
 *   - event-consumer：EventConsumer 接口 + EventDispatcher 幂等分发器（M6.3）
 *   - workflow-protect：Collection beforeChange hook 与权限守卫（M6.3）
 *
 * 待实现（M6.4-M6.7）：
 *   - todos：待办模型与注册表
 *   - notifications：站内通知
 *   - sla-scanner：SLA 扫描任务
 */
export const DOMAIN_TAG = 'workflow' as const

export * from './event-types'
export * from './event-publisher'
export * from './event-consumer'
export * from './workflow-protect'
