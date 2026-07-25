import { describe, expect, it } from 'vitest'

import {
  ALL_PERMISSION_CODES,
  FIELD_CODES,
  MENU_CODES,
  OPERATION_CODES,
  isRegisteredFieldCode,
  isRegisteredMenuCode,
  isRegisteredOperationCode,
  validatePermissionCodes,
} from '@/domain/auth/permission-codes'
import { BUILTIN_ROLES, listBuiltinRoles } from '@/test/factory/roles'

// ────────────────────────────────────────────────────────────
// 注册表基础校验
// ────────────────────────────────────────────────────────────

describe('permission-codes/registry', () => {
  it('菜单编码非空且全部为字符串', () => {
    expect(MENU_CODES.length).toBeGreaterThan(0)
    for (const code of MENU_CODES) {
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
    }
  })

  it('操作编码非空且全部为字符串', () => {
    expect(OPERATION_CODES.length).toBeGreaterThan(0)
    for (const code of OPERATION_CODES) {
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
    }
  })

  it('字段编码非空且全部为字符串', () => {
    expect(FIELD_CODES.length).toBeGreaterThan(0)
    for (const code of FIELD_CODES) {
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
    }
  })

  it('三层命名空间互不重叠', () => {
    const menuSet = new Set(MENU_CODES as readonly string[])
    const opSet = new Set(OPERATION_CODES as readonly string[])
    const fieldSet = new Set(FIELD_CODES as readonly string[])

    for (const code of menuSet) {
      expect(opSet.has(code)).toBe(false)
      expect(fieldSet.has(code)).toBe(false)
    }
    for (const code of opSet) {
      expect(menuSet.has(code)).toBe(false)
      expect(fieldSet.has(code)).toBe(false)
    }
    for (const code of fieldSet) {
      expect(menuSet.has(code)).toBe(false)
      expect(opSet.has(code)).toBe(false)
    }
  })

  it('ALL_PERMISSION_CODES 包含全部三层编码且无重复', () => {
    const total = MENU_CODES.length + OPERATION_CODES.length + FIELD_CODES.length
    expect(ALL_PERMISSION_CODES.length).toBe(total)
    expect(new Set(ALL_PERMISSION_CODES).size).toBe(total)
  })

  it('操作 / 字段编码遵循 domain:action 命名约定', () => {
    for (const code of OPERATION_CODES) {
      expect(code).toMatch(/^[a-z_]+:[a-z_]+$/)
    }
    for (const code of FIELD_CODES) {
      expect(code).toMatch(/^[a-z_]+:[a-z_]+$/)
    }
  })
})

// ────────────────────────────────────────────────────────────
// isRegisteredXxxCode
// ────────────────────────────────────────────────────────────

describe('permission-codes/isRegisteredMenuCode', () => {
  it('已注册菜单编码 → true', () => {
    expect(isRegisteredMenuCode('dashboard')).toBe(true)
    expect(isRegisteredMenuCode('listings')).toBe(true)
    expect(isRegisteredMenuCode('users')).toBe(true)
    expect(isRegisteredMenuCode('roles')).toBe(true)
  })

  it('未注册菜单编码 → false', () => {
    expect(isRegisteredMenuCode('unknown-menu')).toBe(false)
    expect(isRegisteredMenuCode('Dashboard')).toBe(false) // 大小写敏感
    expect(isRegisteredMenuCode('')).toBe(false)
    expect(isRegisteredMenuCode('listing:create')).toBe(false) // 误用操作编码
  })

  it('通配符 * 不是注册菜单编码（由 PermissionContext 单独处理）', () => {
    expect(isRegisteredMenuCode('*')).toBe(false)
  })
})

describe('permission-codes/isRegisteredOperationCode', () => {
  it('已注册操作编码 → true', () => {
    expect(isRegisteredOperationCode('listing:create')).toBe(true)
    expect(isRegisteredOperationCode('listing:review')).toBe(true)
    expect(isRegisteredOperationCode('role:manage')).toBe(true)
    expect(isRegisteredOperationCode('user:manage')).toBe(true)
  })

  it('未注册操作编码 → false', () => {
    expect(isRegisteredOperationCode('listing:unknown')).toBe(false)
    expect(isRegisteredOperationCode('dashboard')).toBe(false) // 误用菜单编码
    expect(isRegisteredOperationCode('')).toBe(false)
  })

  it('通配符 * 不是注册操作编码', () => {
    expect(isRegisteredOperationCode('*')).toBe(false)
  })
})

