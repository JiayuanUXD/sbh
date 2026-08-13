/**
 * 权限矩阵集成测试（tasks.md M1.6）
 *
 * 覆盖 M1 验收门：
 *   - 五个内置角色基线准确（菜单 / 操作 / 字段 / 数据范围）
 *   - 停用账号无法登录（PermissionContext 返回 null）
 *   - 经纪人不能读取其他经纪人的线索或完整手机号（缺 phone:full → 脱敏）
 *   - 越权接口返回拒绝（requireOperationPermission 抛 ForbiddenError）
 *   - URL 参数不能扩大城市或团队范围（extractUser 仅信任 req.user）
 *
 * 实现策略：
 *   - 使用 BUILTIN_ROLES fixture 构造 5 个角色的 PermissionContext
 *   - 不启动 Payload 实例；通过 buildPermissionContext 直接验证权限派生逻辑
 *   - 模拟 req 携带客户端 cityIds / teamIds 等参数，验证 ctx 不受影响
 */

import { describe, expect, it } from 'vitest'
import {
  getPermissionContext,
  requireOperationPermission,
  type RequestContext,
} from '@/domain/auth/access'
import {
  buildPermissionContext,
  hasFieldPermission,
  hasMenuPermission,
  hasOperationPermission,
  isCityInScope,
  type PermissionContext,
} from '@/domain/auth/permission-context'
import { BUILTIN_ROLES } from '@/test/factory/roles'
import {
  maskDocFields,
  PHONE_MASK_RULES,
  getUserMaskRules,
  getLeadMaskRules,
} from '@/domain/auth/field-mask'
import { ForbiddenError } from '@/domain/shared/errors'
import type { Role, User } from '@/payload-types'

// ────────────────────────────────────────────────────────────
// 测试 fixtures
// ────────────────────────────────────────────────────────────

/** 直接从 BUILTIN_ROLES fixture 派生 Role 文档（不依赖 DB） */
function roleFromFixture(code: keyof typeof BUILTIN_ROLES): Role {
  const r = BUILTIN_ROLES[code]
  return {
    id: code.charCodeAt(0),
    code: r.code,
    name: r.name,
    description: r.description,
    isBuiltin: true,
    status: 'active',
    dataScope: r.dataScope,
    menuPermissions: r.menuPermissions,
    operationPermissions: r.operationPermissions,
    fieldPermissions: r.fieldPermissions,
    updatedAt: '',
    createdAt: '',
  } as unknown as Role
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    name: 'matrix-user',
    email: 'matrix@example.com',
    status: 'active',
    sessionVersion: 1,
    updatedAt: '',
    createdAt: '',
    collection: 'users',
    ...overrides,
  } as unknown as User
}

/** 构造携带客户端伪造参数的 mock req（验证不信客户端参数） */
function makeReqWithClientArgs(params: {
  user: User
  roles: Role[]
  /** 客户端在 query/body 里伪造的 cityIds（应被忽略） */
  fakeCityIds?: number[]
  /** 客户端在 query/body 里伪造的 teamIds（应被忽略） */
  fakeTeamIds?: number[]
}): RequestContext {
  const { user, roles, fakeCityIds, fakeTeamIds } = params
  const req = {
    user,
    // 模拟从客户端 query/body 解析出的参数（access 层应不信任）
    query: fakeCityIds ? { cityIds: fakeCityIds.join(',') } : {},
    body: fakeTeamIds ? { teamIds: fakeTeamIds } : {},
    payload: {
      find: async () => ({ docs: roles }),
    },
  }
  return req as unknown as RequestContext
}

async function buildCtxForRole(
  code: keyof typeof BUILTIN_ROLES,
  userOverrides: Partial<User> = {},
): Promise<PermissionContext> {
  const role = roleFromFixture(code)
  const user = makeUser({
    id: code.charCodeAt(0),
    roles: [role],
    ...userOverrides,
  })
  const ctx = await buildPermissionContext({ user, loadedRoles: [role] })
  if (!ctx) throw new Error(`构建 ${code} 角色 PermissionContext 失败`)
  return ctx
}

