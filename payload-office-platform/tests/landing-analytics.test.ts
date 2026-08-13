import { describe, expect, it } from 'vitest'
import {
  safeTrackCityPartnerEvent,
  createLandingOnceTracker,
  safeTrackLandingEvent,
  type LandingAnalyticsRecord,
} from '@/lib/frontend/analytics/landing'
import { validateEvent } from '@/lib/frontend/analytics/events'

describe('landing analytics safety boundary', () => {
  it('allows only anonymous city partner events with canonical city and stage metadata', () => {
    const calls: Array<Readonly<{ name: string; props: Record<string, string> }>> = []
    safeTrackCityPartnerEvent(
      (name, props) => calls.push({ name, props }),
      'city_partner_application_started',
      { city_slug: 'hangzhou', stage: 'stage-one' },
    )
    expect(calls).toEqual([{
      name: 'city_partner_application_started',
      props: { city_slug: 'hangzhou', stage: 'stage-one' },
    }])
    expect(validateEvent('city_partner_application_submitted', {
      city_slug: 'hangzhou', stage: 'stage-one', phone: '13800001111', query: '?city=hangzhou',
    })).toEqual({
      ok: true,
      eventName: 'city_partner_application_submitted',
      sanitized: { city_slug: 'hangzhou', stage: 'stage-one' },
    })
    safeTrackCityPartnerEvent(
      (name, props) => calls.push({ name, props }),
      'city_partner_application_started',
      { city_slug: ' HangZhou ', stage: 'stage-one' },
    )
    expect(calls).toHaveLength(1)
  })
  it('reports a mount or first-focus event only once, including rapid consecutive calls', () => {
    const events: LandingAnalyticsRecord[] = []
    const tracker = createLandingOnceTracker('landing_form_start', 'entrust', (name, props) => {
      events.push({ name, props })
    })

    tracker()
    tracker()
    tracker()

    expect(events).toEqual([
      { name: 'landing_form_start', props: { page_type: 'entrust' } },
    ])
  })

  it('marks an event as reported before calling a throwing analytics adapter', () => {
    let calls = 0
    const tracker = createLandingOnceTracker('landing_view', 'publish', () => {
      calls += 1
      throw new Error('analytics unavailable')
    })

    expect(() => tracker()).not.toThrow()
    expect(() => tracker()).not.toThrow()
    expect(calls).toBe(1)
  })

  it('does not let analytics failures interrupt the caller', () => {
    expect(() =>
      safeTrackLandingEvent(
        () => {
          throw new Error('analytics unavailable')
        },
        'landing_bottom_cta_click',
        { page_type: 'entrust' },
      ),
    ).not.toThrow()
  })
})
