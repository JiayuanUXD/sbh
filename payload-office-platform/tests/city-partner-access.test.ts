import { describe, expect, it } from 'vitest'

import { CityPartnerApplications } from '@/collections/CityPartnerApplications'
import { getCityPartnerApplicationMaskRules, maskDocFields } from '@/domain/auth/field-mask'

function req(role: {
  code: string
  menuPermissions?: string[]
  operationPermissions: string[]
  fieldPermissions?: string[]
  dataScope: 'global' | 'city' | 'team' | 'self' | 'none'
}, cityIds: number[] = []) {
  return {
    user: {
      id: 7, status: 'active', sessionVersion: 1,
      cityScope: cityIds.map((id) => ({ id })),
      roles: [{ id: 70, status: 'active', builtin: true, ...role }],
    },
    payload: {},
  }
}

async function access(kind: 'read' | 'update', request: ReturnType<typeof req>) {
  const checker = CityPartnerApplications.access?.[kind]
  if (typeof checker !== 'function') return checker
  return checker({ req: request } as never)
}

describe('city partner collection access', () => {
  it('closes public collection create and physical delete', async () => {
    const request = { req: { user: null, payload: {} } } as never
    const create = CityPartnerApplications.access?.create
    const remove = CityPartnerApplications.access?.delete
    expect(typeof create === 'function' ? await create(request) : create).toBe(false)
    expect(typeof remove === 'function' ? await remove(request) : remove).toBe(false)
  })

  it('gives ADM global access and scopes OPS/MGR by trusted city IDs', async () => {
    await expect(access('read', req({
      code: 'ADM', operationPermissions: ['*'], fieldPermissions: ['*'],
      menuPermissions: ['*'], dataScope: 'global',
    }))).resolves.toBe(true)
    await expect(access('read', req({
      code: 'OPS', operationPermissions: ['city_partner_application:read'], dataScope: 'city',
    }, [11, 12]))).resolves.toEqual({ city: { in: [11, 12] } })
    await expect(access('update', req({
      code: 'MGR', operationPermissions: ['city_partner_application:manage'], dataScope: 'team',
    }, [12]))).resolves.toEqual({ city: { in: [12] } })
  })

  it('fails closed without permission or without a bounded city scope', async () => {
    await expect(access('read', req({
      code: 'BRK', operationPermissions: [], dataScope: 'self',
    }, [11]))).resolves.toBe(false)
    await expect(access('read', req({
      code: 'OPS', operationPermissions: ['city_partner_application:read'], dataScope: 'city',
    }))).resolves.toBe(false)
  })

  it('masks contactPhone without phone:full and preserves it with permission', () => {
    const doc = { contactPhone: '13800001111' }
    const base = {
      userId: 1, roleCodes: ['OPS'], cityIds: 'all' as const, teamIds: 'all' as const,
      operationPermissions: new Set<string>(), menuPermissions: new Set<string>(), dataScope: 'global' as const,
    }
    expect(maskDocFields({ ...doc }, getCityPartnerApplicationMaskRules(), {
      ...base, fieldPermissions: new Set(['phone:masked']),
    }).contactPhone).toBe('138****1111')
    expect(maskDocFields({ ...doc }, getCityPartnerApplicationMaskRules(), {
      ...base, fieldPermissions: new Set(['phone:full']),
    }).contactPhone).toBe('13800001111')
  })
})
