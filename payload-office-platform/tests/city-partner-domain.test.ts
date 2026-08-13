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

function adminReq(options: { code?: 'ADM' | 'MGR'; cityIds?: Array<number | string> } = {}) {
  const code = options.code ?? 'MGR'
  return {
    context: {},
    user: {
      id: 7,
      status: 'active',
      sessionVersion: 1,
      cityScope: (options.cityIds ?? [11]).map((id) => ({ id })),
      roles: [{
        id: 70,
        code,
        status: 'active',
        builtin: true,
        operationPermissions: code === 'ADM' ? ['*'] : ['city_partner_application:manage'],
        dataScope: code === 'ADM' ? 'global' : 'team',
      }],
    },
    payload: {},
  }
}

function update(
  data: Record<string, unknown>,
  originalDoc: Record<string, unknown>,
  context = {},
  req: Record<string, unknown> = { context, payload: {}, user: null },
) {
  return protectCityPartnerApplication({
    operation: 'update', data, originalDoc,
    req: { ...req, context },
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

  it('preserves required stage-one and workflow facts during a trusted stage-two update', async () => {
    const original = {
      city: 11,
      applicantName: 'integration-applicant',
      contactPhone: '13800001111',
      applicantIdentity: 'owner-property',
      detailsCompletedAt: null,
      status: 'pending',
    }
    await expect(update(
      {
        organizationName: 'integration-organization',
        detailsFingerprint: 'abc',
        detailsCompletedAt: '2026-08-13T00:00:00.000Z',
      },
      original,
      { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-two' },
    )).resolves.toMatchObject({
      ...original,
      organizationName: 'integration-organization',
      detailsCompletedAt: '2026-08-13T00:00:00.000Z',
      detailsFingerprint: 'abc',
    })
  })

  it('requires both server-owned completion markers for trusted stage two', async () => {
    const original = { city: 11, detailsCompletedAt: null, status: 'pending' }
    const context = { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-two' }

    await expect(update({ organizationName: '甲公司' }, original, context)).rejects.toThrow(
      'city_partner_details_completion_markers_required',
    )
    await expect(update({
      organizationName: '甲公司',
      detailsCompletedAt: '2026-08-13T00:00:00.000Z',
      detailsFingerprint: '   ',
    }, original, context)).rejects.toThrow('city_partner_details_completion_markers_required')
  })

  it('rejects overwriting unsealed stage-two facts but treats blanks as empty', async () => {
    const context = { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-two' }
    const markers = {
      detailsCompletedAt: '2026-08-13T00:00:00.000Z',
      detailsFingerprint: 'fingerprint',
    }

    for (const previous of [
      { organizationName: '旧公司' },
      { resourceTypes: ['building-owner'] },
    ]) {
      await expect(update(
        { organizationName: '新公司', ...markers },
        { city: 11, status: 'pending', detailsCompletedAt: null, ...previous },
        context,
      )).rejects.toThrow('city_partner_unsealed_details_require_manual_repair')
    }

    await expect(update(
      { organizationName: '新公司', ...markers },
      {
        city: 11,
        status: 'pending',
        detailsCompletedAt: null,
        organizationName: '   ',
        resourceTypes: [],
      },
      context,
    )).resolves.toMatchObject({ organizationName: '新公司' })
  })

  it('enforces fresh manage permission and original city membership for workflow writes', async () => {
    const original = { city: { id: 11 }, status: 'pending', detailsCompletedAt: null }

    await expect(update(
      { status: 'contacted' },
      original,
      {},
      adminReq({ code: 'MGR', cityIds: [11] }),
    )).resolves.toMatchObject({ status: 'contacted' })

    await expect(protectCityPartnerApplication({
      operation: 'update',
      data: { status: 'contacted' },
      originalDoc: { ...original, city: { id: 12 } },
      overrideAccess: true,
      req: adminReq({ code: 'MGR', cityIds: [11] }),
    } as never)).rejects.toThrow('city_partner_city_scope_required')

    await expect(update(
      { status: 'contacted' },
      { ...original, city: { id: 99 } },
      {},
      adminReq({ code: 'ADM', cityIds: [] }),
    )).resolves.toMatchObject({ status: 'contacted' })
  })

  it('fails closed for empty MGR city scope and matches numeric or string relation IDs', async () => {
    await expect(protectCityPartnerApplication({
      operation: 'update',
      data: { status: 'contacted' },
      originalDoc: { city: 11, status: 'pending', detailsCompletedAt: null },
      overrideAccess: true,
      req: adminReq({ code: 'MGR', cityIds: [] }),
    } as never)).rejects.toThrow('city_partner_city_scope_required')

    await expect(update(
      { status: 'contacted' },
      { city: 11, status: 'pending', detailsCompletedAt: null },
      {},
      adminReq({ code: 'MGR', cityIds: [11] }),
    )).resolves.toMatchObject({ status: 'contacted' })

    await expect(update(
      { status: 'contacted' },
      { city: { id: '11' }, status: 'pending', detailsCompletedAt: null },
      {},
      adminReq({ code: 'MGR', cityIds: [11] }),
    )).resolves.toMatchObject({ status: 'contacted' })

    await expect(update(
      { status: 'contacted' },
      { city: 11, status: 'pending', detailsCompletedAt: null },
      {},
      adminReq({ code: 'MGR', cityIds: ['11'] }),
    )).resolves.toMatchObject({ status: 'contacted' })

    await expect(update(
      { status: 'contacted' },
      { city: { id: 99 }, status: 'pending', detailsCompletedAt: null },
      {},
      adminReq({ code: 'ADM', cityIds: [] }),
    )).resolves.toMatchObject({ status: 'contacted' })
  })
})
