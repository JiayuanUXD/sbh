/**
 * 流量块与转化漏斗的领域逻辑（OPT-066）
 *
 * 纯逻辑：时间窗解析、漏斗口径、漏报率计算、响应形状。
 * 不碰 HTTP、不碰 Payload，单测直接喂值断言。
 *
 * ## 为什么要有「漏报率」这个指标
 *
 * 埋点会被广告拦截、隐私模式、网络抖动吃掉，这是所有第三方统计方案的共同软肋，
 * 而且**没法自证**——Umami 不知道自己漏了多少。本项目有自己的业务库，
 * 于是可以拿 `leads` 表核对漏斗末环：末环事件数与真实落库线索数的差，
 * 就是埋点漏掉的部分。不信埋点，信线索表。
 */

import { toShanghaiDayStart } from './queries/time-bucket'

// ────────────────────────────────────────────────────────────
// 时间窗
// ────────────────────────────────────────────────────────────

/** 允许的查询窗口。固定枚举，非法值由 endpoint 判 400。 */
export const TRAFFIC_RANGES = ['yesterday', '7d', '30d'] as const
export type TrafficRange = (typeof TRAFFIC_RANGES)[number]

export function isTrafficRange(value: unknown): value is TrafficRange {
  return typeof value === 'string' && (TRAFFIC_RANGES as readonly string[]).includes(value)
}

const DAY_MS = 24 * 60 * 60 * 1000

export interface TrafficWindow {
  /** 窗口起点（含），epoch ms */
  startAt: number
  /** 窗口终点（不含），epoch ms */
  endAt: number
}

/**
 * 解析查询窗口，边界一律按 **Asia/Shanghai 日界**。
 *
 * - `yesterday`：昨天 00:00（北京）起，今天 00:00（北京）止
 * - `7d` / `30d`：**不含今天**，取到今天 00:00 为止的完整 N 天
 *
 * 为什么 7d/30d 不含今天：今天是残缺的一天，混进来会让「近 7 日」的日均被
 * 一个不完整的样本拉低，且每次刷新数字都在变。要看今天的数据用 `yesterday`
 * 之外的入口另说——这里的口径优先保证「同一窗口重复查结果稳定」。
 */
export function resolveTrafficWindow(range: TrafficRange, now: Date): TrafficWindow {
  const todayStart = toShanghaiDayStart(now).getTime()
  switch (range) {
    case 'yesterday':
      return { startAt: todayStart - DAY_MS, endAt: todayStart }
    case '7d':
      return { startAt: todayStart - 7 * DAY_MS, endAt: todayStart }
    case '30d':
      return { startAt: todayStart - 30 * DAY_MS, endAt: todayStart }
  }
}

// ────────────────────────────────────────────────────────────
// 漏斗口径
// ────────────────────────────────────────────────────────────

/**
 * 漏斗四步（按事件量计数，MVP 口径）。
 *
 * ⚠️ **不做会话去重、不校验步骤先后顺序**。所以后一步理论上可能大于前一步
 * （例如同一个人反复提交）。UI 上必须标注「按事件量」，别让人误读成转化人数。
 *
 * 首步刻意**不用** `landing_view`：那个事件只在 /entrust、/publish 两个落地页触发，
 * 与咨询弹窗完全是两条链路，拿它当祖先会把毫不相干的流量算进漏斗口。
 */
export const FUNNEL_STEPS = [
  'city_page_view',
  'inquiry_open',
  'inquiry_submit',
  'inquiry_success',
] as const

/** 首步只计详情页浏览——咨询弹窗的主要入口 */
export const FUNNEL_ENTRY_PAGE_TYPES = ['listing-detail', 'building-detail'] as const

/**
 * 漏报率分母的判据：**哪些线索算「咨询弹窗链路」**。
 *
 * ## 这里与 spec 的原始判据不同，原因如下
 *
 * spec 写的是「`sourcePageType` 非空」，实施第一步的核查（spec 自己要求的）
 * 证明该判据不成立：
 *
 * | 表单 | 提交到 | 写 leads | 打的埋点 |
 * |---|---|---|---|
 * | InquiryModal（咨询弹窗） | `/api/inquiries` | ✅ 五类 pageType | `inquiry_open/submit/success` |
 * | EntrustForm（委托找房） | `/api/inquiries` | ✅ **`pageType='entrust'`** | 只打 `landing_*` |
 * | SupplySubmissionForm（投放房源） | `/api/supply-submissions` | ❌ 不写 leads | `landing_*` |
 *
 * 委托找房也走 `/api/inquiries`、也写 `sourcePageType`，但它**不发
 * `inquiry_success`**。按「非空」计数会把它算进分母而分子里没有它，
 * 漏报率被系统性高估。
 *
 * 故分母改用入口枚举：五类中排除 `entrust`。
 */
