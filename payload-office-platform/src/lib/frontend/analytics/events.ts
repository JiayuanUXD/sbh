/**
 * 埋点事件 schema 与属性脱敏（OPT-010）
 *
 * 设计原则：
 * - 事件名白名单：只允许已知事件，未知事件直接丢弃（防乱埋点）。
 * - 属性白名单：每事件只允许指定 key，多余属性剥离（防 PII 泄漏）。
 * - 值类型校验：只允许 string | number | boolean，对象/数组拒绝（防嵌套注入）。
 * - 字符串截断：单值最长 100 字符（与服务端 inquiry 截断口径一致）。
 *
 * 不采集：姓名、手机号、邮箱、留言、原始 IP、用户输入的自由文本。
 * 当前所有事件属性均为枚举或上下文标记（page_type / target_type / error_code 等），
 * 不含字段值，符合隐私白名单要求。
 */

import { isPublicCitySlug } from '@/lib/frontend/city-routes'

/** 已知事件名与其允许的属性 key 白名单 */
export const ANALYTICS_EVENTS = {
  /** 用户打开咨询弹窗（曝光类，需去重） */
  inquiry_open: ['page_type', 'target_type', 'has_target'],
  /** 用户提交咨询表单 */
  inquiry_submit: ['page_type', 'target_type', 'field_completeness'],
  /** 咨询提交成功 */
  inquiry_success: ['page_type', 'target_type', 'idempotent'],
  /** 咨询提交出错 */
  inquiry_error: ['page_type', 'error_code'],
  /** Web Vitals 指标上报（OPT-018）：metric 枚举、value 数值、rating 评级 */
  web_vital: ['metric', 'value', 'rating'],
  /** 详情画廊中的公开媒体交互。 */
  media_view: ['page_type', 'media_category', 'rank'],
  /** 房源页进入关联楼盘。 */
  listing_building_click: ['listing_id', 'building_id', 'section'],
  /** 房源详情相关推荐点击。 */
  recommendation_click: ['listing_id', 'target_listing_id', 'recommendation_type', 'rank', 'section'],
  /** 楼盘页当前供给筛选；只记录枚举和结果摘要，不记录原始筛选值。 */
  supply_filter: ['building_id', 'supply_group', 'sort', 'price_unit', 'decoration_status', 'result_count', 'as_of', 'filter_completeness'],
  /** 楼盘页楼内房源入口。 */
  building_listing_click: ['building_id', 'listing_id', 'supply_group', 'rank', 'section'],
  /** 楼盘页相关楼盘入口。 */
  related_building_click: ['building_id', 'target_building_id', 'recommendation_type', 'rank', 'section'],
  /** Landing-page exposure. */
  landing_view: ['page_type'],
  /** First interaction with a landing-page form. */
  landing_form_start: ['page_type'],
  /** Valid landing-page submission attempt; values are aggregate/enumerated only. */
  landing_form_submit: ['page_type', 'field_completeness', 'commission_months'],
  /** Successful landing-page submission. */
  landing_form_success: ['page_type'],
  /** Failed landing-page submission with a safe, fixed error code. */
  landing_form_error: ['page_type', 'error_code'],
  /** Landing-page footer CTA click. */
  landing_bottom_cta_click: ['page_type'],
  /** Site-header CTA click on a landing page (scrolls to the page form). */
  landing_header_cta_click: ['page_type'],
  city_partner_application_started: ['city_slug', 'stage'],
  city_partner_application_submitted: ['city_slug', 'stage'],
  city_partner_application_completed: ['city_slug', 'stage'],
  city_switcher_opened: ['city', 'status', 'page_type'],
  city_switched: ['from_city', 'to_city', 'status', 'page_type', 'filters_preserved'],
  coming_soon_cta_clicked: ['city', 'status', 'cta_type'],
  city_page_view: ['city', 'status', 'page_type'],
  city_lead_submitted: ['city', 'status', 'form_type'],
  city_partner_cta_clicked: ['city', 'status'],

  // ── 信息纠错弹窗（OPT-064 修复）──────────────────────────────────────────
  //
  // 这四个事件的埋点从一开始就打在 CorrectionModal 上（7 个调用点），但从没进过
  // 本白名单——validateEvent 判 unknown_event 后 collector 直接丢弃，而丢弃日志
  // 又有 `NODE_ENV !== 'production'` 前置，生产环境连一行线索都不留。
  // 键以调用点实际传入的 props 为准，不是照着猜的。
  /** 用户打开信息纠错弹窗 */
  correction_open: ['target_type', 'has_target'],
  /** 提交纠错表单 */
  correction_submit: ['target_type', 'category'],
  /** 纠错提交成功 */
  correction_success: ['target_type', 'category', 'idempotent'],
  /** 纠错提交失败；error_code 是固定枚举（含 network_error），不是原始错误文本 */
  correction_error: ['target_type', 'error_code'],

  // ── 列表页 / 搜索页（OPT-064 新增）──────────────────────────────────────
  //
  // 转化链路最前端此前是盲区：能看到「打开咨询弹窗 → 提交成功」，看不到
  // 「搜了什么条件 → 看到多少结果 → 点了第几个」。
  //
  // 口径（spec §6.1-7，防实施漂移）：
  //   - filter_completeness = 当前已生效的筛选维度个数（整数 ≥0），不是比率
  //   - rank = 当前页内 1 基序号；跨页靠 page_index 区分
  //   - 去重键 = pathname + 规范化后的筛选/排序/页码 query，翻页与改排序都算新事件
  /** 房源列表页结果呈现（含筛选生效与翻页） */
  listing_search: ['city', 'result_count', 'sort', 'price_unit', 'filter_completeness', 'page_index'],
  /** 房源列表页结果点击 */
  listing_result_click: ['city', 'listing_id', 'rank', 'page_index', 'section'],
  /** 楼盘列表页结果呈现 */
  building_search: ['city', 'result_count', 'sort', 'filter_completeness', 'page_index'],
  /** 楼盘列表页结果点击 */
  building_result_click: ['city', 'building_id', 'rank', 'page_index', 'section'],

  // ── 页面停留与浏览深度（OPT-064 新增）───────────────────────────────────
  //
  // Umami 自己按相邻 pageview 的时间差推算停留时长，会话最后一页恒缺失
  // （upstream issue #3518 未解决），所以这项必须自埋。
  // active_ms 是「增量」不是「累计」：同一次浏览可能上报多条，分析端求和。
  /** 页面活跃停留时长与最大滚动深度 */
  page_engagement: ['page_type', 'active_ms', 'scroll_bucket'],
} as const

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS

