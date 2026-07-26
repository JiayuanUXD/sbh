/**
 * 领域：房源举报（domain/report）
 *
 * 职责边界（AGENTS.md §4, §5.2, §10, tasks.md M6.1-M6.2）：
 *   - 举报原因、证据、处理状态、处理阶段版本、负责人、结论
 *   - 状态机：分诊 → 领取 → 核实 → 等待资料 → 提交复核 → 关闭
 *   - 有效举报暂停只影响统一有效供给谓词（report-supply-effect）
 *   - 不改写审核状态和发布状态（业务不变量）
 *   - 恢复和关闭要求权限、原因和审计
 *   - 跨对象副作用使用事务 Outbox（M6.3 未实现，预留事件钩子）
 *
 * 模块导出：
 *   - report-status：状态 / 结论 / 原因枚举与守卫
 *   - report-transition：状态转换服务（校验合法转换、生成版本号）
 *   - report-supply-effect：供给暂停副作用推导（M6.2 复用）
 *   - report-protect：Collection beforeChange hook 与权限守卫
 */
export const DOMAIN_TAG = 'report' as const

export * from './report-status'
export * from './report-transition'
export * from './report-supply-effect'
export * from './report-protect'
