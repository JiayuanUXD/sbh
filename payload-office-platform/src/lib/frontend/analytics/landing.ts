import { assertSafeAnalyticsProps, type AnalyticsEventName } from './events'

export type LandingPageType = 'entrust' | 'publish'
export type LandingAnalyticsEventName = Extract<AnalyticsEventName, `landing_${string}`>
export type LandingAnalyticsProps = Readonly<Record<string, string | number | boolean>>
export type LandingAnalyticsTrack = (
  name: LandingAnalyticsEventName,
  props: LandingAnalyticsProps,
) => void
export type LandingAnalyticsRecord = Readonly<{
  name: LandingAnalyticsEventName
  props: LandingAnalyticsProps
}>

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
