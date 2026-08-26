/**
 * 5 个内置角色基线 fixture（AGENTS.md §6, tasks.md M1.2）
 *
 * 业务不变量：
 *   - 不得创建第六种内置角色，也不得删除或改码这五种角色
 *   - 每个角色包含菜单 / 操作 / 数据 / 字段四层权限编码
 *
 * M0 阶段：仅产出 fixture 数据，不写 Collection。
 * M1.2 将基于此 fixture 初始化 roles Collection。
 */

export type BuiltinRoleCode = 'ADM' | 'OPS' | 'MGR' | 'BRK' | 'CSR'

export type PermissionScope =
  | 'global' // 全局数据范围
  | 'city' // 按城市范围
  | 'team' // 按团队范围
  | 'self' // 仅本人
  | 'none' // 无权限

export type RoleFixture = {
  code: BuiltinRoleCode
  name: string
  description: string
  builtin: true // 内置角色，不可删除
  dataScope: PermissionScope
  /** 菜单权限编码示例（M1.2 扩展） */
  menuPermissions: string[]
  /** 操作权限编码示例 */
  operationPermissions: string[]
  /** 字段权限编码示例（如手机号脱敏） */
  fieldPermissions: string[]
}

export const BUILTIN_ROLES: Readonly<Record<BuiltinRoleCode, RoleFixture>> = Object.freeze({
  ADM: {
    code: 'ADM',
    name: '平台管理员',
    description: '系统全局管理，包括账号 / 角色 / 城市区域 / 字典配置',
    builtin: true,
    dataScope: 'global',
    menuPermissions: ['*'],
    operationPermissions: ['*'],
    fieldPermissions: ['*'],
  },
  OPS: {
    code: 'OPS',
    name: '运营人员',
    description: '审核 / 发布 / 商户管理 / 举报处理 / 楼盘维护',
    builtin: true,
    dataScope: 'global',
    menuPermissions: [
      'dashboard',
      'todos',
      'notifications',
      'supply-submissions',
      'city-partner-applications',
      'buildings',
      'listings',
      'locations',
      'business-areas',
      'dictionaries',
      'listing-reviews',
      'merchants',
      'reports',
      'analytics',
      'pages',
      'articles',
      'media',
      'forms',
      'form-submissions',
    ],
    operationPermissions: [
      'task:read',
      'notification:read',
      'supply_submission:read',
      'supply_submission:manage',
      'supply_submission:convert',
      'city_partner_application:read',
      'city_partner_application:manage',
      'listing:review',
      'listing:publish',
      'listing:unpublish',
      'merchant:freeze',
      'merchant:restore',
      'report:read',
      'report:triage',
      'report:resolve',
      // OPT-045 §9：迁移 20260822_001700 给 ADM 与 OPS 授了 data:import，但这份
      // 工厂夹具没跟上。而 scripts/seed.ts 的角色 update 分支**无条件**用
      // BUILTIN_ROLES 覆写，于是「先跑迁移再跑 seed」会把 OPS 刚拿到的导入权限
      // 擦掉（2026-08-23 实测踩到）。ADM 是 ['*'] 不受影响，只有 OPS 会掉。
      'data:import',
    ],
    fieldPermissions: [
      'phone:full', // 运营可看完整手机号
      'phone:masked',
      'audit:before_after',
    ],
  },
  MGR: {
    code: 'MGR',
    name: '销售主管',
    description: '团队管理 / 线索分配 / 经纪人绩效',
    builtin: true,
    dataScope: 'team',
    menuPermissions: [
      'dashboard',
      'todos',
      'notifications',
      'supply-submissions',
      'city-partner-applications',
      'buildings',
      'listings',
      'leads',
      'customers',
      'follow-ups',
      'teams',
      'brokers',
    ],
    operationPermissions: [
      'task:read',
      'notification:read',
      'supply_submission:read',
      'city_partner_application:read',
      'city_partner_application:manage',
      'lead:assign',
      'lead:transfer',
      'lead:reclaim',
      'broker:manage',
    ],
    fieldPermissions: [
      'phone:full',
      'phone:masked',
    ],
  },
  BRK: {
    code: 'BRK',
    name: '经纪人',
    description: '跟进自有线索 / 推荐房源 / 记录跟进',
    builtin: true,
    dataScope: 'self',
    // 不含 supply-submissions：BRK 的 dataScope 是 self，而投放申请的读取
    // 不做逐条数据范围收窄，授权即等于放开全平台房东手机号 / 地址（审查发现的
     // 渠道绕开风险）。审单是供给运营（OPS）的职责，经纪人无需读取。
    menuPermissions: [
      'dashboard',
      'todos',
      'notifications',
      'listings',
      'my-leads',
      'my-customers',
      'follow-ups',
    ],
    operationPermissions: [
      'task:read',
      'notification:read',
      'lead:claim',
      'lead:follow_up',
      'lead:recommend',
    ],
    fieldPermissions: [
      'phone:full', // 自己负责的客户可看完整手机号
    ],
  },
  CSR: {
    code: 'CSR',
    name: '客服',
    description: '受理咨询 / 创建线索 / 不参与审核发布',
    builtin: true,
    dataScope: 'global',
    menuPermissions: [
      'dashboard',
      'todos',
      'notifications',
      'leads',
      'customers',
      'forms',
      'form-submissions',
    ],
    operationPermissions: [
      'task:read',
      'notification:read',
      'lead:create',
      'lead:assign',
    ],
    fieldPermissions: [
      'phone:masked', // 客服只能看脱敏手机号
    ],
  },
})

export function getBuiltinRole(code: BuiltinRoleCode): RoleFixture {
  return BUILTIN_ROLES[code]
}

export function listBuiltinRoles(): RoleFixture[] {
  return Object.values(BUILTIN_ROLES)
}

/** 业务不变量校验：5 个内置角色必须存在且 builtin=true */
export function assertBuiltinRolesInvariant(): void {
  const codes = Object.keys(BUILTIN_ROLES) as BuiltinRoleCode[]
  if (codes.length !== 5) {
    throw new Error(
      `内置角色必须恰好 5 个，当前 ${codes.length}：${codes.join(', ')}`,
    )
  }
  for (const code of codes) {
    const role = BUILTIN_ROLES[code]
    if (role.code !== code) {
      throw new Error(`角色 code 不匹配：${code} vs ${role.code}`)
    }
    if (role.builtin !== true) {
      throw new Error(`内置角色 ${code} 的 builtin 必须为 true`)
    }
  }
}
