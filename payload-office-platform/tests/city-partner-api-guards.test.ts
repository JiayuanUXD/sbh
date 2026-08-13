import { describe, expect, it } from 'vitest'

import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import {
  isSameOrigin,
  isStrictJsonContentType,
  validateCityPartnerCreateBody,
  validateCityPartnerDetailsBody,
} from '@/app/api/city-partner-applications/request-guards'

const validCreate = () => ({
  requestId: 'partner-req-001',
  city: 'hangzhou',
  applicantName: '张三',
  contactPhone: '138 0000 1111',
  applicantIdentity: 'other',
  otherIdentity: '园区运营方',
  consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
  source: { path: '/city-partner' },
})

const validDetails = () => ({
  requestId: 'partner-req-001',
  contactPhone: '+86 138 0000 1111',
  organizationName: '杭州园区服务有限公司',
  resourceTypes: ['other', 'local-team'],
  otherResource: '产业园资源',
  experienceSummary: '十年本地运营经验',
  cooperationPlan: '共同服务本地企业',
})

describe('city partner API request guards', () => {
  it('accepts only strict JSON media types and same-origin requests', () => {
    expect(isStrictJsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(isStrictJsonContentType('text/json')).toBe(false)
    expect(isSameOrigin(new Request('https://sbh.example.com/api', {
      headers: { host: 'sbh.example.com', origin: 'https://sbh.example.com' },
    }), 'https://sbh.example.com')).toBe(true)
    expect(isSameOrigin(new Request('https://sbh.example.com/api', {
      headers: { host: 'sbh.example.com', origin: 'https://attacker.example' },
    }), 'https://sbh.example.com')).toBe(false)
  })

  it.each([
    ['missing Origin', { host: 'sbh.example.com' }],
    ['missing Host', { origin: 'https://sbh.example.com' }],
    ['scheme mismatch', { host: 'sbh.example.com', origin: 'http://sbh.example.com' }],
    ['port mismatch', { host: 'sbh.example.com', origin: 'https://sbh.example.com:444' }],
    ['request host mismatch', { host: 'internal.example.com', origin: 'https://sbh.example.com' }],
  ])('fails closed for %s', (_case, headers) => {
    expect(isSameOrigin(
      new Request('https://sbh.example.com/api', { headers }),
      'https://sbh.example.com',
    )).toBe(false)
  })

  it('uses configured server authority rather than a self-consistent attacker request URL', () => {
    expect(isSameOrigin(new Request('https://attacker.example/api', {
      headers: { host: 'attacker.example', origin: 'https://attacker.example' },
    }), 'https://sbh.example.com')).toBe(false)
  })

  it('canonicalizes explicit default ports against the configured authority', () => {
    expect(isSameOrigin(new Request('https://internal.invalid/api', {
      headers: { host: 'sbh.example.com:443', origin: 'https://sbh.example.com:443' },
    }), 'https://sbh.example.com')).toBe(true)
    expect(isSameOrigin(new Request('http://internal.invalid/api', {
      headers: { host: 'sbh.example.com:80', origin: 'http://sbh.example.com:80' },
    }), 'http://sbh.example.com')).toBe(true)
  })

  it('normalizes a strict stage-one body', () => {
    expect(validateCityPartnerCreateBody(validCreate())).toEqual({
      ok: true,
      data: {
        ...validCreate(),
        applicantName: '张三',
        contactPhone: '13800001111',
        phoneNormalized: '13800001111',
        otherIdentity: '园区运营方',
      },
    })
  })

  it.each([
    ['unknown top-level key', { extra: 'no' }],
    ['noncanonical city', { city: ' HangZhou ' }],
    ['unknown identity', { applicantIdentity: 'admin' }],
    ['missing other dependency', { otherIdentity: '   ' }],
    ['wrong consent version', { consent: { accepted: true, policyVersion: 'old' } }],
    ['wrong source path', { source: { path: '/other' } }],
    ['unknown nested consent key', { consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION, extra: true } }],
    ['invalid request id', { requestId: 'contains spaces' }],
    ['invalid phone', { contactPhone: '12345' }],
    ['blank name', { applicantName: '   ' }],
  ])('rejects stage-one %s', (_case, override) => {
    expect(validateCityPartnerCreateBody({ ...validCreate(), ...override }).ok).toBe(false)
  })

  it('rejects otherIdentity when identity is not other', () => {
    expect(validateCityPartnerCreateBody({
      ...validCreate(),
      applicantIdentity: 'local-operations',
    }).ok).toBe(false)
  })

  it('normalizes stage-two fields and canonicalizes resource order', () => {
    expect(validateCityPartnerDetailsBody(validDetails())).toEqual({
      ok: true,
      data: {
        ...validDetails(),
        contactPhone: '13800001111',
        phoneNormalized: '13800001111',
        resourceTypes: ['local-team', 'other'],
      },
    })
  })

  it.each([
    ['unknown key', { extra: true }],
    ['unknown resource', { resourceTypes: ['tenant-demand', 'root'] }],
    ['duplicate resource', { resourceTypes: ['other', 'other'] }],
    ['missing other resource', { otherResource: '   ' }],
    ['organization too long', { organizationName: '甲'.repeat(101) }],
    ['summary too long', { experienceSummary: '甲'.repeat(2001) }],
  ])('rejects stage-two %s', (_case, override) => {
    expect(validateCityPartnerDetailsBody({ ...validDetails(), ...override }).ok).toBe(false)
  })

  it('rejects otherResource without the other resource type', () => {
    expect(validateCityPartnerDetailsBody({
      ...validDetails(),
      resourceTypes: ['local-team'],
    }).ok).toBe(false)
  })
})
