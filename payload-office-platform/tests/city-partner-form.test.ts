import { describe, expect, it, vi } from 'vitest'

import {
  buildStageOneBody,
  buildStageTwoBody,
  createCityPartnerApplicationCoordinator,
  getStageOneErrors,
  getStageTwoErrors,
  resolveCityPartnerSelection,
  type CityPartnerStageOneValues,
} from '@/components/frontend/city-partner/CityPartnerApplicationForm'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

const cities = [
  { slug: 'shanghai', name: '上海', serviceStatus: 'live' as const, sortOrder: 10 },
  { slug: 'hangzhou', name: '杭州', serviceStatus: 'coming-soon' as const, sortOrder: 20 },
]

const validStageOne: CityPartnerStageOneValues = {
  city: 'hangzhou',
  applicantName: '张三',
  contactPhone: '138 0000 1111',
  applicantIdentity: 'other',
  otherIdentity: '产业园服务方',
  consentAccepted: true,
}

describe('city partner form contract', () => {
  it('validates stage one and builds the exact public API body', () => {
    expect(getStageOneErrors(validStageOne, cities)).toEqual({})
    expect(buildStageOneBody(validStageOne, 'partner-mounted-request')).toEqual({
      requestId: 'partner-mounted-request',
      city: 'hangzhou',
      applicantName: '张三',
      contactPhone: '13800001111',
      applicantIdentity: 'other',
      otherIdentity: '产业园服务方',
      consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
      source: { path: '/city-partner' },
    })
  })

  it('rejects invalid city/name/phone/identity/consent and enforces conditional other fields', () => {
    expect(getStageOneErrors({
      ...validStageOne,
      city: 'invalid',
      applicantName: ' ',
      contactPhone: '123',
      applicantIdentity: 'other',
      otherIdentity: '',
      consentAccepted: false,
    }, cities)).toEqual({
      city: expect.any(String),
      applicantName: expect.any(String),
      contactPhone: expect.any(String),
      otherIdentity: expect.any(String),
      consentAccepted: expect.any(String),
    })
    expect(getStageTwoErrors({ resourceTypes: ['other'], otherResource: '' })).toEqual({
      otherResource: expect.any(String),
    })
    expect(buildStageTwoBody({
      organizationName: '  某机构  ',
      resourceTypes: ['local-team', 'other'],
      otherResource: '  园区资源  ',
      experienceSummary: '',
      cooperationPlan: '  联合服务企业  ',
    }, 'partner-mounted-request', '13800001111')).toEqual({
      requestId: 'partner-mounted-request',
      contactPhone: '13800001111',
      organizationName: '某机构',
      resourceTypes: ['local-team', 'other'],
      otherResource: '园区资源',
      cooperationPlan: '联合服务企业',
    })
  })

  it('defaults missing city, accepts validated coming-soon, and fails closed on explicit invalid query', () => {
    expect(resolveCityPartnerSelection(cities, undefined, 'shanghai')).toEqual({
      selectedCity: 'shanghai', invalidExplicitCity: false,
    })
    expect(resolveCityPartnerSelection(cities, 'hangzhou', 'shanghai')).toEqual({
      selectedCity: 'hangzhou', invalidExplicitCity: false,
    })
    expect(resolveCityPartnerSelection(cities, ' HangZhou ', 'shanghai')).toEqual({
      selectedCity: '', invalidExplicitCity: true,
    })
    expect(resolveCityPartnerSelection(cities, 'unknown', 'shanghai')).toEqual({
      selectedCity: '', invalidExplicitCity: true,
    })
  })

  it('coalesces clicks, keeps one request ID, persists stage one before details, and emits PII-free events', async () => {
    let resolveFirst: (response: Response) => void = () => undefined
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const calls: Array<{ url: string; body: string }> = []
    const requester = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') })
      if (calls.length === 1) return firstResponse
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const events: Array<{ name: string; props: Record<string, string> }> = []
    const coordinator = createCityPartnerApplicationCoordinator(
      () => 'partner-mounted-request',
      requester,
      undefined,
      (name, props) => events.push({ name, props }),
    )

    coordinator.start('hangzhou')
    coordinator.start('hangzhou')
    const first = coordinator.submitStageOne(validStageOne, cities)
    const duplicate = coordinator.submitStageOne(validStageOne, cities)
    expect(first).toBe(duplicate)
    expect(requester).toHaveBeenCalledTimes(1)
    resolveFirst(new Response(JSON.stringify({ ok: true }), { status: 201 }))
    await expect(first).resolves.toMatchObject({ status: 'stage-two' })
    await expect(coordinator.submitStageTwo({ resourceTypes: ['local-team'] })).resolves
      .toMatchObject({ status: 'complete' })

    expect(calls.map((call) => call.url)).toEqual([
      '/api/city-partner-applications',
      '/api/city-partner-applications/details',
    ])
    expect(calls.every((call) => call.body.includes('partner-mounted-request'))).toBe(true)
    expect(events).toEqual([
      { name: 'city_partner_application_started', props: { city_slug: 'hangzhou', stage: 'stage-one' } },
      { name: 'city_partner_application_submitted', props: { city_slug: 'hangzhou', stage: 'stage-one' } },
      { name: 'city_partner_application_completed', props: { city_slug: 'hangzhou', stage: 'stage-two' } },
    ])
    expect(JSON.stringify(events)).not.toMatch(/张三|13800001111|产业园/)
  })

  it('preserves retry intent on network and 429 errors and allows optional details to be skipped', async () => {
    const bodies: string[] = []
    let attempt = 0
    const coordinator = createCityPartnerApplicationCoordinator(
      () => 'partner-retry-request',
      async (_url, init) => {
        bodies.push(String(init?.body ?? ''))
        attempt += 1
        if (attempt === 1) throw new Error('offline with private input')
        if (attempt === 2) return new Response('{}', { status: 429 })
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    )

    await expect(coordinator.submitStageOne(validStageOne, cities)).resolves
      .toMatchObject({ status: 'error', errorCode: 'network_error' })
    expect(coordinator.hasSavedStageOne()).toBe(false)
    await expect(coordinator.submitStageOne(validStageOne, cities)).resolves
      .toMatchObject({ status: 'error', errorCode: 'rate_limited' })
    await expect(coordinator.submitStageOne(validStageOne, cities)).resolves
      .toMatchObject({ status: 'stage-two' })
    expect(coordinator.hasSavedStageOne()).toBe(true)
    expect(bodies).toHaveLength(3)
    expect(bodies.every((body) => body.includes('partner-retry-request'))).toBe(true)

    expect(coordinator.skipStageTwo()).toMatchObject({ status: 'complete' })
    expect(attempt).toBe(3)
  })

  it('coalesces stage two and emits no completed event when optional details are skipped', async () => {
    let detailResolve: (response: Response) => void = () => undefined
    const detailResponse = new Promise<Response>((resolve) => { detailResolve = resolve })
    let detailCalls = 0
    const events: string[] = []
    const coordinator = createCityPartnerApplicationCoordinator(
      () => 'partner-details-coalesce',
      async (url) => {
        if (url.endsWith('/details')) {
          detailCalls += 1
          return detailResponse
        }
        return new Response(JSON.stringify({ ok: true }), { status: 201 })
      },
      undefined,
      (name) => events.push(name),
    )
    await coordinator.submitStageOne(validStageOne, cities)
    const first = coordinator.submitStageTwo({ organizationName: '机构' })
    const duplicate = coordinator.submitStageTwo({ organizationName: '机构' })
    expect(first).toBe(duplicate)
    expect(detailCalls).toBe(1)
    detailResolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await first
    expect(events).toContain('city_partner_application_completed')

    const skippedEvents: string[] = []
    const skipped = createCityPartnerApplicationCoordinator(
      () => 'partner-details-skip',
      async () => new Response(JSON.stringify({ ok: true }), { status: 201 }),
      undefined,
      (name) => skippedEvents.push(name),
    )
    await skipped.submitStageOne(validStageOne, cities)
    skipped.skipStageTwo()
    expect(skippedEvents).not.toContain('city_partner_application_completed')
  })

  it('keeps skip inert while stage two is pending and lets the real result own the state', async () => {
    let resolveDetails: (response: Response) => void = () => undefined
    const detailsResponse = new Promise<Response>((resolve) => { resolveDetails = resolve })
    const events: string[] = []
    const coordinator = createCityPartnerApplicationCoordinator(
      () => 'partner-pending-skip',
      async (url) => url.endsWith('/details')
        ? detailsResponse
        : new Response(JSON.stringify({ ok: true }), { status: 201 }),
      undefined,
      (name) => events.push(name),
    )
    await coordinator.submitStageOne(validStageOne, cities)
    const pending = coordinator.submitStageTwo({ organizationName: '机构' })
    expect(coordinator.skipStageTwo()).toEqual({ status: 'completing' })
    expect(events).not.toContain('city_partner_application_completed')
    resolveDetails(new Response('{}', { status: 500 }))
    await expect(pending).resolves.toEqual({ status: 'error', errorCode: 'submit_failed' })
    expect(events).not.toContain('city_partner_application_completed')
  })

  it('matches conditional other-field client limits to the Task 2 server contract', () => {
    expect(getStageOneErrors({ ...validStageOne, otherIdentity: 'x'.repeat(100) }, cities))
      .toEqual({})
    expect(getStageOneErrors({ ...validStageOne, otherIdentity: 'x'.repeat(101) }, cities))
      .toMatchObject({ otherIdentity: expect.any(String) })
    expect(getStageOneErrors({
      ...validStageOne,
      applicantIdentity: 'local-operations',
      otherIdentity: 'x'.repeat(101),
    }, cities)).toEqual({})
    expect(buildStageOneBody({
      ...validStageOne,
      applicantIdentity: 'local-operations',
      otherIdentity: 'x'.repeat(101),
    }, 'conditional-other')).not.toHaveProperty('otherIdentity')

    expect(getStageTwoErrors({
      resourceTypes: ['other'],
      otherResource: 'x'.repeat(200),
    })).toEqual({})
    expect(getStageTwoErrors({
      organizationName: 'x'.repeat(101),
      resourceTypes: ['other'],
      otherResource: 'x'.repeat(201),
      experienceSummary: 'x'.repeat(2_001),
      cooperationPlan: 'x'.repeat(2_001),
    })).toEqual({
      organizationName: expect.any(String),
      otherResource: expect.any(String),
      experienceSummary: expect.any(String),
      cooperationPlan: expect.any(String),
    })
    expect(getStageTwoErrors({
      resourceTypes: ['local-team'],
      otherResource: 'x'.repeat(201),
    })).toEqual({})
    expect(buildStageTwoBody({
      resourceTypes: ['local-team'],
      otherResource: 'x'.repeat(201),
    }, 'conditional-resource', '13800001111')).not.toHaveProperty('otherResource')
  })

  it('does not consume the once-only started event until a canonical city is available', () => {
    const events: string[] = []
    const coordinator = createCityPartnerApplicationCoordinator(
      () => 'partner-start-city',
      async () => new Response('{}', { status: 500 }),
      undefined,
      (_name, props) => events.push(props.city_slug),
    )
    coordinator.start('')
    coordinator.start(' HangZhou ')
    coordinator.start('hangzhou')
    coordinator.start('shanghai')
    expect(events).toEqual(['hangzhou'])
  })
})