export const INQUIRY_FUNNEL_SOURCE_PAGE_TYPES = [
  'home',
  'search',
  'listing',
  'building',
  'content',
] as const

// ────────────────────────────────────────────────────────────
// 漏报率
// ────────────────────────────────────────────────────────────

/**
 * 埋点漏报率 = 1 − 末环事件数 / 真实线索数。
 *
 * 边界（三条都来自 spec §6.3，且各有理由）：
 * - 线索数为 0 → `null`：分母为零，任何数字都是编的，前端显示「—」
 * - 线索数为 null（调用方无权取全量）→ `null`
 * - 计算值 < 0（埋点数**大于**线索数）→ 取 0，并由调用方同时展示两个原始计数。
 *   这种情况是真会发生的：重复提交、同一次咨询触发多次 success、
 *   或跨窗口边界的时序错位。硬报负数只会让人以为看板坏了。
 */
export function computeMissRate(
  successEvents: number,
  leadsInWindow: number | null,
): number | null {
  if (leadsInWindow === null) return null
  if (!Number.isFinite(leadsInWindow) || leadsInWindow <= 0) return null
  if (!Number.isFinite(successEvents) || successEvents < 0) return null
  const rate = 1 - successEvents / leadsInWindow
  return rate < 0 ? 0 : rate
}

// ────────────────────────────────────────────────────────────
// 响应形状（单测与 E2E stub 依此，实施时不得另定）
// ────────────────────────────────────────────────────────────

export interface TrafficSeriesPoint {
  /** 桶起点 ISO（UTC 表示，边界按 Asia/Shanghai 切日） */
  t: string
  pageviews: number
  visitors: number
}

export interface TrafficFunnel {
  /**
   * 详情页浏览（漏斗首步）= `city_page_view` 事件中
   * `page_type ∈ {listing-detail, building-detail}` 的部分。
   *
   * 数据来自 `event-data/values`（契约见 umami-client 的 `eventDataValues`）。
   * **`null` = 该查询失败**，不是 0（「真的没人看详情页」）。
   *
   * 为什么不拿「全部 city_page_view」顶替：那个事件在首页、列表页也打。
   * 线上实测近 7 日 home=7 / listings=2 / building-detail=2 / listing-detail=1
   * ——顶替会让首步从 3 变成 12，转化率看起来低到离谱，而且没人能发现。
   */
  detailView: number | null
  /** 以下三步：事件查询失败时为 null（「没测到」），与 0（「没发生」）含义相反 */
  inquiryOpen: number | null
  inquirySubmit: number | null
  inquirySuccess: number | null
}

export interface TrafficOk {
  status: 'ok'
  pageviews: number
  visitors: number
  series: TrafficSeriesPoint[]
  topReferrers: Array<{ name: string; visitors: number }>
  topPages: Array<{ path: string; pageviews: number }>
  funnel: TrafficFunnel
  /**
   * 窗口内真实线索数。
   *
   * **非 global dataScope 的调用方在服务端就拿到 `null`**，不是「前端隐藏那一行」——
   * 隐藏 UI 不构成权限控制，直接打 API 照样能拿到别人范围内的线索聚合。
   */
  leadsInWindow: number | null
  missRate: number | null
}

/**
 * 流量块不可用的原因（粗粒度，刻意不含任何细节）。
 *
 * - `not-configured`：服务端读不到 UMAMI_* 四项（缺项或值为空）
 * - `upstream-error`：读到了配置，但调用 Umami 失败（不可达 / 凭据不对 / 响应异常）
 *
 * 为什么要把原因回给客户端：本端点已被 `analytics:traffic` 挡过，受众是管理员；
 * 而**没有这个字段时，「没配」和「配了但连不上」在页面上长得一模一样**——
 * OPT-066 上线首日就因此花了很久靠「响应耗时 38ms」这种间接证据倒推。
 *
 * 只回枚举、不回错误原文：原文可能含内部主机名或上游返回的敏感信息，
 * 那些留在服务端日志里。
 */
export type TrafficUnavailableReason = 'not-configured' | 'upstream-error'

export type TrafficBlock = TrafficOk | { status: 'unavailable'; reason: TrafficUnavailableReason }

export interface TrafficResponse {
  ok: true
  asOf: string
  range: TrafficRange
  traffic: TrafficBlock
}
