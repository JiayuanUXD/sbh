import type { PublicCitySiteProfile } from './public-contract'

export type CityContext = Readonly<{
  id: number | string
  slug: string
  name: string
  serviceStatus: 'live' | 'coming-soon'
  profile: PublicCitySiteProfile
}>

export type CityProfileLookup = (slug: string) => Promise<PublicCitySiteProfile | null>

const CITY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_CITY_SLUG_LENGTH = 64

export function normalizeCitySlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.length <= MAX_CITY_SLUG_LENGTH && CITY_SLUG_PATTERN.test(normalized)
    ? normalized
    : null
}

function isCityProfile(value: PublicCitySiteProfile): boolean {
  return (
    normalizeCitySlug(value.citySlug) !== null &&
    typeof value.cityName === 'string' &&
    value.cityName.trim().length > 0 &&
    (value.serviceStatus === 'live' || value.serviceStatus === 'coming-soon')
  )
}

export function createCityContextResolver(
  lookup: CityProfileLookup,
): (slug: unknown) => Promise<CityContext | null> {
  return async (slug: unknown): Promise<CityContext | null> => {
    const normalizedSlug = normalizeCitySlug(slug)
    if (!normalizedSlug) return null

    // 查库失败必须向上抛，不能报成 null（「城市不存在」）。null 会让页面 notFound() 出 404，
    // 而调用方外面包着 5 分钟的 unstable_cache——它缓存 resolve 的值、不缓存 reject——
    // 于是一次连接超时就变成整站首页 / 城市页 404 至少 5 分钟（2026-10-13 生产冒烟实测 `/` 404）。
    // 抛出时页面走错误页（暂时性 5xx），缓存未命中时下一次请求照常重查；已有缓存则
    // 后台刷新失败、继续用旧值。「不存在 / 未启用」仍然 fail closed 返回 null。
    const profile = await lookup(normalizedSlug)
    if (!profile || !isCityProfile(profile) || profile.citySlug !== normalizedSlug) return null

    return {
      id: profile.cityId,
      slug: normalizedSlug,
      name: profile.cityName,
      serviceStatus: profile.serviceStatus,
      profile,
    }
  }
}
