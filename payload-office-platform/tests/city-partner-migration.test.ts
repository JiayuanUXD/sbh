import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  planCityPartnerRoleUpdate,
  planMissingCityPartnerBuiltinRoles,
} from '@/migrations/20260813_021000_city_partner_permissions'

describe('city partner migrations', () => {
  it('contains generated schema constraints and required indexes', () => {
    const file = resolve(process.cwd(), 'src/migrations/20260813_020000_city_partner_applications.ts')
    expect(existsSync(file)).toBe(true)
    const source = readFileSync(file, 'utf8')
    expect(source).toContain('city_partner_applications')
    expect(source).toMatch(/UNIQUE INDEX.*idempotency_key/is)
    for (const column of ['city_id', 'status', 'created_at']) expect(source).toContain(column)
  })

  it('drops the locked-document FK before the application table can cascade it', () => {
    const file = resolve(process.cwd(), 'src/migrations/20260813_020000_city_partner_applications.ts')
    const source = readFileSync(file, 'utf8')
    const down = source.slice(source.indexOf('export async function down'))
    const foreignKeyDrop = down.indexOf(
      'DROP CONSTRAINT "payload_locked_documents_rels_city_partner_applications_fk"',
    )
    const applicationTableDrop = down.indexOf('DROP TABLE "city_partner_applications" CASCADE')

    expect(foreignKeyDrop).toBeGreaterThan(-1)
    expect(applicationTableDrop).toBeGreaterThan(-1)
    expect(foreignKeyDrop).toBeLessThan(applicationTableDrop)
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

  it('plans the four missing built-in roles when production only has ADM', () => {
    const missing = planMissingCityPartnerBuiltinRoles([
      { id: 1, code: 'ADM', isBuiltin: true },
    ])

    expect(missing.map((role) => role.code)).toEqual(['OPS', 'MGR', 'BRK', 'CSR'])
    expect(missing).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OPS', builtin: true, dataScope: 'global' }),
      expect.objectContaining({ code: 'MGR', builtin: true, dataScope: 'team' }),
      expect.objectContaining({ code: 'BRK', builtin: true, dataScope: 'self' }),
      expect.objectContaining({ code: 'CSR', builtin: true, dataScope: 'global' }),
    ]))
  })

  it('fails closed when a built-in code is occupied by a custom role', () => {
    expect(() => planMissingCityPartnerBuiltinRoles([
      { id: 1, code: 'ADM', isBuiltin: true },
      { id: 2, code: 'OPS', isBuiltin: false },
    ])).toThrow('city_partner_builtin_role_code_occupied:OPS')
  })
})
