/**
 * 角色化工作台（tasks.md M7.2 / design.md §7.2 / R1, R7）
 *
 * 职责：
 *   - 按 PermissionContext 派生角色工作台类型（管理员/运营 · 销售主管 · 经纪人）
 *   - 每个角色对应一组指标卡编码（ROLE_DASHBOARD_CONFIG）
 *   - 并发解析所有卡片，单卡失败局部标记（status=failed + error）
 *   - 单卡无权限不抛错，标记 status=no-permission
 *   - 单卡下钻 URL 由 metric.drilldown + 按 metric 收窄后的 ctx.filters 派生
 *   - 所有卡片共用同一 asOf，保证一致性（design.md §7.3）
 *
 * 业务不变量：
 *   - 不同角色只看到授权指标和范围（canViewMetric + sanitizeFilters 服务端兜底）
 *   - URL 参数不能扩大数据范围（每张卡按自身 metric.allowedScopeDims 重新 sanitize）
 *   - 单卡失败不影响其他组件（Promise.all + try/catch per card）
 *
 * 注意：本模块不依赖 Payload / React，可独立单测。
 */

import type { PermissionContext } from '@/domain/auth/permission-context'
import { buildDrilldownUrl } from './metric-drilldown'
import { metricRegistry as defaultRegistry, type MetricRegistry } from './metric-registry'
import { sanitizeFilters } from './metric-context'
import type {
  MetricBucket,
  MetricCategory,
  MetricCode,
  MetricDefinition,
  MetricFilterInput,
  MetricPayloadPort,
  MetricQueryContext,
  MetricQueryResult,
  MetricUnit,
} from './metric-types'

// ────────────────────────────────────────────────────────────
// 角色工作台类型
// ────────────────────────────────────────────────────────────

/** 角色化工作台类型（按 design.md §7.2 / tasks.md M7.2） */
export const ROLE_DASHBOARD_TYPES = [
  'admin-ops', // 管理员/运营
  'sales-manager', // 销售主管
  'broker', // 经纪人
] as const
export type RoleDashboardType = (typeof ROLE_DASHBOARD_TYPES)[number]

export function isRoleDashboardType(v: unknown): v is RoleDashboardType {
  return typeof v === 'string' && (ROLE_DASHBOARD_TYPES as readonly string[]).includes(v)
}

// ────────────────────────────────────────────────────────────
// 角色派生
// ────────────────────────────────────────────────────────────

/**
 * 内置角色编码（与 permission-context.BUILTIN_ROLE_CODES 同步）。
 *
 * - ADM：管理员
 * - OPS：运营
 * - MGR：销售主管
 * - BRK：经纪人
 * - CSR：客服（本里程碑无专属工作台，返回 null）
 */
const ROLE_ADM = 'ADM'
const ROLE_OPS = 'OPS'
const ROLE_MGR = 'MGR'
const ROLE_BRK = 'BRK'

/**
 * 从 PermissionContext 派生 RoleDashboardType。
 *
 * 优先级：admin-ops > sales-manager > broker
 * 多角色用户（如 ADM+MGR）按最高优先级返回。
 *
 * @returns null 表示该用户无对应工作台（如纯 CSR 客服）
 */
export function deriveRoleDashboardType(
  permission: PermissionContext,
): RoleDashboardType | null {
  const codes = permission.roleCodes
  if (codes.includes(ROLE_ADM) || codes.includes(ROLE_OPS)) return 'admin-ops'
  if (codes.includes(ROLE_MGR)) return 'sales-manager'
  if (codes.includes(ROLE_BRK)) return 'broker'
  return null
}

// ────────────────────────────────────────────────────────────
// 角色工作台配置
// ────────────────────────────────────────────────────────────

/**
 * 角色工作台配置：每个角色对应的指标卡 code 列表（顺序即展示顺序）。
 *
 * 设计依据（tasks.md M7.2）：
 *   - admin-ops：待审核、今日供给、线索、跟进和超时
 *   - sales-manager：团队线索、待分配、跟进和有效商机
 *   - broker：我的新线索、今日待跟进、超时和推荐次数
 *
 * 卡片编码必须存在于注册表（BUILTIN_METRICS）中；resolveRoleDashboard 内部
 * 通过 registry.require(code) 取定义（不存在 → status=not-found，不抛错）。
 */
