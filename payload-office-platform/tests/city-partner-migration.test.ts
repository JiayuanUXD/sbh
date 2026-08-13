import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { planCityPartnerRoleUpdate } from '@/migrations/20260813_021000_city_partner_permissions'

describe('city partner migrations', () => {
  it('contains generated schema constraints and required indexes', () => {
    const file = resolve(process.cwd(), 'src/migrations/20260813_020000_city_partner_applications.ts')
    expect(existsSync(file)).toBe(true)
    const source = readFileSync(file, 'utf8')
    expect(source).toContain('city_partner_applications')
    expect(source).toMatch(/UNIQUE INDEX.*idempotency_key/is)
    for (const column of ['city_id', 'status', 'created_at']) expect(source).toContain(column)
  })

  it('adds exact grants idempotently without creating or changing role codes', () => {
    const ops = {
      id: 2, code: 'OPS', isBuiltin: true,
      menuPermissions: ['dashboard'], operationPermissions: ['listing:review'],
    }
    expect(planCityPartnerRoleUpdate(ops)).toEqual({
      id: 2,
      menuPermissions: ['dashboard', 'city-partner-applications'],
      operationPermissions: [
        'listing:review', 'city_partner_application:read', 'city_partner_application:manage',
      ],
    })
    expect(planCityPartnerRoleUpdate({
      ...ops,
      menuPermissions: ['dashboard', 'city-partner-applications'],
      operationPermissions: [
        'listing:review', 'city_partner_application:read', 'city_partner_application:manage',
      ],
    })).toBeNull()
    expect(planCityPartnerRoleUpdate({ ...ops, code: 'BRK' })).toBeNull()
  })
})