describe('permission-codes/isRegisteredFieldCode', () => {
  it('已注册字段编码 → true', () => {
    expect(isRegisteredFieldCode('phone:full')).toBe(true)
    expect(isRegisteredFieldCode('phone:masked')).toBe(true)
    expect(isRegisteredFieldCode('audit:before_after')).toBe(true)
    expect(isRegisteredFieldCode('building:coordinate')).toBe(true)
  })

  it('未注册字段编码 → false', () => {
    expect(isRegisteredFieldCode('phone:unknown')).toBe(false)
    expect(isRegisteredFieldCode('dashboard')).toBe(false)
    expect(isRegisteredFieldCode('')).toBe(false)
  })

  it('通配符 * 不是注册字段编码', () => {
    expect(isRegisteredFieldCode('*')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// validatePermissionCodes
// ────────────────────────────────────────────────────────────

describe('permission-codes/validatePermissionCodes', () => {
  it('合法菜单编码数组 → ok=true', () => {
    const result = validatePermissionCodes({
      type: 'menu',
      codes: ['dashboard', 'listings', 'leads'],
    })
    expect(result.ok).toBe(true)
  })

  it('合法操作编码数组 → ok=true', () => {
    const result = validatePermissionCodes({
      type: 'operation',
      codes: ['listing:create', 'listing:review', 'role:manage'],
    })
    expect(result.ok).toBe(true)
  })

  it('合法字段编码数组 → ok=true', () => {
    const result = validatePermissionCodes({
      type: 'field',
      codes: ['phone:full', 'phone:masked', 'audit:before_after'],
    })
    expect(result.ok).toBe(true)
  })

  it('通配符 * 始终通过', () => {
    expect(
      validatePermissionCodes({ type: 'menu', codes: ['*'] }).ok,
    ).toBe(true)
    expect(
      validatePermissionCodes({ type: 'operation', codes: ['*'] }).ok,
    ).toBe(true)
    expect(
      validatePermissionCodes({ type: 'field', codes: ['*'] }).ok,
    ).toBe(true)
  })

  it('混合通配符 + 合法编码 → ok=true', () => {
    const result = validatePermissionCodes({
      type: 'menu',
      codes: ['*', 'dashboard', 'listings'],
    })
    expect(result.ok).toBe(true)
  })

  it('未注册菜单编码 → ok=false 含 invalid 列表', () => {
    const result = validatePermissionCodes({
      type: 'menu',
      codes: ['dashboard', 'unknown-menu', 'listings', 'bad-code'],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.invalid).toEqual(['unknown-menu', 'bad-code'])
    }
  })

  it('未注册操作编码 → ok=false 含 invalid 列表', () => {
    const result = validatePermissionCodes({
      type: 'operation',
      codes: ['listing:create', 'listing:typo', 'unknown:action'],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.invalid).toEqual(['listing:typo', 'unknown:action'])
    }
  })

  it('未注册字段编码 → ok=false 含 invalid 列表', () => {
    const result = validatePermissionCodes({
      type: 'field',
      codes: ['phone:full', 'phone:leak'],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.invalid).toEqual(['phone:leak'])
    }
  })

  it('跨层误用 → ok=false（菜单编码用在操作层）', () => {
    expect(
      validatePermissionCodes({ type: 'operation', codes: ['dashboard'] }).ok,
    ).toBe(false)
    expect(
      validatePermissionCodes({ type: 'menu', codes: ['listing:create'] }).ok,
    ).toBe(false)
    expect(
      validatePermissionCodes({ type: 'field', codes: ['dashboard'] }).ok,
    ).toBe(false)
  })

  it('非数组输入 → ok=true（容错：留空等同未配置）', () => {
    expect(validatePermissionCodes({ type: 'menu', codes: null }).ok).toBe(true)
    expect(validatePermissionCodes({ type: 'menu', codes: undefined }).ok).toBe(true)
    expect(validatePermissionCodes({ type: 'menu', codes: 'dashboard' }).ok).toBe(true)
    expect(validatePermissionCodes({ type: 'menu', codes: {} }).ok).toBe(true)
  })

  it('数组中含非字符串元素 → 跳过非字符串', () => {
    const result = validatePermissionCodes({
      type: 'menu',
      codes: ['dashboard', 123, null, undefined, { foo: 'bar' }, 'listings'],
    })
    expect(result.ok).toBe(true)
  })

  it('空数组 → ok=true', () => {
    expect(validatePermissionCodes({ type: 'menu', codes: [] }).ok).toBe(true)
    expect(validatePermissionCodes({ type: 'operation', codes: [] }).ok).toBe(true)
    expect(validatePermissionCodes({ type: 'field', codes: [] }).ok).toBe(true)
  })

  it('invalid 列表保留原始顺序（不去重）', () => {
    const result = validatePermissionCodes({
      type: 'menu',
      codes: ['bad1', 'bad2', 'bad1'],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // 当前实现不去重，保留原始顺序（含重复）—— 测试当前契约
      expect(result.invalid).toEqual(['bad1', 'bad2', 'bad1'])
    }
  })
})

// ────────────────────────────────────────────────────────────
// 内置角色 fixture 与注册表对齐（防漂移）
// ────────────────────────────────────────────────────────────

describe('permission-codes/builtin-roles-aligned', () => {
  for (const role of listBuiltinRoles()) {
    describe(`内置角色 ${role.code}`, () => {
      it('菜单编码（非通配符）全部在注册表中', () => {
        const result = validatePermissionCodes({
          type: 'menu',
          codes: role.menuPermissions,
        })
        expect(result.ok).toBe(true)
      })

      it('操作编码（非通配符）全部在注册表中', () => {
        const result = validatePermissionCodes({
          type: 'operation',
          codes: role.operationPermissions,
        })
        expect(result.ok).toBe(true)
      })

      it('字段编码（非通配符）全部在注册表中', () => {
        const result = validatePermissionCodes({
          type: 'field',
          codes: role.fieldPermissions,
        })
        expect(result.ok).toBe(true)
      })
    })
  }

  it('ADM 角色使用通配符 * 三层', () => {
    expect(BUILTIN_ROLES.ADM.menuPermissions).toEqual(['*'])
    expect(BUILTIN_ROLES.ADM.operationPermissions).toEqual(['*'])
    expect(BUILTIN_ROLES.ADM.fieldPermissions).toEqual(['*'])
  })

  it('CSR 角色字段层仅含 phone:masked（不可看完整手机号）', () => {
    expect(BUILTIN_ROLES.CSR.fieldPermissions).toEqual(['phone:masked'])
    expect(BUILTIN_ROLES.CSR.fieldPermissions).not.toContain('phone:full')
  })
})
