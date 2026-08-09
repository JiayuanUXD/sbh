// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import {
  ANALYTICS_CAPTURE_KEY,
  installAnalyticsDataLayerCapture,
  normalizeDataLayerEvent,
} from './e2e/support/landing-analytics-capture'

afterEach(() => {
  Reflect.deleteProperty(window, ANALYTICS_CAPTURE_KEY)
  Reflect.deleteProperty(window, 'dataLayer')
})

describe('landing analytics dataLayer capture', () => {
  it('preserves a pre-existing dataLayer and captures existing plus subsequent events', () => {
    const existing = { event: 'landing_view', page_type: 'entrust', _ts: 1 }
    const later = { event: 'landing_form_start', page_type: 'entrust', _ts: 2 }
    const dataLayer: unknown[] = [existing]
    Reflect.set(window, 'dataLayer', dataLayer)

    installAnalyticsDataLayerCapture(ANALYTICS_CAPTURE_KEY)
    dataLayer.push(later)

    expect(Reflect.get(window, 'dataLayer')).toBe(dataLayer)
    expect(Reflect.get(window, ANALYTICS_CAPTURE_KEY)).toEqual([existing, later])
  })

  it('captures a dataLayer initialized after the capture hook is installed', () => {
    installAnalyticsDataLayerCapture(ANALYTICS_CAPTURE_KEY)
    const initializedLater: unknown[] = [
      { event: 'landing_view', page_type: 'publish', _ts: 3 },
    ]

    Reflect.set(window, 'dataLayer', initializedLater)
    initializedLater.push({ event: 'landing_form_start', page_type: 'publish', _ts: 4 })

    expect(Reflect.get(window, ANALYTICS_CAPTURE_KEY)).toEqual([
      { event: 'landing_view', page_type: 'publish', _ts: 3 },
      { event: 'landing_form_start', page_type: 'publish', _ts: 4 },
    ])
  })

  it('normalizes a production dataLayer entry to the shared event shape', () => {
    expect(
      normalizeDataLayerEvent({
        event: 'landing_form_success',
        page_type: 'publish',
        commission_months: '1',
        _ts: 123,
      }),
    ).toEqual({
      name: 'landing_form_success',
      props: { page_type: 'publish', commission_months: '1' },
    })
    expect(normalizeDataLayerEvent(['gtm.start', 123])).toBeNull()
    expect(normalizeDataLayerEvent({ page_type: 'publish' })).toBeNull()
  })
})
