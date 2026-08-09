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
