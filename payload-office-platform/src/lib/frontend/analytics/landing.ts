import { assertSafeAnalyticsProps, type AnalyticsEventName } from './events'
import { getCityPageType, isPublicCitySlug, type CityPageType } from '../city-routes'

export type LandingPageType = 'entrust' | 'publish'
export type LandingAnalyticsEventName = Extract<AnalyticsEventName, `landing_${string}`>
export type LandingAnalyticsProps = Readonly<Record<string, string | number | boolean>>
export type LandingAnalyticsTrack = (
  name: LandingAnalyticsEventName | CityAnalyticsEventName,
  props: LandingAnalyticsProps,
) => void
export type LandingAnalyticsRecord = Readonly<{
  name: LandingAnalyticsEventName | CityAnalyticsEventName
  props: LandingAnalyticsProps
}>

export type CityAnalyticsEventName = Extract<
  AnalyticsEventName,
  | 'city_switcher_opened'
  | 'city_switched'
  | 'coming_soon_cta_clicked'
  | 'city_page_view'
  | 'city_lead_submitted'
  | 'city_partner_cta_clicked'
>
export type CityServiceStatus = 'live' | 'coming-soon'
export type CityPageObservationOption = Readonly<{
  slug: string
  serviceStatus: CityServiceStatus
}>
export type CityAnalyticsProps = Readonly<Record<string, string | number | boolean>>
export type CityAnalyticsTrack = (
  name: CityAnalyticsEventName,
  props: CityAnalyticsProps,
) => void

const CITY_STATUSES = new Set<unknown>(['live', 'coming-soon'])
const CITY_PAGE_TYPES = new Set<unknown>([
  'home', 'listings', 'listing-detail', 'buildings', 'building-detail',
  'news', 'news-detail', 'privacy', 'page-detail', 'entrust', 'publish', 'city-partner',
] satisfies readonly Exclude<CityPageType, 'unknown'>[])
const COMING_SOON_CTA_TYPES = new Set<unknown>(['entrust', 'publish', 'inquiry', 'city-partner'])
const CITY_FORM_TYPES = new Set<unknown>(['entrust', 'publish', 'city-partner'])

function cityAndStatus(input: Readonly<Record<string, unknown>>): Readonly<{
  city: string
  status: CityServiceStatus
}> | null {
  if (!isPublicCitySlug(input.city) || !CITY_STATUSES.has(input.status)) return null
  return { city: input.city, status: input.status as CityServiceStatus }
}

/** Selects only closed city enums; arbitrary input and raw query fields are never returned. */
export function buildCityAnalyticsPayload(
  name: CityAnalyticsEventName,
  input: Readonly<Record<string, unknown>>,
): CityAnalyticsProps | null {
  if (name === 'city_switched') {
    if (
      !isPublicCitySlug(input.from_city)
      || !isPublicCitySlug(input.to_city)
      || !CITY_STATUSES.has(input.status)
      || !CITY_PAGE_TYPES.has(input.page_type)
      || typeof input.filters_preserved !== 'boolean'
    ) return null
    return {
      from_city: input.from_city,
      to_city: input.to_city,
      status: input.status as CityServiceStatus,
      page_type: input.page_type as string,
      filters_preserved: input.filters_preserved,
    }
  }

  const base = cityAndStatus(input)
  if (!base) return null
  if (name === 'city_partner_cta_clicked') return base
  if (name === 'city_switcher_opened' || name === 'city_page_view') {
    if (!CITY_PAGE_TYPES.has(input.page_type)) return null
    return { ...base, page_type: input.page_type as string }
  }
  if (name === 'coming_soon_cta_clicked') {
    if (base.status !== 'coming-soon' || !COMING_SOON_CTA_TYPES.has(input.cta_type)) return null
    return { ...base, cta_type: input.cta_type as string }
  }
  if (!CITY_FORM_TYPES.has(input.form_type)) return null
  return { ...base, form_type: input.form_type as string }
}

export function safeTrackCityEvent(
  tracker: CityAnalyticsTrack,
  name: CityAnalyticsEventName,
  input: Readonly<Record<string, unknown>>,
): void {
  try {
    const props = buildCityAnalyticsPayload(name, input)
    if (!props) return
    assertSafeAnalyticsProps(props)
    tracker(name, props)
  } catch {
    // Anonymous analytics is best-effort and cannot interrupt navigation or submission.
  }
}

export function resolveCityPageObservation(
  pathname: string,
  cities: readonly CityPageObservationOption[],
): CityAnalyticsProps | null {
  const firstSegment = pathname.split('/').filter(Boolean)[0]
  if (!firstSegment) return null
  const city = cities.find((candidate) => candidate.slug === firstSegment)
  const pageType = getCityPageType(pathname)
  if (!city || pageType === 'unknown') return null
  return buildCityAnalyticsPayload('city_page_view', {
    city: city.slug,
    status: city.serviceStatus,
    page_type: pageType,
  })
}

export type CityPartnerAnalyticsEventName = Extract<
  AnalyticsEventName,
  `city_partner_application_${string}`
>
export type CityPartnerAnalyticsProps = Readonly<{
  city_slug: string
  stage: 'stage-one' | 'stage-two'
}>
export type CityPartnerAnalyticsTrack = (
  name: CityPartnerAnalyticsEventName,
  props: CityPartnerAnalyticsProps,
) => void

export function safeTrackCityPartnerEvent(
  tracker: CityPartnerAnalyticsTrack,
  name: CityPartnerAnalyticsEventName,
  props: CityPartnerAnalyticsProps,
): void {
  try {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(props.city_slug)) return
    assertSafeAnalyticsProps(props)
    tracker(name, props)
  } catch {
    // Anonymous analytics is best-effort and cannot interrupt the form.
  }
}

export function safeTrackLandingEvent(
  tracker: LandingAnalyticsTrack,
  name: LandingAnalyticsEventName,
  props: LandingAnalyticsProps,
): void {
  try {
    assertSafeAnalyticsProps(props)
    tracker(name, props)
  } catch {
    // Analytics is best-effort and must never interrupt a primary user action.
  }
}

export function createLandingOnceTracker(
  name: 'landing_view' | 'landing_form_start',
  pageType: LandingPageType,
  tracker: LandingAnalyticsTrack,
): () => void {
  let tracked = false
  return () => {
    if (tracked) return
    tracked = true
    safeTrackLandingEvent(tracker, name, { page_type: pageType })
  }
}

/** 落地页表单提交成功后广播的 DOM 事件；吸底 CTA 据此切换已收到态并停止吸底。 */
export const LANDING_CONVERTED_EVENT = 'landing:converted'

export type LandingConvertedDetail = Readonly<{ pageType: LandingPageType }>

export function dispatchLandingConverted(pageType: LandingPageType): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<LandingConvertedDetail>(LANDING_CONVERTED_EVENT, { detail: { pageType } }),
  )
}
