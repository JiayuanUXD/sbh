import { describe, expect, it } from 'vitest'
import {
  buildCityAnalyticsPayload,
  resolveCityPageObservation,
  safeTrackCityPartnerEvent,
  safeTrackCityEvent,
  createLandingOnceTracker,
  safeTrackLandingEvent,
  type LandingAnalyticsRecord,
} from '@/lib/frontend/analytics/landing'
import { validateEvent } from '@/lib/frontend/analytics/events'

describe('landing analytics safety boundary', () => {
  it('builds every city observation event from closed enum fields only', () => {
    expect(buildCityAnalyticsPayload('city_partner_cta_clicked', {
      city: 'hangzhou',
      status: 'coming-soon',
      query: '?city=hangzhou&phone=13800001111',
      phone: '13800001111',
    })).toEqual({ city: 'hangzhou', status: 'coming-soon' })
    expect(buildCityAnalyticsPayload('city_switcher_opened', {
      city: 'shanghai', status: 'live', page_type: 'listings',
    })).toEqual({ city: 'shanghai', status: 'live', page_type: 'listings' })
    expect(buildCityAnalyticsPayload('city_switched', {
      from_city: 'shanghai', to_city: 'hangzhou', status: 'coming-soon',
      page_type: 'listings', filters_preserved: true,
    })).toEqual({
      from_city: 'shanghai', to_city: 'hangzhou', status: 'coming-soon',
      page_type: 'listings', filters_preserved: true,
    })
    expect(buildCityAnalyticsPayload('coming_soon_cta_clicked', {
      city: 'hangzhou', status: 'coming-soon', cta_type: 'entrust',
    })).toEqual({ city: 'hangzhou', status: 'coming-soon', cta_type: 'entrust' })
    expect(buildCityAnalyticsPayload('city_page_view', {
      city: 'hangzhou', status: 'coming-soon', page_type: 'home',
    })).toEqual({ city: 'hangzhou', status: 'coming-soon', page_type: 'home' })
    expect(buildCityAnalyticsPayload('city_lead_submitted', {
      city: 'hangzhou', status: 'coming-soon', form_type: 'entrust',
    })).toEqual({ city: 'hangzhou', status: 'coming-soon', form_type: 'entrust' })
    expect(validateEvent('city_page_view', {
      city: 'hangzhou', status: 'coming-soon', page_type: 'home',
      phone: '13800001111', query: '?city=hangzhou',
    })).toEqual({
      ok: true,
      eventName: 'city_page_view',
      sanitized: { city: 'hangzhou', status: 'coming-soon', page_type: 'home' },
    })
    expect(validateEvent('city_page_view', {
      city: 'hangzhou', status: 'secret-status', page_type: 'home',
    })).toEqual({ ok: false, reason: 'invalid_city_event_props' })
    expect(validateEvent('city_page_view', {
      city: 'news', status: 'live', page_type: 'home',
    })).toEqual({ ok: false, reason: 'invalid_city_event_props' })
  })

  it('rejects noncanonical slugs and unknown enum values before invoking the adapter', () => {
    const calls: unknown[] = []
    const tracker = (name: string, props: Readonly<Record<string, string | number | boolean>>) => {
      calls.push({ name, props })
    }
    safeTrackCityEvent(tracker, 'city_page_view', {
      city: ' HangZhou ', status: 'coming-soon', page_type: 'home',
    })
    safeTrackCityEvent(tracker, 'coming_soon_cta_clicked', {
      city: 'hangzhou', status: 'coming-soon', cta_type: 'phone-number',
    })
    expect(calls).toEqual([])
  })

  it('derives page-view enums only from a trusted city option and canonical pathname', () => {
    const cities = [
      { slug: 'shanghai', name: '上海', serviceStatus: 'live' as const, sortOrder: 10 },
      { slug: 'hangzhou', name: '杭州', serviceStatus: 'coming-soon' as const, sortOrder: 20 },
    ]
    expect(resolveCityPageObservation('/hangzhou/listings', cities)).toEqual({
      city: 'hangzhou', status: 'coming-soon', page_type: 'listings',
    })
    expect(resolveCityPageObservation('/news', cities)).toBeNull()
    expect(resolveCityPageObservation('/unknown', cities)).toBeNull()
  })

  it('observes only trusted global lead and flag-off legacy owner routes', () => {
    const cities = [
      { slug: 'shanghai', serviceStatus: 'live' as const },
      { slug: 'hangzhou', serviceStatus: 'coming-soon' as const },
    ]
    const enabled = { defaultCity: 'shanghai', multiCityRoutingEnabled: true }
    const disabled = { defaultCity: 'shanghai', multiCityRoutingEnabled: false }

    for (const pageType of ['entrust', 'publish', 'city-partner'] as const) {
      expect(resolveCityPageObservation(`/${pageType}`, cities, new URLSearchParams('city=hangzhou'), enabled)).toEqual({
        city: 'hangzhou', status: 'coming-soon', page_type: pageType,
      })
      expect(resolveCityPageObservation(`/${pageType}`, cities, new URLSearchParams(), enabled)).toEqual({
        city: 'shanghai', status: 'live', page_type: pageType,
      })
      expect(resolveCityPageObservation(`/${pageType}`, cities, new URLSearchParams('city=hangzhou&city=shanghai'), enabled)).toBeNull()
      expect(resolveCityPageObservation(`/${pageType}`, cities, new URLSearchParams('city=HangZhou'), enabled)).toBeNull()
    }

    expect(resolveCityPageObservation('/', cities, new URLSearchParams(), disabled)).toEqual({
      city: 'shanghai', status: 'live', page_type: 'home',
    })
    expect(resolveCityPageObservation('/listings', cities, new URLSearchParams('phone=13800001111'), disabled)).toEqual({
      city: 'shanghai', status: 'live', page_type: 'listings',
    })
    expect(resolveCityPageObservation('/buildings', cities, new URLSearchParams(), disabled)).toEqual({
      city: 'shanghai', status: 'live', page_type: 'buildings',
    })
    expect(resolveCityPageObservation('/', cities, new URLSearchParams(), enabled)).toBeNull()
    expect(resolveCityPageObservation('/news', cities, new URLSearchParams('city=hangzhou'), disabled)).toBeNull()
    expect(resolveCityPageObservation('/pages/privacy', cities, new URLSearchParams('city=hangzhou'), disabled)).toBeNull()
  })

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
