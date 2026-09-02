/**
 * `/api/overview` 响应 → 视图模型（OPT-065）
 *
 * 纯逻辑、不碰 React 与 DOM，单测直接喂 JSON 断言。
 *
 * ## 为什么要一层解析，而不是把 `await res.json()` 直接摊给组件
 *
 * 服务端的单卡失败隔离（`resolveSingleCard`）已经把每张卡的 `status` 算好了，
 * 客户端**必须把失败的卡照样渲染成占位**，不能过滤掉——
 * 一旦过滤，「这个指标查询炸了」和「这个指标压根不存在」在页面上长得一模一样，
 * 而它们该做的处置完全不同（前者报障，后者是配置问题）。
 *
 * 所以这里只做形状校验与归一，不丢任何一张卡。
 */

import type { MetricBucket, MetricUnit } from '@/domain/analytics/metric-types'
import { isMetricUnit } from '@/domain/analytics/metric-types'

/** 与 `DashboardCardStatus` 同集合；此处独立声明，避免客户端 bundle 拖进整个 role-dashboard */
export const OVERVIEW_CARD_STATUSES = [
  'success',
  'failed',
  'no-permission',
  'not-found',
] as const

export type OverviewCardStatus = (typeof OVERVIEW_CARD_STATUSES)[number]

function isCardStatus(v: unknown): v is OverviewCardStatus {
  return typeof v === 'string' && (OVERVIEW_CARD_STATUSES as readonly string[]).includes(v)
}

/** 归一后的单卡视图模型：可选字段一律落成 null / []，组件里不必再判 undefined */
export interface OverviewCardView {
  code: string
  label: string
  unit: MetricUnit
  status: OverviewCardStatus
  value: number | null
  buckets: readonly MetricBucket[]
  drilldownUrl: string | null
  error: string | null
}

export interface OverviewViewModel {
  cards: OverviewCardView[]
  trends: OverviewCardView[]
  distributions: OverviewCardView[]
  asOf: string
}

export type OverviewParseResult =
  | { ok: true; data: OverviewViewModel }
  | { ok: false; reason: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toBucket(raw: unknown): MetricBucket | null {
  if (!isRecord(raw)) return null
  const { label, value, metadata } = raw
  if (typeof label !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return isRecord(metadata) ? { label, value, metadata } : { label, value }
}

/**
 * 归一单卡。
 *
 * 形状不合法（缺 code / status 非法）返回 null，由调用方决定是整体判失败还是跳过。
 * 这里刻意**不**给 status 兜底成 'failed'：那会把「后端字段改名了」伪装成
 * 「这个指标查询失败了」，把契约问题掩盖成运行时问题。
 */
export function toCardView(raw: unknown): OverviewCardView | null {
  if (!isRecord(raw)) return null
  const { code, label, unit, status, value, buckets, drilldownUrl, error } = raw
  if (typeof code !== 'string' || code.length === 0) return null
  if (!isCardStatus(status)) return null

  return {
    code,
    label: typeof label === 'string' && label.length > 0 ? label : code,
    unit: isMetricUnit(unit) ? unit : 'count',
    status,
    value: typeof value === 'number' && Number.isFinite(value) ? value : null,
    buckets: Array.isArray(buckets)
      ? buckets.map(toBucket).filter((b): b is MetricBucket => b !== null)
      : [],
    drilldownUrl: typeof drilldownUrl === 'string' && drilldownUrl.length > 0 ? drilldownUrl : null,
    error: typeof error === 'string' && error.length > 0 ? error : null,
  }
}

function toGroup(raw: unknown): OverviewCardView[] {
  if (!Array.isArray(raw)) return []
  return raw.map(toCardView).filter((c): c is OverviewCardView => c !== null)
}

/**
 * 解析 `/api/overview` 的响应体。
 *
 * 只要求 `ok === true` 且 `asOf` 是非空字符串；三个分组各自缺失时退化为空数组，
 * 而不是整体判失败——服务端本就允许某一组整体失败，页面该显示「这组没有数据」，
 * 不该因此整页报错。
 */
export function parseOverviewPayload(raw: unknown): OverviewParseResult {
  if (!isRecord(raw)) return { ok: false, reason: '响应不是对象' }
  if (raw.ok !== true) {
    const err = typeof raw.error === 'string' && raw.error.length > 0 ? raw.error : '服务端返回失败'
    return { ok: false, reason: err }
  }
  if (typeof raw.asOf !== 'string' || raw.asOf.length === 0) {
    return { ok: false, reason: '响应缺少 asOf' }
  }

  return {
    ok: true,
    data: {
      cards: toGroup(raw.cards),
      trends: toGroup(raw.trends),
      distributions: toGroup(raw.distributions),
      asOf: raw.asOf,
    },
  }
}

// ────────────────────────────────────────────────────────────
// 展示格式化
// ────────────────────────────────────────────────────────────

/** 按单位格式化指标值。null（无值）统一显示为 `—`，与「值为 0」区分开。 */
export function formatMetricValue(value: number | null, unit: MetricUnit): string {
  if (value === null) return '—'
  switch (unit) {
    case 'rate':
      return `${(value * 100).toFixed(1)}%`
    case 'percent':
      return `${value.toFixed(1)}%`
    case 'duration_ms':
      return value >= 60_000
        ? `${(value / 60_000).toFixed(1)} 分钟`
        : `${(value / 1000).toFixed(1)} 秒`
    case 'currency_cny':
      // 后端以「分」存储
      return `¥${(value / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
    case 'count':
    default:
      return value.toLocaleString('zh-CN')
  }
}

/**
 * 降级卡的说明文案。
 *
 * 三种非成功状态各自对应完全不同的处置，所以文案必须能区分开：
 * 查询炸了要报障，没权限要找管理员，注册表里没有则是配置问题。
 */
export function cardStatusHint(card: OverviewCardView): string | null {
  switch (card.status) {
    case 'success':
      return null
    case 'failed':
      return card.error ? `查询失败：${card.error}` : '查询失败'
    case 'no-permission':
      return '当前账号无此指标权限'
    case 'not-found':
      return '指标未注册（配置问题，请联系管理员）'
    default:
      return null
  }
}

/** `asOf` 转本地可读文案；不可解析时原样返回，不假装成一个时间。 */
export function formatAsOf(asOf: string): string {
  const d = new Date(asOf)
  if (Number.isNaN(d.getTime())) return asOf
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** 分组内成功卡的最大桶值，供手绘条形图归一（全为 0 或无桶时返回 0） */
export function maxBucketValue(card: OverviewCardView): number {
  let max = 0
  for (const b of card.buckets) {
    if (b.value > max) max = b.value
  }
  return max
}
