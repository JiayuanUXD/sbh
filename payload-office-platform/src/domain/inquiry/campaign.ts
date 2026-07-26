/**
 * F5 询盘活动归因白名单化
 *
 * 设计依据：specs/frontend-mvp/design.md §10.1 / §12.2、FP-05 §2
 *
 * 守护不变量：
 *   - 仅允许 utm_source / utm_medium / utm_campaign / utm_content / utm_term 五个键
 *   - 每个键值长度 ≤ 100 字符（CAMPAIGN_VALUE_MAX）
 *   - 非字符串值拒绝（防止对象注入）
 *   - 缺失或空对象 → 返回空 attribution（合法）
 *   - UTM 参数不包含个人信息（前台在采集前已剥离）
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

/** 单个 UTM 参数值最大长度（与 schema.ts LIMITS.CAMPAIGN_VALUE_MAX 保持一致） */
export const CAMPAIGN_VALUE_MAX = 100

/** 允许的 UTM 参数键白名单 */
export const CAMPAIGN_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const
export type CampaignKey = (typeof CAMPAIGN_KEYS)[number]

/** 白名单化后的活动归因（值可能为空字符串） */
export type CampaignAttribution = Readonly<Record<CampaignKey, string>>

export type CampaignResult =
  | { ok: true; data: CampaignAttribution }
  | { ok: false }

/**
 * 把 unknown 输入白名单化为 CampaignAttribution。
 *
 * - 非对象 / null / undefined → 返回空 attribution（合法）
 * - 含非白名单键 → 忽略
 * - 含非字符串值 → 拒绝（campaign_invalid）
 * - 字符串值超长 → 拒绝
 * - 字符串值前后空格 → trim
 */
export function sanitizeCampaign(input: unknown): CampaignResult {
  // 缺失或 null/undefined → 空 attribution
  if (input == null) {
    return { ok: true, data: emptyCampaign() }
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false }
  }

  const obj = input as Record<string, unknown>
  const result: Record<CampaignKey, string> = emptyCampaign()

  for (const key of CAMPAIGN_KEYS) {
    const raw = obj[key]
    if (raw == null) continue
    if (typeof raw !== 'string') {
      return { ok: false }
    }
    const trimmed = raw.trim()
    if (trimmed.length > CAMPAIGN_VALUE_MAX) {
      return { ok: false }
    }
    result[key] = trimmed
  }

  // 检查是否含非白名单键（防注入）：实际上我们对未知键直接忽略，不报错
  // 但如包含非字符串值（如对象、数组），上面的循环已拒绝

  return { ok: true, data: result }
}

function emptyCampaign(): Record<CampaignKey, string> {
  return {
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_content: '',
    utm_term: '',
  }
}
