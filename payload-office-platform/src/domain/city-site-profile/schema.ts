export const CITY_SERVICE_STATUSES = ['live', 'coming-soon'] as const

export type CityServiceStatus = (typeof CITY_SERVICE_STATUSES)[number]

export type CityProfileSeoField = 'description' | 'title'

const CITY_PROFILE_SEO_LENGTHS = {
  description: { minimum: 70, maximum: 160 },
  title: { minimum: 1, maximum: 60 },
} as const

export function isCityServiceStatus(value: unknown): value is CityServiceStatus {
  return value === 'live' || value === 'coming-soon'
}

/**
 * Public Chinese city copy uses the short display name. A single terminal 市 is
 * removed deterministically; other names, including 上海, remain unchanged.
 */
export function normalizeCityDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (normalized.length === 0) return null
  if (!normalized.endsWith('市')) return normalized
  const withoutCitySuffix = normalized.slice(0, -1).trim()
  return withoutCitySuffix.length > 0 ? withoutCitySuffix : null
}

export function hasValidCityProfileSeoLength(
  value: unknown,
  field: CityProfileSeoField,
): value is string {
  if (typeof value !== 'string') return false
  const limits = CITY_PROFILE_SEO_LENGTHS[field]
  return value.length >= limits.minimum && value.length <= limits.maximum
}

export function isValidCityProfileSeoText(
  value: unknown,
  field: CityProfileSeoField,
  cityDisplayName: string,
): value is string {
  return hasValidCityProfileSeoLength(value, field) && value.includes(cityDisplayName)
}

/** 数据带「平均响应」运营承诺口径：0 < h ≤ 72，保留一位小数；其余一律 null（首页不渲染该格）。 */
export function normalizeAvgResponseHours(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value * 10) / 10
  if (rounded <= 0 || rounded > 72) return null
  return rounded
}

/**
 * 首页「热门商圈」显示张数（OPT-073）。
 *
 * 只有 3 和 5 两档：`HomeDistrictBento` 的布局只有这两种形态，别的数字没有落脚点。
 * 后台存的是 select 的字符串，历史行与意外值都可能出现，故一律收敛：
 * **只有明确的 3 才是 3，其余全部回落 5**——5 是本特性上线前的写死值，
 * 回落到它等于「配置没生效时保持现状」，而不是把首页改成另一副样子。
 *
 * 后台那份字符串档位（`'5'` / `'3'`）定义在 `src/collections/CitySiteProfiles.ts`
 * 的 select options 里，与这里的数字契约值形状不同，没有共享常量；改档位要两处一起改。
 */
export type FeaturedDistrictCount = 3 | 5

export function normalizeFeaturedDistrictCount(value: unknown): FeaturedDistrictCount {
  if (value === 3 || value === '3') return 3
  return 5
}
