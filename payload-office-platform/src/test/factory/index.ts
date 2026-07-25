/**
 * 测试数据工厂
 *
 * 设计原则：
 *   - 纯 TypeScript fixtures：M0 阶段不写数据库，仅产出类型化的测试数据
 *   - 业务不变量对齐 AGENTS.md §5：状态独立、有效期 [start, end)、手机号规范化
 *   - 时间冻结：所有时间默认以 Asia/Shanghai 自然日为锚点，便于 SLA 边界测试
 *   - 覆盖 5 角色基线（AGENTS.md §6）：ADM / OPS / MGR / BRK / CSR
 *
 * 后续里程碑使用方式：
 *   - 单元测试：直接 import fixture，断言业务规则
 *   - E2E 测试：通过 seed 脚本将 fixture 写入测试数据库
 *   - 集成测试：组合多个 factory 构造端到端场景
 *
 * 当前限制：
 *   - M1+ 才有真实的 roles / teams / merchants / listings_states Collection
 *   - 本阶段 fixture 字段对齐 tasks.md M1-M8 计划，但落库需等对应 Collection 就绪
 */
export * from './roles'
export * from './teams'
export * from './merchants'
export * from './listings'
export * from './time'
export * from './validity'