export const ROLE_DASHBOARD_CONFIG: Readonly<
  Record<RoleDashboardType, ReadonlyArray<MetricCode>>
> = Object.freeze({
  // 管理员/运营：审核队列 + 全局供给 + 今日线索 + 今日跟进 + 超时 + 举报分诊 + 资质预警
  'admin-ops': Object.freeze([
    'reviews.pending', // 待审核任务
    'listings.pending_review', // 待审核房源
    'supply.effective_count', // 今日有效供给
    'leads.new', // 今日新增线索
    'tasks.today_followup', // 今日待跟进
    'tasks.overdue', // 超时任务
    'reports.pending_triage', // 待分诊举报
    'merchants.qualification_expiring', // 资质即将过期
  ]),
  // 销售主管：团队线索 + 待分配 + 跟进 + 超时 + 有效商机 + 转化率 + 及时率
  'sales-manager': Object.freeze([
    'leads.assigned', // 已分配线索
    'tasks.pending_claim', // 待领取（待分配）
    'tasks.today_followup', // 今日待跟进
    'tasks.overdue', // 超时任务
    'leads.valid', // 有效商机
    'leads.conversion_rate', // 转化率
    'leads.timely_rate', // 及时率
  ]),
  // 经纪人：我的新线索 + 今日待跟进 + 超时 + 推荐率 + 有效线索
  'broker': Object.freeze([
    'leads.new', // 我的新线索
    'tasks.today_followup', // 今日待跟进
    'tasks.overdue', // 超时
    'leads.recommendation_rate', // 推荐率
    'leads.valid', // 有效线索
  ]),
})

// ────────────────────────────────────────────────────────────
// 工作台卡片结果
// ────────────────────────────────────────────────────────────

/** 单卡状态 */
export type DashboardCardStatus =
  | 'success' // 解析成功
  | 'failed' // query 适配器抛错
  | 'no-permission' // 无 metric.requiredPermissions
  | 'not-found' // 注册表中无此 code

/** 单卡结果 */
export interface DashboardCardResult {
  /** 指标编码 */
  code: MetricCode
  /** 显示名（来自 metric.label；not-found 时为 code） */
  label: string
  /** 业务分类（not-found 时为占位 'task'） */
  category: MetricCategory
  /** 单位（not-found 时为占位 'count'） */
  unit: MetricUnit
  /** 卡片状态 */
  status: DashboardCardStatus
  /** 单值结果（status=success 且 result.kind=scalar 时存在） */
  value?: number
  /** 序列结果（status=success 且 result.kind=series 时存在） */
  buckets?: ReadonlyArray<MetricBucket>
  /** 数据截至时间 ISO UTC（status=success 时存在） */
  asOf?: string
  /** 失败原因（status=failed/no-permission/not-found 时存在） */
  error?: string
  /** 下钻 URL（已按 metric.drilldown.filterKeys 拼装，status=success 时存在） */
  drilldownUrl?: string
}

/** 工作台整体结果 */
export interface RoleDashboardResult {
  /** 角色工作台类型（null 表示该用户无对应工作台，cards 为空） */
  type: RoleDashboardType | null
  /** 卡片结果列表（按 ROLE_DASHBOARD_CONFIG 顺序；type=null 时为空数组） */
  cards: DashboardCardResult[]
  /** 工作台生成时刻 ISO UTC（所有卡片共用，便于一致性比对） */
  asOf: string
}

// ────────────────────────────────────────────────────────────
// 工作台基础上下文（endpoint 层构造，未按 metric 收窄）
// ────────────────────────────────────────────────────────────

/**
 * 工作台基础查询上下文。
 *
 * 与 MetricQueryContext 区别：filters 未按特定 metric 收窄。
 * resolveRoleDashboard 内部为每张卡按 metric.allowedScopeDims 重新 sanitize
 * 构造专属 ctx，保证 URL 参数不扩大数据范围。
 */
