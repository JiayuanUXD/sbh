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
} as const

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS

/** 单个字符串值最长长度（与服务端 inquiry 截断一致） */
const MAX_VALUE_LENGTH = 100

/** 允许的属性值类型 */
type AllowedValue = string | number | boolean

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
  return { ok: true, eventName: name as AnalyticsEventName, sanitized }
}

/** 序列化属性为稳定字符串（去重 key 用） */
export function serializeProps(props: Record<string, AllowedValue>): string {
  // key 已是白名单内的稳定集合，排序保证同属性不同顺序不产生不同 key
  const keys = Object.keys(props).sort()
  return keys.map((k) => `${k}=${String(props[k])}`).join('&')
}
