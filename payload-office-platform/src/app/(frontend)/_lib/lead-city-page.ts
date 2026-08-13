import {
  listPublicCityOptions,
  resolveCityContext,
} from './city-context'
import type { LeadCityOption } from '@/components/frontend/landing/LeadCitySelect'
import { isPublicCitySlug } from '@/lib/frontend/city-routes'
import { siteConfig } from '@/lib/frontend/site-config'

export type LeadCityPageSelection = Readonly<{
  citySlug: string
  cities: readonly LeadCityOption[]
  cityError?: string
}>

export async function resolveLeadCityPageSelection(
  searchParams: Promise<{ city?: string | string[] }>,
): Promise<LeadCityPageSelection> {
  const [publicOptions, query] = await Promise.all([listPublicCityOptions(), searchParams])
  const hasExplicitCity = query.city !== undefined
  const candidate = typeof query.city === 'string'
    ? query.city
    : hasExplicitCity
      ? ''
      : siteConfig.defaultCity
  const context = isPublicCitySlug(candidate) ? await resolveCityContext(candidate) : null
  const extraOption = context && !publicOptions.some((option) => option.slug === context.slug)
    ? { slug: context.slug, name: context.name, serviceStatus: context.serviceStatus }
    : null
  const cities = [
    ...publicOptions.map((option) => ({
      slug: option.slug,
      name: option.name,
      serviceStatus: option.serviceStatus,
    })),
    ...(extraOption ? [extraOption] : []),
  ]

  if (context) return { citySlug: context.slug, cities }
  return {
    citySlug: '',
    cities,
    cityError: hasExplicitCity
      ? '链接中的城市无效，请重新选择城市'
      : '默认服务城市暂不可用，请稍后再试',
  }
}
