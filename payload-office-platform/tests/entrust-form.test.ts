import { describe, expect, it, vi } from 'vitest'
import {
  buildEntrustInquiryBody,
  createEntrustSubmissionCoordinator,
  getEntrustSubmissionError,
  isValidEntrustPhone,
  normalizeEntrustPhone,
  submitEntrustInquiry,
} from '@/components/frontend/landing/EntrustForm'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import type { LandingAnalyticsRecord } from '@/lib/frontend/analytics/landing'

describe('EntrustForm submission boundary', () => {
  it('normalizes mainland phone input before validating it', () => {
    expect(normalizeEntrustPhone(' +86 138-0000 (1111) ')).toBe('13800001111')
    expect(normalizeEntrustPhone('138.0000.1111')).toBe('13800001111')
    expect(isValidEntrustPhone('138 0000-1111')).toBe(true)
    expect(isValidEntrustPhone('138.0000.1111')).toBe(true)
    expect(isValidEntrustPhone('123')).toBe(false)
  })

  it('builds the exact entrust inquiry body with the normalized phone', () => {
    expect(buildEntrustInquiryBody('138 0000-1111', 'entrust-fixed-request')).toEqual({
      phone: '13800001111',
      requestId: 'entrust-fixed-request',
      targetType: 'none',
      consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
      source: { pageType: 'entrust', path: '/entrust' },
    })
  })

  it('submits the exact JSON request and accepts an ok response', async () => {
    const requests: Array<Readonly<{ url: string; init: RequestInit | undefined }>> = []
    const requester = async (url: string, init?: RequestInit): Promise<Response> => {
      requests.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    const result = await submitEntrustInquiry(
      buildEntrustInquiryBody('138 0000-1111', 'entrust-fixed-request'),
      requester,
    )

    expect(result).toEqual({ ok: true })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toEqual({
      url: '/api/inquiries',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone: '13800001111',
          requestId: 'entrust-fixed-request',
          targetType: 'none',
          consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
          source: { pageType: 'entrust', path: '/entrust' },
        }),
      },
    })
  })

  it('maps rate-limit, generic, and network failures to distinct safe messages', async () => {
    const body = buildEntrustInquiryBody('13800001111', 'entrust-retry-request')
    const rateLimited = await submitEntrustInquiry(body, async () => new Response('{}', { status: 429 }))
    const validationFailed = await submitEntrustInquiry(body, async () => new Response('{}', { status: 422 }))
    const failed = await submitEntrustInquiry(body, async () => new Response('{}', { status: 500 }))
    const network = await submitEntrustInquiry(body, async () => {
      throw new Error('offline')
    })

    expect(rateLimited).toEqual({ ok: false, error: 'rate_limited' })
    expect(validationFailed).toEqual({ ok: false, error: 'failed' })
    expect(failed).toEqual({ ok: false, error: 'failed' })
    expect(network).toEqual({ ok: false, error: 'network_error' })
    expect(getEntrustSubmissionError('rate_limited')).toBe('提交过于频繁，请稍后再试')
    expect(getEntrustSubmissionError('failed')).toBe('提交失败，请稍后重试')
    expect(getEntrustSubmissionError('network_error')).toBe('网络异常，请稍后重试')
  })

  it('creates one request ID, sends once for a double submit, and transitions to success', async () => {
    const requestIdFactory = vi.fn(() => 'entrust-one-mount')
    let calls = 0
    let resolveResponse: (response: Response) => void = () => undefined
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const requester = (_url: string, _init?: RequestInit): Promise<Response> => {
      calls += 1
      return response
    }
    const states: string[] = []
    const events: LandingAnalyticsRecord[] = []
    const coordinator = createEntrustSubmissionCoordinator(requestIdFactory, requester, (state) => {
      states.push(state.status)
    }, (name, props) => events.push({ name, props }))

    const firstSubmit = coordinator.submit('13800001111')
    const secondSubmit = coordinator.submit('13800001111')

    expect(requestIdFactory).toHaveBeenCalledTimes(1)
    expect(calls).toBe(1)
    expect(firstSubmit).toBe(secondSubmit)
    expect(coordinator.getState()).toEqual({ status: 'submitting', error: null })

    resolveResponse(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await firstSubmit

    expect(coordinator.getState()).toEqual({ status: 'success', error: null })
    expect(states).toEqual(['submitting', 'success'])
    expect(events).toEqual([
      {
        name: 'landing_form_submit',
        props: { page_type: 'entrust', field_completeness: 1 },
      },
      { name: 'landing_form_success', props: { page_type: 'entrust' } },
    ])
    expect(JSON.stringify(events)).not.toContain('13800001111')
  })

  it('maps an entrust 422 response to the fixed submit_failed analytics code', async () => {
    const events: LandingAnalyticsRecord[] = []
    const coordinator = createEntrustSubmissionCoordinator(
      () => 'entrust-422',
      async () => new Response(JSON.stringify({ errors: ['private_server_code'] }), { status: 422 }),
      undefined,
      (name, props) => events.push({ name, props }),
    )

    await coordinator.submit('13800001111')

    expect(events).toEqual([
      {
        name: 'landing_form_submit',
        props: { page_type: 'entrust', field_completeness: 1 },
      },
      {
        name: 'landing_form_error',
        props: { page_type: 'entrust', error_code: 'submit_failed' },
      },
    ])
    expect(JSON.stringify(events)).not.toContain('private_server_code')
  })

  it('tracks every client-side attempt before validation and reports network errors separately', async () => {
    const events: LandingAnalyticsRecord[] = []
    const coordinator = createEntrustSubmissionCoordinator(
      () => 'entrust-network-analytics',
      async () => {
        throw new Error('offline')
      },
      undefined,
      (name, props) => events.push({ name, props }),
    )

    await coordinator.submit('123')
    await coordinator.submit('13800001111')

    expect(events).toEqual([
      {
        name: 'landing_form_submit',
        props: { page_type: 'entrust', field_completeness: 1 },
      },
      {
        name: 'landing_form_error',
        props: { page_type: 'entrust', error_code: 'validation_failed' },
      },
      {
        name: 'landing_form_submit',
        props: { page_type: 'entrust', field_completeness: 1 },
      },
      {
        name: 'landing_form_error',
        props: { page_type: 'entrust', error_code: 'network_error' },
      },
    ])
  })

  it('reports zero completeness for an empty phone before the validation error', async () => {
    const events: LandingAnalyticsRecord[] = []
    const coordinator = createEntrustSubmissionCoordinator(
      () => 'entrust-empty-analytics',
      async () => new Response('{}', { status: 500 }),
      undefined,
      (name, props) => events.push({ name, props }),
    )

    await coordinator.submit('   ')

    expect(events).toEqual([
      {
        name: 'landing_form_submit',
        props: { page_type: 'entrust', field_completeness: 0 },
      },
      {
        name: 'landing_form_error',
        props: { page_type: 'entrust', error_code: 'validation_failed' },
      },
    ])
  })

  it('keeps submission successful when analytics throws', async () => {
    const coordinator = createEntrustSubmissionCoordinator(
      () => 'entrust-analytics-failure',
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      undefined,
      () => {
        throw new Error('analytics unavailable')
      },
    )

    await expect(coordinator.submit('13800001111')).resolves.toEqual({
      status: 'success',
      error: null,
    })
  })

  it('retains the mounted request ID when retrying after a rate limit', async () => {
    const requestBodies: string[] = []
    const requester = (_url: string, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body === 'string') requestBodies.push(init.body)
      return Promise.resolve(
        requestBodies.length === 1
          ? new Response(JSON.stringify({ ok: false }), { status: 429 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
    }
    const events: LandingAnalyticsRecord[] = []
    const coordinator = createEntrustSubmissionCoordinator(
      () => 'entrust-retry-id',
      requester,
      undefined,
      (name, props) => events.push({ name, props }),
    )

    await coordinator.submit('13800001111')
    expect(coordinator.getState()).toEqual({ status: 'error', error: '提交过于频繁，请稍后再试' })

    await coordinator.submit('13800001111')

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]).toContain('"requestId":"entrust-retry-id"')
    expect(requestBodies[1]).toContain('"requestId":"entrust-retry-id"')
    expect(coordinator.getState()).toEqual({ status: 'success', error: null })
    expect(events.map((event) => event.name)).toEqual([
      'landing_form_submit',
      'landing_form_error',
      'landing_form_submit',
      'landing_form_success',
    ])
    expect(events[1].props).toEqual({ page_type: 'entrust', error_code: 'rate_limited' })
  })

  it('exposes safe error states for invalid phone and network failures', async () => {
    const coordinator = createEntrustSubmissionCoordinator(
      () => 'entrust-network-id',
      async () => {
        throw new Error('offline')
      },
    )

    await coordinator.submit('123')
    expect(coordinator.getState()).toEqual({ status: 'error', error: '请输入正确的 11 位手机号' })

    await coordinator.submit('13800001111')
    expect(coordinator.getState()).toEqual({ status: 'error', error: '网络异常，请稍后重试' })
  })
})
