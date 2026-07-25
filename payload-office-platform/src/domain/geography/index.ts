/**
 * 领域：城市、区域、商圈、线路和站点（domain/geography）
 *
 * 职责边界（AGENTS.md §4, tasks.md M2）：
 *   - 统一地理节点：城市 / 行政区 / 商圈 / 地铁线路 / 地铁站
 *   - 不可变编码、启停、前台可见、中心坐标、版本号
 *   - 商圈扩展：边界、扩展中心、别名、同城站点关系
 *   - 固定层级（不允许跨层级移动到非法类型）
 *
 * M2 实施清单：
 *   - 扩展 Locations 字段
 *   - 城市区域 Custom View（树形浏览 / 移动 / 排序 / 引用数量）
 *   - 商圈扩展 Collection
 *   - 停用语义：历史对象仍可展示
 *
 * M2.1 已实施：Locations 统一地理节点（固定层级 / 不可变编码 / 启停 / 前台可见 / 坐标 / 版本）。
 */
export const DOMAIN_TAG = 'geography' as const

export * from './location-hierarchy'
export { protectLocation } from './location-protect'
