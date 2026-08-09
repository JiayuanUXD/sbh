import { describe, expect, it } from 'vitest'
import {
  buildEntrustInquiryBody,
  getEntrustSubmissionError,
  isValidEntrustPhone,
  normalizeEntrustPhone,
  submitEntrustInquiry,
} from '@/components/frontend/landing/EntrustForm'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

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
    const failed = await submitEntrustInquiry(body, async () => new Response('{}', { status: 500 }))
    const network = await submitEntrustInquiry(body, async () => {
      throw new Error('offline')
    })

    expect(rateLimited).toEqual({ ok: false, error: 'rate_limited' })
    expect(failed).toEqual({ ok: false, error: 'failed' })
    expect(network).toEqual({ ok: false, error: 'network_error' })
    expect(getEntrustSubmissionError('rate_limited')).toBe('提交过于频繁，请稍后再试')
    expect(getEntrustSubmissionError('failed')).toBe('提交失败，请稍后重试')
    expect(getEntrustSubmissionError('network_error')).toBe('网络异常，请稍后重试')
  })
})