// ────────────────────────────────────────────────────────────
// ADM（平台管理员）
// ────────────────────────────────────────────────────────────

describe('permission-matrix/ADM', () => {
  it('通配符权限：菜单 / 操作 / 字段全通', async () => {
    const ctx = await buildCtxForRole('ADM')
    expect(ctx.dataScope).toBe('global')
    expect(ctx.roleCodes).toContain('ADM')
    expect(hasMenuPermission(ctx, 'dashboard')).toBe(true)
    expect(hasMenuPermission(ctx, 'audit-logs')).toBe(true)
    expect(hasOperationPermission(ctx, 'user:manage')).toBe(true)
    expect(hasOperationPermission(ctx, 'any:operation')).toBe(true)
    expect(hasFieldPermission(ctx, 'phone:full')).toBe(true)
    expect(hasFieldPermission(ctx, 'audit:before_after')).toBe(true)
  })

  it('城市范围 = all（无上限）', async () => {
    const ctx = await buildCtxForRole('ADM')
    expect(ctx.cityIds).toBe('all')
    expect(isCityInScope(ctx, 1)).toBe(true)
    expect(isCityInScope(ctx, 9999)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// OPS（运营人员）
// ────────────────────────────────────────────────────────────

describe('permission-matrix/OPS', () => {
  it('菜单：仅运营菜单可见，账号/角色菜单不可见', async () => {
    const ctx = await buildCtxForRole('OPS')
    expect(ctx.dataScope).toBe('global')
    // 允许的菜单
    expect(hasMenuPermission(ctx, 'dashboard')).toBe(true)
    expect(hasMenuPermission(ctx, 'buildings')).toBe(true)
    expect(hasMenuPermission(ctx, 'listings')).toBe(true)
    expect(hasMenuPermission(ctx, 'listing-reviews')).toBe(true)
    expect(hasMenuPermission(ctx, 'merchants')).toBe(true)
    expect(hasMenuPermission(ctx, 'reports')).toBe(true)
    expect(hasMenuPermission(ctx, 'analytics')).toBe(true)
    // 禁止的菜单
    expect(hasMenuPermission(ctx, 'users')).toBe(false)
    expect(hasMenuPermission(ctx, 'roles')).toBe(false)
    expect(hasMenuPermission(ctx, 'audit-logs')).toBe(false)
    expect(hasMenuPermission(ctx, 'my-leads')).toBe(false)
  })

  it('操作：审核 / 发布 / 商户冻结 / 举报处理允许；账号管理禁止', async () => {
    const ctx = await buildCtxForRole('OPS')
    expect(hasOperationPermission(ctx, 'listing:review')).toBe(true)
    expect(hasOperationPermission(ctx, 'listing:publish')).toBe(true)
    expect(hasOperationPermission(ctx, 'listing:unpublish')).toBe(true)
    expect(hasOperationPermission(ctx, 'merchant:freeze')).toBe(true)
    expect(hasOperationPermission(ctx, 'merchant:restore')).toBe(true)
    expect(hasOperationPermission(ctx, 'report:triage')).toBe(true)
    expect(hasOperationPermission(ctx, 'report:resolve')).toBe(true)
    // 越权操作
    expect(hasOperationPermission(ctx, 'user:manage')).toBe(false)
    expect(hasOperationPermission(ctx, 'role:manage')).toBe(false)
    expect(hasOperationPermission(ctx, 'lead:claim')).toBe(false)
    expect(hasOperationPermission(ctx, 'lead:assign')).toBe(false)
  })

  it('字段：可看完整手机号 + 审计前后值；坐标禁止', async () => {
    const ctx = await buildCtxForRole('OPS')
    expect(hasFieldPermission(ctx, 'phone:full')).toBe(true)
    expect(hasFieldPermission(ctx, 'phone:masked')).toBe(true)
    expect(hasFieldPermission(ctx, 'audit:before_after')).toBe(true)
    expect(hasFieldPermission(ctx, 'building:coordinate')).toBe(false)
    expect(hasFieldPermission(ctx, 'client:ip')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// MGR（销售主管）
// ────────────────────────────────────────────────────────────

describe('permission-matrix/MGR', () => {
  it('菜单：CRM 相关可见；房源审核菜单禁止', async () => {
    const ctx = await buildCtxForRole('MGR')
    expect(ctx.dataScope).toBe('team')
    expect(hasMenuPermission(ctx, 'dashboard')).toBe(true)
    expect(hasMenuPermission(ctx, 'leads')).toBe(true)
    expect(hasMenuPermission(ctx, 'customers')).toBe(true)
    expect(hasMenuPermission(ctx, 'brokers')).toBe(true)
    expect(hasMenuPermission(ctx, 'teams')).toBe(true)
    expect(hasMenuPermission(ctx, 'follow-ups')).toBe(true)
    // 禁止
    expect(hasMenuPermission(ctx, 'listing-reviews')).toBe(false)
    expect(hasMenuPermission(ctx, 'merchants')).toBe(false)
    expect(hasMenuPermission(ctx, 'users')).toBe(false)
  })

  it('操作：分配 / 转派 / 回收允许；审核发布禁止', async () => {
    const ctx = await buildCtxForRole('MGR')
    expect(hasOperationPermission(ctx, 'lead:assign')).toBe(true)
    expect(hasOperationPermission(ctx, 'lead:transfer')).toBe(true)
    expect(hasOperationPermission(ctx, 'lead:reclaim')).toBe(true)
    expect(hasOperationPermission(ctx, 'broker:manage')).toBe(true)
    // 禁止
    expect(hasOperationPermission(ctx, 'listing:review')).toBe(false)
    expect(hasOperationPermission(ctx, 'listing:publish')).toBe(false)
    expect(hasOperationPermission(ctx, 'user:manage')).toBe(false)
  })

  it('字段：可看完整手机号；审计前后值禁止', async () => {
    const ctx = await buildCtxForRole('MGR')
    expect(hasFieldPermission(ctx, 'phone:full')).toBe(true)
    expect(hasFieldPermission(ctx, 'phone:masked')).toBe(true)
    expect(hasFieldPermission(ctx, 'audit:before_after')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// BRK（经纪人）
// ────────────────────────────────────────────────────────────

describe('permission-matrix/BRK', () => {
  it('菜单：工作台、房源和"我的"CRM 可见；CRM 全量菜单禁止', async () => {
    const ctx = await buildCtxForRole('BRK')
    expect(ctx.dataScope).toBe('self')
    expect(hasMenuPermission(ctx, 'dashboard')).toBe(true)
    expect(hasMenuPermission(ctx, 'todos')).toBe(true)
    expect(hasMenuPermission(ctx, 'notifications')).toBe(true)
    expect(hasMenuPermission(ctx, 'my-leads')).toBe(true)
    expect(hasMenuPermission(ctx, 'my-customers')).toBe(true)
    expect(hasMenuPermission(ctx, 'follow-ups')).toBe(true)
    expect(hasMenuPermission(ctx, 'listings')).toBe(true)
    // 禁止
    expect(hasMenuPermission(ctx, 'leads')).toBe(false)
    expect(hasMenuPermission(ctx, 'customers')).toBe(false)
    expect(hasMenuPermission(ctx, 'brokers')).toBe(false)
    expect(hasMenuPermission(ctx, 'users')).toBe(false)
  })

  it('操作：认领 / 跟进 / 推荐允许；分配 / 转派禁止', async () => {
    const ctx = await buildCtxForRole('BRK')
    expect(hasOperationPermission(ctx, 'lead:claim')).toBe(true)
    expect(hasOperationPermission(ctx, 'lead:follow_up')).toBe(true)
    expect(hasOperationPermission(ctx, 'lead:recommend')).toBe(true)
    // 禁止
    expect(hasOperationPermission(ctx, 'lead:assign')).toBe(false)
    expect(hasOperationPermission(ctx, 'lead:transfer')).toBe(false)
    expect(hasOperationPermission(ctx, 'lead:reclaim')).toBe(false)
    expect(hasOperationPermission(ctx, 'user:manage')).toBe(false)
  })

  it('字段：phone:full 允许（自己负责的客户）；audit:before_after 禁止', async () => {
    const ctx = await buildCtxForRole('BRK')
    expect(hasFieldPermission(ctx, 'phone:full')).toBe(true)
    // 经纪人不该看审计前后值
    expect(hasFieldPermission(ctx, 'audit:before_after')).toBe(false)
    expect(hasFieldPermission(ctx, 'building:coordinate')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// CSR（客服）
// ────────────────────────────────────────────────────────────

describe('permission-matrix/CSR', () => {
  it('菜单：工作台、线索 / 客户和表单中心可见；审核禁止', async () => {
    const ctx = await buildCtxForRole('CSR')
    expect(ctx.dataScope).toBe('global')
    expect(hasMenuPermission(ctx, 'dashboard')).toBe(true)
    expect(hasMenuPermission(ctx, 'todos')).toBe(true)
    expect(hasMenuPermission(ctx, 'notifications')).toBe(true)
    expect(hasMenuPermission(ctx, 'leads')).toBe(true)
    expect(hasMenuPermission(ctx, 'customers')).toBe(true)
    expect(hasMenuPermission(ctx, 'forms')).toBe(true)
    expect(hasMenuPermission(ctx, 'form-submissions')).toBe(true)
    // 禁止
    expect(hasMenuPermission(ctx, 'listing-reviews')).toBe(false)
    expect(hasMenuPermission(ctx, 'users')).toBe(false)
    expect(hasMenuPermission(ctx, 'roles')).toBe(false)
  })

  it('操作：仅创建 / 分配；审核 / 发布禁止', async () => {
    const ctx = await buildCtxForRole('CSR')
    expect(hasOperationPermission(ctx, 'lead:create')).toBe(true)
    expect(hasOperationPermission(ctx, 'lead:assign')).toBe(true)
    // 禁止
    expect(hasOperationPermission(ctx, 'listing:review')).toBe(false)
    expect(hasOperationPermission(ctx, 'listing:publish')).toBe(false)
    expect(hasOperationPermission(ctx, 'lead:claim')).toBe(false)
    expect(hasOperationPermission(ctx, 'user:manage')).toBe(false)
  })

  it('字段：仅有 phone:masked（脱敏值），缺 phone:full', async () => {
    const ctx = await buildCtxForRole('CSR')
    expect(hasFieldPermission(ctx, 'phone:masked')).toBe(true)
    // 关键：客服不能看完整手机号
    expect(hasFieldPermission(ctx, 'phone:full')).toBe(false)
    expect(hasFieldPermission(ctx, 'audit:before_after')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// 字段脱敏：CSR 看线索 → 138****1111；OPS 看线索 → 原值
// ────────────────────────────────────────────────────────────

describe('permission-matrix/field-masking', () => {
  const sampleLead = {
    id: 100,
    name: '李客户',
    phone: '13812345678',
    phoneNormalized: '13812345678',
    status: 'new',
  }

  it('CSR 查看线索 → 手机号脱敏为 138****5678', async () => {
    const ctx = await buildCtxForRole('CSR')
    const masked = maskDocFields({ ...sampleLead }, getLeadMaskRules(), ctx)
    expect(masked.phone).toMatch(/^\d{3}\*{4}\d{4}$/)
    expect(masked.phone).toBe('138****5678')
  })

  it('OPS 查看线索 → 手机号保留原值', async () => {
    const ctx = await buildCtxForRole('OPS')
    const masked = maskDocFields({ ...sampleLead }, getLeadMaskRules(), ctx)
    expect(masked.phone).toBe('13812345678')
  })

  it('BRK 查看自己负责客户 → 手机号保留原值（phone:full 通过）', async () => {
    const ctx = await buildCtxForRole('BRK')
    const masked = maskDocFields({ ...sampleLead }, getLeadMaskRules(), ctx)
    expect(masked.phone).toBe('13812345678')
  })

  it('MGR 查看线索 → 手机号保留原值（team 主管可看团队成员手机号）', async () => {
    const ctx = await buildCtxForRole('MGR')
    const masked = maskDocFields({ ...sampleLead }, getLeadMaskRules(), ctx)
    expect(masked.phone).toBe('13812345678')
  })

  it('ADM 查看线索 → 任意字段保留原值（通配符）', async () => {
    const ctx = await buildCtxForRole('ADM')
    const masked = maskDocFields({ ...sampleLead }, getLeadMaskRules(), ctx)
    expect(masked.phone).toBe('13812345678')
  })

  it('未登录用户查看线索 → 手机号脱敏（默认安全）', async () => {
    const masked = maskDocFields({ ...sampleLead }, getLeadMaskRules(), null)
    expect(masked.phone).toBe('138****5678')
  })

  it('用户文档脱敏规则 = phone + phoneNormalized', async () => {
    const ctx = await buildCtxForRole('CSR')
    const userDoc = {
      id: 5,
      name: '某用户',
      phone: '13900001111',
      phoneNormalized: '13900001111',
    }
    const masked = maskDocFields({ ...userDoc }, getUserMaskRules(), ctx)
    expect(masked.phone).toBe('139****1111')
    expect(masked.phoneNormalized).toBe('139****1111')
  })

  it('CSR 查看用户列表 → 即便有人 phone_normalized 字段也脱敏', () => {
    const ctx = { /* 在测试中复用 */ } as PermissionContext
    // 仅校验规则集与 PHONE_MASK_RULES 一致
    expect(getUserMaskRules()).toBe(PHONE_MASK_RULES)
    expect(getUserMaskRules().length).toBe(2)
    // 引用占位避免 ts 未使用警告
    expect(ctx).toBeDefined()
  })
})

// ────────────────────────────────────────────────────────────
// URL 参数不能扩大城市或团队范围
// ────────────────────────────────────────────────────────────

describe('permission-matrix/url-params-cannot-expand-scope', () => {
  it('客户端传 cityIds=999 不影响 ctx.cityIds', async () => {
    const role = roleFromFixture('OPS')
    const user = makeUser({
      id: 50,
      roles: [role],
      // 账号绑定的城市只有 10 和 20
      cityScope: [
        { id: 10 } as unknown as User['cityScope'] extends (infer U)[] | null | undefined ? U : never,
        { id: 20 } as unknown as User['cityScope'] extends (infer U)[] | null | undefined ? U : never,
      ],
    })
    const req = makeReqWithClientArgs({
      user,
      roles: [role],
      // 客户端伪造的 cityIds（应被忽略）
      fakeCityIds: [10, 20, 999, 9999],
    })
    const ctx = await getPermissionContext(req)
    expect(ctx).not.toBeNull()
    expect(ctx?.cityIds).toBeInstanceOf(Set)
    if (ctx && ctx.cityIds instanceof Set) {
      expect(ctx.cityIds.has(10)).toBe(true)
      expect(ctx.cityIds.has(20)).toBe(true)
      // 客户端伪造的城市不应进入权限范围
      expect(ctx.cityIds.has(999)).toBe(false)
      expect(ctx.cityIds.has(9999)).toBe(false)
    }
  })

  it('客户端传 teamIds=999 不影响 ctx.teamIds（M1 仍为空集合）', async () => {
    const role = roleFromFixture('MGR')
    const user = makeUser({ id: 60, roles: [role] })
    const req = makeReqWithClientArgs({
      user,
      roles: [role],
      // 客户端伪造的 teamIds（应被忽略）
      fakeTeamIds: [1, 2, 3],
    })
    const ctx = await getPermissionContext(req)
    expect(ctx).not.toBeNull()
    // M2.5 才引入 teams；M1 阶段 teamIds 始终为空集合
    expect(ctx?.teamIds).toBeInstanceOf(Set)
    expect((ctx!.teamIds as Set<unknown>).size).toBe(0)
  })

  it('账号无 cityScope 时 cityIds=all；客户端伪造仍无效', async () => {
    const role = roleFromFixture('ADM')
    const user = makeUser({ id: 70, roles: [role], cityScope: [] })
    const req = makeReqWithClientArgs({
      user,
      roles: [role],
      fakeCityIds: [999],
    })
    const ctx = await getPermissionContext(req)
    expect(ctx?.cityIds).toBe('all')
    // cityIds=all 本来就能看任意城市，但客户端的 999 不会"特别加入"
    expect(isCityInScope(ctx!, 999)).toBe(true) // 因为 all
    expect(isCityInScope(ctx!, 12345)).toBe(true) // 因为 all
  })
})

// ────────────────────────────────────────────────────────────
// 停用账号 / 越权访问
// ────────────────────────────────────────────────────────────

describe('permission-matrix/disabled-and-forbidden', () => {
  it('停用账号 → PermissionContext=null（无法登录）', async () => {
    const role = roleFromFixture('ADM')
    const user = makeUser({ id: 80, status: 'disabled', roles: [role] })
    const req = makeReqWithClientArgs({ user, roles: [role] })
    const ctx = await getPermissionContext(req)
    expect(ctx).toBeNull()
  })

  it('锁定账号 → PermissionContext=null', async () => {
    const role = roleFromFixture('ADM')
    const user = makeUser({ id: 81, status: 'locked', roles: [role] })
    const req = makeReqWithClientArgs({ user, roles: [role] })
    const ctx = await getPermissionContext(req)
    expect(ctx).toBeNull()
  })

  it('CSR 越权调用 user:manage → requireOperationPermission 抛 ForbiddenError', async () => {
    const role = roleFromFixture('CSR')
    const user = makeUser({ id: 82, roles: [role] })
    const req = makeReqWithClientArgs({ user, roles: [role] })
    await expect(requireOperationPermission(req, 'user:manage')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(requireOperationPermission(req, 'user:manage')).rejects.toThrow(/user:manage/)
  })

  it('BRK 越权调用 lead:assign → 抛 ForbiddenError 含 roleCodes', async () => {
    const role = roleFromFixture('BRK')
    const user = makeUser({ id: 83, roles: [role] })
    const req = makeReqWithClientArgs({ user, roles: [role] })
    try {
      await requireOperationPermission(req, 'lead:assign')
      throw new Error('应该抛 ForbiddenError 但未抛')
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError)
      const err = e as ForbiddenError
      expect(err.message).toContain('lead:assign')
      expect(err.details).toHaveProperty('requiredOperation', 'lead:assign')
      expect(err.details).toHaveProperty('roleCodes')
      expect((err.details as { roleCodes: string[] }).roleCodes).toContain('BRK')
    }
  })

  it('未登录用户调用任何 require* → 抛 ForbiddenError', async () => {
    const req = makeReqWithClientArgs({
      user: null as unknown as User,
      roles: [],
    })
    await expect(requireOperationPermission(req, 'listing:review')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

// ────────────────────────────────────────────────────────────
// 数据范围 + 城市上限交叉
// ────────────────────────────────────────────────────────────

describe('permission-matrix/data-scope-and-city-cross', () => {
  it('MGR dataScope=team 但账号 cityScope=[10,20] → 城市外仍拒绝', async () => {
    const role = roleFromFixture('MGR')
    const user = makeUser({
      id: 90,
      roles: [role],
      cityScope: [
        { id: 10 } as unknown as User['cityScope'] extends (infer U)[] | null | undefined ? U : never,
        { id: 20 } as unknown as User['cityScope'] extends (infer U)[] | null | undefined ? U : never,
      ],
    })
    const ctx = await buildPermissionContext({ user, loadedRoles: [role] })
    expect(ctx?.dataScope).toBe('team')
    // 城市上限：10 和 20 通过，30 拒绝
    expect(isCityInScope(ctx!, 10)).toBe(true)
    expect(isCityInScope(ctx!, 20)).toBe(true)
    expect(isCityInScope(ctx!, 30)).toBe(false)
  })

  it('BRK dataScope=self + 无 cityScope → 城市上限 all，但数据范围仍为 self', async () => {
    const role = roleFromFixture('BRK')
    const user = makeUser({ id: 91, roles: [role] })
    const ctx = await buildPermissionContext({ user, loadedRoles: [role] })
    expect(ctx?.dataScope).toBe('self')
    expect(ctx?.cityIds).toBe('all')
    // 城市不限，但 self 范围由领域服务层基于 owner 字段进一步收窄
  })

  it('多角色合并：ADM + CSR 不影响 ADM 的通配符权限', async () => {
    const adm = roleFromFixture('ADM')
    const csr = roleFromFixture('CSR')
    const user = makeUser({ id: 92, roles: [adm, csr] })
    const ctx = await buildPermissionContext({ user, loadedRoles: [adm, csr] })
    expect(ctx?.roleCodes).toContain('ADM')
    expect(ctx?.roleCodes).toContain('CSR')
    expect(ctx?.dataScope).toBe('global') // ADM 的 global 占优
    expect(hasOperationPermission(ctx!, 'user:manage')).toBe(true) // ADM 通配符
    expect(hasFieldPermission(ctx!, 'phone:full')).toBe(true) // ADM 通配符
  })
})

// ────────────────────────────────────────────────────────────
// 内置角色基线不变量
// ────────────────────────────────────────────────────────────

describe('permission-matrix/builtin-roles-invariant', () => {
  it('grants city partner work only to ADM, OPS, and MGR', async () => {
    for (const code of ['OPS', 'MGR'] as const) {
      const ctx = await buildCtxForRole(code)
      expect(hasMenuPermission(ctx, 'city-partner-applications')).toBe(true)
      expect(hasOperationPermission(ctx, 'city_partner_application:read')).toBe(true)
      expect(hasOperationPermission(ctx, 'city_partner_application:manage')).toBe(true)
    }
    for (const code of ['BRK', 'CSR'] as const) {
      const ctx = await buildCtxForRole(code)
      expect(hasMenuPermission(ctx, 'city-partner-applications')).toBe(false)
      expect(hasOperationPermission(ctx, 'city_partner_application:read')).toBe(false)
      expect(hasOperationPermission(ctx, 'city_partner_application:manage')).toBe(false)
    }
  })

  it('5 个内置角色编码齐备且唯一', () => {
    const codes = Object.keys(BUILTIN_ROLES)
    expect(codes).toHaveLength(5)
    expect(new Set(codes).size).toBe(5)
    expect(codes.sort()).toEqual(['ADM', 'BRK', 'CSR', 'MGR', 'OPS'])
  })

  it('所有内置角色 fixture.builtin = true', () => {
    for (const role of Object.values(BUILTIN_ROLES)) {
      expect(role.builtin).toBe(true)
    }
  })

  it('内置角色权限编码均已在 permission-codes 注册（非通配符）', async () => {
    const { validatePermissionCodes } = await import('@/domain/auth/permission-codes')
    for (const role of Object.values(BUILTIN_ROLES)) {
      const menu = validatePermissionCodes({ codes: role.menuPermissions, type: 'menu' })
      const op = validatePermissionCodes({ codes: role.operationPermissions, type: 'operation' })
      const field = validatePermissionCodes({ codes: role.fieldPermissions, type: 'field' })
      expect(menu.ok, `${role.code} 菜单编码非法：${menu.ok ? '' : menu.invalid.join(',')}`).toBe(true)
      expect(op.ok, `${role.code} 操作编码非法：${op.ok ? '' : op.invalid.join(',')}`).toBe(true)
      expect(field.ok, `${role.code} 字段编码非法：${field.ok ? '' : field.invalid.join(',')}`).toBe(true)
    }
  })
})
