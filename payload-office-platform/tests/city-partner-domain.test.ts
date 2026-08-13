import { describe, expect, it } from 'vitest'

import {
  CITY_PARTNER_IDENTITIES,
  CITY_PARTNER_RESOURCE_TYPES,
  CITY_PARTNER_STATUSES,
  canTransitionCityPartner,
} from '@/domain/city-partner-application/schema'
import {
  CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY,
  protectCityPartnerApplication,
} from '@/domain/city-partner-application/application-protect'

function update(data: Record<string, unknown>, originalDoc: Record<string, unknown>, context = {}) {
  return protectCityPartnerApplication({
    operation: 'update', data, originalDoc,
    req: { context, payload: {}, user: null },
  } as never)
}

describe('city partner application domain', () => {
  it('keeps identity, resource, and status values closed', () => {
    expect(CITY_PARTNER_IDENTITIES).toEqual([
      'owner-property', 'broker-channel', 'enterprise-service', 'local-operations', 'other',
    ])
    expect(CITY_PARTNER_RESOURCE_TYPES).toEqual([
      'building-owner', 'tenant-demand', 'broker-network', 'local-team',
      'government-association', 'other',
    ])
    expect(CITY_PARTNER_STATUSES).toEqual([
      'pending', 'contacted', 'evaluating', 'qualified', 'not-fit', 'withdrawn',
    ])
  })

  it('permits only forward transitions and keeps terminal states terminal', () => {
    expect(canTransitionCityPartner('pending', 'contacted')).toBe(true)
    expect(canTransitionCityPartner('pending', 'qualified')).toBe(false)
    expect(canTransitionCityPartner('contacted', 'evaluating')).toBe(true)
    expect(canTransitionCityPartner('evaluating', 'qualified')).toBe(true)
    expect(canTransitionCityPartner('qualified', 'evaluating')).toBe(false)
    expect(canTransitionCityPartner('not-fit', 'contacted')).toBe(false)
    expect(canTransitionCityPartner('withdrawn', 'pending')).toBe(false)
  })

  it('accepts trusted stage one only and forces server workflow defaults', async () => {
    await expect(protectCityPartnerApplication({
      operation: 'create',
      data: { applicantName: '李女士', status: 'qualified', internalNote: 'injected' },
      req: {
        context: { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-one' },
        payload: {}, user: null,
      },
    } as never)).resolves.toMatchObject({
      applicantName: '李女士', status: 'pending', handledAt: null,
    })
    await expect(protectCityPartnerApplication({
      operation: 'create', data: { applicantName: '李女士' },
      req: { context: {}, payload: {}, user: null },
    } as never)).rejects.toThrow('city_partner_stage_one_context_required')
  })

  it('rejects mutation of stage-one facts and repeated stage-two completion', async () => {
    const original = {
      city: 11, applicantName: '李女士', contactPhone: '13800001111',
      applicantIdentity: 'owner-property', detailsCompletedAt: null, status: 'pending',
    }
    await expect(update({ applicantName: '篡改' }, original)).rejects.toThrow(
      'city_partner_applicant_facts_immutable',
    )
    await expect(update(
      { organizationName: '甲公司', detailsCompletedAt: '2026-08-13T01:00:00.000Z' },
      { ...original, detailsCompletedAt: '2026-08-13T00:00:00.000Z' },
      { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-two' },
    )).rejects.toThrow('city_partner_details_already_completed')
  })

  it('allows stage two once and rejects invalid workflow jumps', async () => {
    const original = {
      city: 11, applicantName: '李女士', contactPhone: '13800001111',
      applicantIdentity: 'owner-property', detailsCompletedAt: null, status: 'pending',
    }
    await expect(update(
      { organizationName: '甲公司', detailsFingerprint: 'abc', detailsCompletedAt: '2026-08-13T00:00:00.000Z' },
      original,
      { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-two' },
    )).resolves.toMatchObject({ organizationName: '甲公司' })
    await expect(update({ status: 'qualified' }, original)).rejects.toThrow(
      'city_partner_status_transition_invalid',
    )
  })
})