export interface DashboardBaseContext {
  /** 时间锚点（北京时间） */
  asOf: Date
  /** 调用者权限上下文 */
  permission: PermissionContext
  /** Payload 查询端口 */
  payload: MetricPayloadPort
  /** 客户端过滤输入（不可信，按 metric 收窄） */
  input?: MetricFilterInput | null
}

// ────────────────────────────────────────────────────────────
// 解析工作台
// ────────────────────────────────────────────────────────────

/**
 * 解析角色工作台。
 *
 * 设计要点：
 *   - 单卡失败局部标记：单卡抛错不影响其他卡（Promise.all + try/catch per card）
 *   - 无权限卡：status='no-permission'（registry.resolve 抛 MetricPermissionError）
 *   - 不存在的指标：status='not-found'（registry.require 抛 MetricNotFoundError）
 *   - 单卡按 metric.allowedScopeDims 重新 sanitize → 保证 URL 不扩大数据范围
 *   - 所有卡片共用同一 asOf，保证一致性（design.md §7.3）
 *   - 下钻 URL：由 metric.drilldown + 按 metric 收窄后的 ctx.filters 派生
 *
 * @param type 角色工作台类型（null 时返回空 cards）
 * @param base 基础上下文（asOf + permission + payload + 客户端 input）
 * @param registry 指标注册表（默认单例）
 */
export async function resolveRoleDashboard(
  type: RoleDashboardType | null,
  base: DashboardBaseContext,
  registry: MetricRegistry = defaultRegistry,
): Promise<RoleDashboardResult> {
  const asOf = base.asOf.toISOString()
  if (type === null) {
    return { type: null, cards: [], asOf }
  }
  const codes = ROLE_DASHBOARD_CONFIG[type]
  const cards = await Promise.all(
    codes.map((code) => resolveSingleCard(code, base, registry)),
  )
  return { type, cards, asOf }
}

// ────────────────────────────────────────────────────────────
// 内部辅助
// ────────────────────────────────────────────────────────────

async function resolveSingleCard(
  code: MetricCode,
  base: DashboardBaseContext,
  registry: MetricRegistry,
): Promise<DashboardCardResult> {
  let def: MetricDefinition
  try {
    def = registry.require(code)
  } catch {
    return {
      code,
      label: code,
      category: 'task', // 占位（not-found 时无意义）
      unit: 'count', // 占位
      status: 'not-found',
      error: `Metric not found: ${code}`,
    }
  }

  // 按本 metric.allowedScopeDims 重新 sanitize → 收窄 ctx.filters
  const filters = sanitizeFilters(base.input, base.permission, def)
  const ctx: MetricQueryContext = {
    asOf: base.asOf,
    permission: base.permission,
    filters,
    payload: base.payload,
  }

  try {
    const result = await registry.resolve(code, ctx)
    return buildSuccessCard(def, result, ctx)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isPermission = err instanceof Error && err.name === 'MetricPermissionError'
    return {
      code,
      label: def.label,
      category: def.category,
      unit: def.unit,
      status: isPermission ? 'no-permission' : 'failed',
      error: message,
    }
  }
}

function buildSuccessCard(
  def: MetricDefinition,
  result: MetricQueryResult,
  ctx: MetricQueryContext,
): DashboardCardResult {
  // 派生下钻 URL（已按 metric.drilldown.filterKeys 收窄，仅 sanitize 后字段）
  const drilldown = def.drilldown ? buildDrilldownUrl(def, ctx) : undefined
  const drilldownUrl = drilldown?.url

  if (result.kind === 'scalar') {
    return {
      code: def.code,
      label: def.label,
      category: def.category,
      unit: def.unit,
      status: 'success',
      value: result.value,
      asOf: result.asOf,
      drilldownUrl,
    }
  }
  // series
  return {
    code: def.code,
    label: def.label,
    category: def.category,
    unit: def.unit,
    status: 'success',
    buckets: result.buckets,
    asOf: result.asOf,
    drilldownUrl,
  }
}
