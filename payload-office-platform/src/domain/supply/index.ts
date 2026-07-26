/**
 * 领域：商户、楼盘、房源和有效供给（domain/supply）
 *
 * 职责边界（AGENTS.md §4, §5.1, §5.2, tasks.md M2-M4）：
 *   - 商户（Merchant）：类型、联系人、服务城市、状态、资质有效期
 *   - 楼盘（Building）：城市、启停、类型、竣工时间、楼层、物业、停车位、版本号
 *   - 房源（Listing）：独立 publication_status / review_status / supply_visibility_hold
 *   - Building / Listing 与商户的有效期关系（[start, end) 语义）
 *   - 统一有效供给查询：前台、预览、楼盘聚合、看板共用
 *
 * 业务不变量（AGENTS.md §5.1, §5.2）：
 *   - 房源三状态独立，禁止合并为组合状态
 *   - 审核通过不自动上架；只有显式发布动作才能上架
 *   - 楼盘 / 区域 / 商户停用只影响有效供给谓词，不改写审核或发布状态
 *
 * M2.4 已实施：Merchant 商户主数据（类型/联系人/服务城市/状态/资质有效期）
 *   + 服务城市校验、资质一致性、停用影响保护。
 * 有效供给查询服务将在 M4.7 实现。
 */
export const DOMAIN_TAG = 'supply' as const

export * from './merchant'
export { protectMerchant } from './merchant-protect'
export { protectMerchantStop } from './merchant-stop-guard'
export { countMerchantReferences } from './merchant-references'
export type { MerchantReferenceReport, MerchantReferenceSource } from './merchant-references'

export * from './building'
export { protectBuilding } from './building-protect'
export { countBuildingDeactivationImpact } from './building-references'
export type {
  BuildingDeactivationImpactReport,
  BuildingReferenceSource,
} from './building-references'
export { computeBuildingSupplyAggregate } from './building-aggregate'
export type { BuildingSupplyAggregate, BuildingRentRange } from './building-aggregate'
