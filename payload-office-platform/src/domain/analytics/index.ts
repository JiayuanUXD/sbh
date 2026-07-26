/**
 * 领域：指标注册、查询上下文和下钻（domain/analytics）
 *
 * 职责边界（AGENTS.md §4, §5.2, tasks.md M7）：
 *   - 指标注册表：编码 / 公式 / 去重 / 时间 / 权限 / 缓存 / 下钻模板
 *   - 禁止页面独立拼装指标条件
 *   - 工作台、经营概览、房源分析、线索分析复用同一指标定义
 *   - 单卡失败局部重试并展示数据截至时间
 *
 * 业务不变量：
 *   - 卡片 = 趋势桶之和
 *   - 卡片 = 图表点击 = 明细数量
 *   - URL 参数不能扩大数据范围
 *
 * 模块导出：
 *   - metric-types：核心类型与枚举守卫（M7.1）
 *   - metric-context：sanitizeFilters 过滤清洗 + canViewMetric 权限校验（M7.1）
 *   - metric-registry：MetricRegistry 注册表 + 单例 metricRegistry（M7.1）
 *   - metric-drilldown：buildDrilldownUrl 下钻 URL 生成（M7.1）
 *   - metric-consistency：卡片=序列和 / URL 不扩大范围断言（M7.1，M7.6 集成测试复用）
 *   - metrics/builtin：注册全部内置指标元数据（M7.1 stub，M7.3-M7.5 替换真实查询）
 */
export const DOMAIN_TAG = 'analytics' as const

export * from './metric-types'
export * from './metric-context'
export * from './metric-registry'
export * from './metric-drilldown'
export * from './metric-consistency'