/** 单个字符串值最长长度（与服务端 inquiry 截断一致） */
const MAX_VALUE_LENGTH = 100

/** 允许的属性值类型 */
type AllowedValue = string | number | boolean

const CITY_EVENT_NAMES = new Set<string>([
  'city_switcher_opened',
  'city_switched',
  'coming_soon_cta_clicked',
  'city_page_view',
  'city_lead_submitted',
  'city_partner_cta_clicked',
])
const CITY_SERVICE_STATUSES = new Set<AllowedValue>(['live', 'coming-soon'])
const CITY_PAGE_TYPES = new Set<AllowedValue>([
  'home', 'listings', 'listing-detail', 'buildings', 'building-detail',
  'news', 'news-detail', 'privacy', 'page-detail', 'entrust', 'publish', 'city-partner',
])
const CITY_CTA_TYPES = new Set<AllowedValue>(['entrust', 'publish', 'inquiry', 'city-partner'])
const CITY_FORM_TYPES = new Set<AllowedValue>(['entrust', 'publish', 'city-partner'])
function validCitySlug(value: AllowedValue | undefined): value is string {
  return isPublicCitySlug(value)
}

function validCityEventProps(name: string, props: Record<string, AllowedValue>): boolean {
  if (!CITY_EVENT_NAMES.has(name)) return true
  if (name === 'city_switched') {
    return validCitySlug(props.from_city)
      && validCitySlug(props.to_city)
      && CITY_SERVICE_STATUSES.has(props.status ?? '')
      && CITY_PAGE_TYPES.has(props.page_type ?? '')
      && typeof props.filters_preserved === 'boolean'
  }
  if (!validCitySlug(props.city) || !CITY_SERVICE_STATUSES.has(props.status ?? '')) return false
  if (name === 'city_partner_cta_clicked') return true
  if (name === 'coming_soon_cta_clicked') {
    return props.status === 'coming-soon' && CITY_CTA_TYPES.has(props.cta_type ?? '')
  }
  if (name === 'city_lead_submitted') return CITY_FORM_TYPES.has(props.form_type ?? '')
  return CITY_PAGE_TYPES.has(props.page_type ?? '')
}

const PII_PROP_KEY = /(?:^|_)(?:phone|mobile|email|name|note|message|path|url|query|location|latitude|longitude|address|ip)(?:$|_)/i

/**
 * Fails closed when a caller tries to pass a direct identifier, free text, URL,
 * query, or precise location into a detail analytics event. `validateEvent`
 * remains non-throwing for the collector and strips non-allowlisted fields.
 */
export function assertSafeAnalyticsProps(props: Record<string, unknown>): void {
  for (const key of Object.keys(props)) {
    const normalizedKey = key.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/-/g, '_')
    if (PII_PROP_KEY.test(normalizedKey)) {
      throw new Error(`unsafe analytics property: ${key}`)
    }
  }
}

/**
 * 校验并脱敏单个事件。
 * - 未知事件名 -> 丢弃（ok: false）
 * - 属性按白名单剥离 -> 仅保留允许的 key
 * - 值类型校验 -> 非法类型该 key 丢弃
 * - 字符串截断 -> 超长截断
 */
export function validateEvent(
  name: string,
  props: Record<string, unknown>,
): { ok: true; eventName: AnalyticsEventName; sanitized: Record<string, AllowedValue> } | { ok: false; reason: string } {
  const allowedKeys = (ANALYTICS_EVENTS as Record<string, readonly string[]>)[name]
  if (!allowedKeys) {
    return { ok: false, reason: `unknown_event:${name}` }
  }
  const sanitized: Record<string, AllowedValue> = {}
  for (const key of allowedKeys) {
    const v = props[key]
    if (v === undefined || v === null) continue
    if (typeof v === 'string') {
      sanitized[key] = v.slice(0, MAX_VALUE_LENGTH)
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      sanitized[key] = v
    }
    // 对象/数组/函数等非法类型直接丢弃
  }
  if (!validCityEventProps(name, sanitized)) {
    return { ok: false, reason: 'invalid_city_event_props' }
  }
  return { ok: true, eventName: name as AnalyticsEventName, sanitized }
}

/** 序列化属性为稳定字符串（去重 key 用） */
export function serializeProps(props: Record<string, AllowedValue>): string {
  // key 已是白名单内的稳定集合，排序保证同属性不同顺序不产生不同 key
  const keys = Object.keys(props).sort()
  return keys.map((k) => `${k}=${String(props[k])}`).join('&')
}
