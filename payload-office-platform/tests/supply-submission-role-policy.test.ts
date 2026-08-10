import { describe, expect, it, vi } from 'vitest'

import { BUILTIN_ROLES } from '@/test/factory/roles'
import {
  planSupplySubmissionRoleUpdate,
  down,
  up,
  type SupplySubmissionMigrationRole,
} from '@/migrations/20260810_090000_supply_submission_role_permissions'

describe('built-in supply submission role matrix', () => {
  it('ADM and OPS can read and write, including conversion', () => {
    expect(BUILTIN_ROLES.ADM.operationPermissions).toEqual(['*'])
    expect(BUILTIN_ROLES.OPS.menuPermissions).toContain('supply-submissions')
    expect(BUILTIN_ROLES.OPS.operationPermissions).toEqual(
      expect.arrayContaining([
        'notification:read',
        'supply_submission:read',
        'supply_submission:manage',
        'supply_submission:convert',
      ]),
    )
  })

  it('MGR has read-only access', () => {
    expect(BUILTIN_ROLES.MGR.menuPermissions).toContain('supply-submissions')
    expect(BUILTIN_ROLES.MGR.operationPermissions).toContain('supply_submission:read')
    expect(BUILTIN_ROLES.MGR.operationPermissions).not.toContain('supply_submission:manage')
    expect(BUILTIN_ROLES.MGR.operationPermissions).not.toContain('supply_submission:convert')
  })

  // 审查结论：BRK 的 dataScope 是 self，而投放申请的读取不做逐条数据范围收窄，
  // 授予读权限等于把全平台房东的完整手机号与详细地址开放给全体经纪人，形成
  // 绕开平台的渠道风险。审单是供给运营（OPS）的职责，经纪人无需读取。
  it('BRK has no supply submission access at all', () => {
    expect(BUILTIN_ROLES.BRK.menuPermissions).not.toContain('supply-submissions')
    expect(BUILTIN_ROLES.BRK.operationPermissions).not.toContain('supply_submission:read')
    expect(BUILTIN_ROLES.BRK.operationPermissions).not.toContain('supply_submission:manage')
    expect(BUILTIN_ROLES.BRK.operationPermissions).not.toContain('supply_submission:convert')
  })

  it('CSR has no supply submission menu or operation permission', () => {
    expect(BUILTIN_ROLES.CSR.menuPermissions).not.toContain('supply-submissions')
    expect(BUILTIN_ROLES.CSR.operationPermissions).not.toContain('supply_submission:read')
    expect(BUILTIN_ROLES.CSR.operationPermissions).not.toContain('supply_submission:manage')
    expect(BUILTIN_ROLES.CSR.operationPermissions).not.toContain('supply_submission:convert')
  })
})

describe('supply submission role data migration planner', () => {
  function role(overrides: Partial<SupplySubmissionMigrationRole>): SupplySubmissionMigrationRole {
    return {
      id: 1,
      code: 'OPS',
      isBuiltin: true,
      menuPermissions: ['dashboard', 'custom-menu'],
      operationPermissions: ['notification:read', 'custom:permission'],
      ...overrides,
    }
  }

  it('adds the OPS permissions without removing existing custom permissions', () => {
    const update = planSupplySubmissionRoleUpdate(role({}))

    expect(update).toEqual({
      id: 1,
      menuPermissions: ['dashboard', 'custom-menu', 'supply-submissions'],
      operationPermissions: [
        'notification:read',
        'custom:permission',
        'supply_submission:read',
        'supply_submission:manage',
        'supply_submission:convert',
      ],
    })
  })

  it('adds read-only access for MGR', () => {
    const update = planSupplySubmissionRoleUpdate(role({ code: 'MGR' }))

    expect(update?.menuPermissions).toContain('supply-submissions')
    expect(update?.operationPermissions).toContain('supply_submission:read')
    expect(update?.operationPermissions).not.toContain('supply_submission:manage')
    expect(update?.operationPermissions).not.toContain('supply_submission:convert')
  })

  /** BRK 不在迁移目标内，规划器必须完全跳过它，不授予任何投放申请权限。 */
  it('plans no change for BRK', () => {
    expect(planSupplySubmissionRoleUpdate(role({ code: 'BRK' }))).toBeNull()
  })

  it.each([
    role({ code: 'ADM' }),
    role({ code: 'CSR' }),
    role({ code: 'OPS', isBuiltin: false }),
  ])('does not modify roles outside the additive target matrix', (document) => {
    expect(planSupplySubmissionRoleUpdate(document)).toBeNull()
  })

  it('is idempotent when every required permission already exists', () => {
    expect(
      planSupplySubmissionRoleUpdate(
        role({
          menuPermissions: ['supply-submissions'],
          operationPermissions: [
            'supply_submission:read',
            'supply_submission:manage',
            'supply_submission:convert',
          ],
        }),
      ),
    ).toBeNull()
  })

  it('updates only changed fields through raw SQL without Payload Local API', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            code: 'OPS',
            is_builtin: true,
            menu_permissions: ['dashboard', 'custom-menu'],
            operation_permissions: ['notification:read', 'custom:permission'],
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
    const payload = {
      find: vi.fn(),
      update: vi.fn(),
      logger: { warn: vi.fn() },
    }

    await up({ db: { execute }, payload } as never)

    expect(payload.find).not.toHaveBeenCalled()
    expect(payload.update).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('uses a non-destructive down path', async () => {
    const info = vi.fn()
    const payload = { logger: { info } }

    await down({ payload } as never)

    expect(info).toHaveBeenCalledWith(expect.stringContaining('intentionally non-destructive'))
  })
})
