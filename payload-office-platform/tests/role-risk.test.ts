import { describe, expect, it } from 'vitest'

import {
  detectRoleRisks,
  riskLevelColor,
  riskLevelLabel,
  type RoleRiskInput,
  type RoleRiskLevel,
} from '@/domain/auth/role-risk'

// ────────────────────────────────────────────────────────────
// 测试 fixtures
// ────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<RoleRiskInput> = {}): RoleRiskInput {
  return {
    isBuiltin: false,
    dataScope: 'city',
    menuPermissions: ['dashboard', 'listings'],
    operationPermissions: ['listing:create'],
    fieldPermissions: ['phone:masked'],
    ...overrides,
  }
}

// ────────────────────────────────────────────────────────────
// detectRoleRisks
// ────────────────────────────────────────────────────────────

describe('role-risk/detectRoleRisks', () => {
  it('自定义角色无风险配置 → 返回空数组', () => {
    const input = makeInput()
    const risks = detectRoleRisks(input)
    expect(risks).toEqual([])
  })

  it('自定义角色 dataScope=global → warning 风险', () => {
    const risks = detectRoleRisks(makeInput({ dataScope: 'global' }))
    expect(risks).toHaveLength(1)
    expect(risks[0]).toMatchObject({
      level: 'warning',
      code: 'CUSTOM_ROLE_GLOBAL_SCOPE',
      field: 'dataScope',
    })
    expect(risks[0].message).toContain('global')
  })

  it('自定义角色菜单通配符 * → danger 风险', () => {
    const risks = detectRoleRisks(
      makeInput({ menuPermissions: ['dashboard', '*'] }),
    )
    expect(risks).toHaveLength(1)
    expect(risks[0]).toMatchObject({
      level: 'danger',
      code: 'CUSTOM_ROLE_MENU_WILDCARD',
      field: 'menuPermissions',
    })
    expect(risks[0].message).toContain('菜单')
  })

  it('自定义角色操作通配符 * → danger 风险', () => {
    const risks = detectRoleRisks(
      makeInput({ operationPermissions: ['*'] }),
    )
    expect(risks).toHaveLength(1)
    expect(risks[0]).toMatchObject({
      level: 'danger',
      code: 'CUSTOM_ROLE_OPERATION_WILDCARD',
      field: 'operationPermissions',
    })
    expect(risks[0].message).toContain('操作')
  })

  it('自定义角色字段通配符 * → danger 风险', () => {
    const risks = detectRoleRisks(
      makeInput({ fieldPermissions: ['phone:full', '*'] }),
    )
    expect(risks).toHaveLength(1)
    expect(risks[0]).toMatchObject({
      level: 'danger',
      code: 'CUSTOM_ROLE_FIELD_WILDCARD',
      field: 'fieldPermissions',
    })
    expect(risks[0].message).toContain('字段')
  })

  it('多项风险叠加 → 返回多项风险', () => {
    const risks = detectRoleRisks({
      isBuiltin: false,
      dataScope: 'global',
      menuPermissions: ['*'],
      operationPermissions: ['*'],
      fieldPermissions: ['*'],
    })
    expect(risks).toHaveLength(4)
    const codes = risks.map((r) => r.code)
    expect(codes).toContain('CUSTOM_ROLE_GLOBAL_SCOPE')
    expect(codes).toContain('CUSTOM_ROLE_MENU_WILDCARD')
    expect(codes).toContain('CUSTOM_ROLE_OPERATION_WILDCARD')
    expect(codes).toContain('CUSTOM_ROLE_FIELD_WILDCARD')
  })

  it('内置角色（isBuiltin=true）即便 global + 通配符 → 无风险', () => {
    const risks = detectRoleRisks({
      isBuiltin: true,
      dataScope: 'global',
      menuPermissions: ['*'],
      operationPermissions: ['*'],
      fieldPermissions: ['*'],
    })
    expect(risks).toEqual([])
  })

  it('isBuiltin=null → 按自定义角色处理（检测风险）', () => {
    const risks = detectRoleRisks({
      isBuiltin: null,
      dataScope: 'global',
      menuPermissions: ['*'],
    })
    expect(risks).toHaveLength(2)
  })

  it('isBuiltin=undefined → 按自定义角色处理（检测风险）', () => {
    const risks = detectRoleRisks({
      isBuiltin: undefined,
      dataScope: 'global',
    })
    expect(risks).toHaveLength(1)
    expect(risks[0].code).toBe('CUSTOM_ROLE_GLOBAL_SCOPE')
  })

  it('isBuiltin=false 显式 → 检测风险', () => {
    const risks = detectRoleRisks({
      isBuiltin: false,
      dataScope: 'global',
    })
    expect(risks).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────
// 非字符串 / 异常输入容错
// ────────────────────────────────────────────────────────────

describe('role-risk/robustness', () => {
  it('menuPermissions 非数组 → 不检测通配符', () => {
    const risks = detectRoleRisks({
      isBuiltin: false,
      menuPermissions: 'dashboard', // 误传字符串
    })
    expect(risks).toEqual([])
  })

  it('operationPermissions null → 不检测通配符', () => {
    const risks = detectRoleRisks({
      isBuiltin: false,
      operationPermissions: null,
    })
    expect(risks).toEqual([])
  })

  it('fieldPermissions 数组中含非字符串元素 → 不抛错', () => {
    expect(() =>
      detectRoleRisks({
        isBuiltin: false,
        fieldPermissions: ['phone:full', 123, null, { foo: 'bar' }, '*'],
      }),
    ).not.toThrow()
  })

  it('dataScope 为空字符串 / 未设置 → 不视为 global', () => {
    expect(detectRoleRisks({ isBuiltin: false, dataScope: '' })).toEqual([])
    expect(detectRoleRisks({ isBuiltin: false, dataScope: undefined })).toEqual([])
    expect(detectRoleRisks({ isBuiltin: false, dataScope: null })).toEqual([])
  })

  it('dataScope=team/self/city/none → 不触发 global 风险', () => {
    for (const scope of ['team', 'self', 'city', 'none'] as const) {
      const risks = detectRoleRisks({ isBuiltin: false, dataScope: scope })
      expect(risks).toEqual([])
    }
  })

  it('通配符识别仅匹配字符串 "*"（不误判其他值）', () => {
    // 字符串 "*" 才视为通配符；数字 0 / 字符串 "all" 等不触发
    const risks = detectRoleRisks({
      isBuiltin: false,
      menuPermissions: ['all', 'any', 0 as unknown as string],
    })
    expect(risks).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────
// riskLevelColor / riskLevelLabel
// ────────────────────────────────────────────────────────────

describe('role-risk/riskLevelColor', () => {
  it('danger → 红色系', () => {
    expect(riskLevelColor('danger')).toBe('#e03131')
  })

  it('warning → 橙色系', () => {
    expect(riskLevelColor('warning')).toBe('#f08c00')
  })

  it('info → 蓝色系', () => {
    expect(riskLevelColor('info')).toBe('#0b5fff')
  })

  it('未知等级 → 兜底蓝色系', () => {
    expect(riskLevelColor('unknown' as RoleRiskLevel)).toBe('#0b5fff')
  })
})

describe('role-risk/riskLevelLabel', () => {
  it('danger → 高危', () => {
    expect(riskLevelLabel('danger')).toBe('高危')
  })

  it('warning → 警告', () => {
    expect(riskLevelLabel('warning')).toBe('警告')
  })

  it('info → 提示', () => {
    expect(riskLevelLabel('info')).toBe('提示')
  })

  it('未知等级 → 兜底"提示"', () => {
    expect(riskLevelLabel('unknown' as RoleRiskLevel)).toBe('提示')
  })
})

// ────────────────────────────────────────────────────────────
// 内置角色 fixture 不触发风险（业务不变量）
// ────────────────────────────────────────────────────────────

describe('role-risk/builtin-roles-no-risk', () => {
  // 引入内置角色 fixture，确保所有内置角色即便使用通配符 / global，也不触发风险
  it('ADM 内置角色：global + 通配符三层 → 无风险', () => {
    const risks = detectRoleRisks({
      isBuiltin: true,
      dataScope: 'global',
      menuPermissions: ['*'],
      operationPermissions: ['*'],
      fieldPermissions: ['*'],
    })
    expect(risks).toEqual([])
  })

  it('内置角色 dataScope 非 global（如 BRK=self / MGR=team）→ 无风险', () => {
    expect(
      detectRoleRisks({
        isBuiltin: true,
        dataScope: 'self',
        menuPermissions: ['my-leads'],
      }),
    ).toEqual([])
    expect(
      detectRoleRisks({
        isBuiltin: true,
        dataScope: 'team',
        menuPermissions: ['dashboard'],
      }),
    ).toEqual([])
  })
})
