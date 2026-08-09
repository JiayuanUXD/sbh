import { describe, expect, it } from 'vitest'
import {
  createLandingOnceTracker,
  safeTrackLandingEvent,
  type LandingAnalyticsRecord,
} from '@/lib/frontend/analytics/landing'

describe('landing analytics safety boundary', () => {
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
