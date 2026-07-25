/**
 * 楼盘主数据纯函数（tasks.md M3.1 / design §3.4 buildings / Requirement R3）
 *
 * 职责：楼盘扩展字段中「固定枚举 + 标签」的单一真源，以及图集上限常量。
 * 无 payload / React 依赖，可独立单测。需要读库或跨文档的校验在 building-protect.ts。
 *
 * 维度区分（design §3.4 列出的 `building_type / grade` 为两个正交维度）：
 *   - `grade`（楼宇等级，历史已存在于 Buildings 集合，M3.1 保留现状不动）
 *   - `buildingType`（物业类型，M3.1 新增独立维度）
 *
 * 启停轴命名说明：design §3.4 的 buildings `status: active | disabled` 与集合里
 * 既有的**发布状态** `status`（draft/published/archived）命名冲突。按已确认决策
 * ①「新增独立启停字段」，这里以 `operationalStatus` 承载启停轴，发布状态保持不动。
 *
 * ⚠️ 值域说明：spec（requirements/design）只给出字段名，未定义 buildingType /
 * verificationStatus / registrationCapability 的具体取值。以下为符合商办平台惯例的
 * 合理默认值域，待产品确认后可调整（AGENTS.md §2：留白采用合理默认并标注）。
 */

/** 图集上限（tasks.md M3.1「图集限制为 20 张并支持排序」）。 */
export const BUILDING_GALLERY_MAX = 20

/** 楼盘启停状态（独立于发布状态，承载 design §3.4 的 active|disabled 轴）。 */
export const BUILDING_OPERATIONAL_STATUSES = ['active', 'disabled'] as const
export type BuildingOperationalStatus = (typeof BUILDING_OPERATIONAL_STATUSES)[number]

export const BUILDING_OPERATIONAL_STATUS_LABELS: Record<BuildingOperationalStatus, string> = {
  active: '启用',
  disabled: '停用',
}

/** 楼盘物业类型（合理默认值域，待产品确认）。 */
export const BUILDING_TYPES = [
  'office_building',
  'business_park',
  'commercial_complex',
  'serviced_office',
] as const
export type BuildingType = (typeof BUILDING_TYPES)[number]

export const BUILDING_TYPE_LABELS: Record<BuildingType, string> = {
  office_building: '写字楼',
  business_park: '商务园区',
  commercial_complex: '商业综合体',
  serviced_office: '服务式办公',
}

/** 楼盘认证状态（合理默认值域,待产品确认）。 */
export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  unverified: '未认证',
  pending: '认证中',
  verified: '已认证',
}

/** 注册能力：能否作为公司注册地址（合理默认值域,待产品确认）。 */
export const REGISTRATION_CAPABILITIES = ['supported', 'conditional', 'not_supported'] as const
export type RegistrationCapability = (typeof REGISTRATION_CAPABILITIES)[number]

export const REGISTRATION_CAPABILITY_LABELS: Record<RegistrationCapability, string> = {
  supported: '支持注册',
  conditional: '有条件支持',
  not_supported: '不支持注册',
}

export function isBuildingOperationalStatus(value: unknown): value is BuildingOperationalStatus {
  return (
    typeof value === 'string' &&
    (BUILDING_OPERATIONAL_STATUSES as readonly string[]).includes(value)
  )
}

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && (BUILDING_TYPES as readonly string[]).includes(value)
}

export function isVerificationStatus(value: unknown): value is VerificationStatus {
  return typeof value === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(value)
}

export function isRegistrationCapability(value: unknown): value is RegistrationCapability {
  return (
    typeof value === 'string' && (REGISTRATION_CAPABILITIES as readonly string[]).includes(value)
  )
}

/**
 * 楼盘是否处于有效供给可用态（供给谓词的楼盘侧判定，design §9/§10）。
 * 仅判断启停轴：operationalStatus === 'active'。
 * 「发布状态」「区域/商户停用」等其他谓词维度由统一供给查询（M4.7）组合，不在此判定。
 */
export function isBuildingOperational(operationalStatus: unknown): boolean {
  return operationalStatus === 'active'
}

/**
 * C 端有效供给谓词的楼盘侧 where 片段（M3.5 / design §9/§10, R3）。
 *
 * 采用正向谓词 `equals: 'active'` 而非 `not_equals: 'disabled'`：与
 * isBuildingOperational 同源、fail-closed（仅显式启用的楼盘对外可见），
 * 停用即从前台查询移除可见性，绝不改写任何 Listing 的审核/发布状态。
 *
 * 两个入口：
 *   - buildingOperationalWhere()        直接查 buildings 集合时用
 *   - listingBuildingOperationalWhere() 经 listing.building 关系子字段过滤时用
 */
export function buildingOperationalWhere(): Record<string, { equals: BuildingOperationalStatus }> {
  return { operationalStatus: { equals: 'active' } }
}

export function listingBuildingOperationalWhere(): Record<
  string,
  { equals: BuildingOperationalStatus }
> {
  return { 'building.operationalStatus': { equals: 'active' } }
}
