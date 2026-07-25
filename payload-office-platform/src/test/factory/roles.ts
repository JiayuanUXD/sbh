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
      'buildings',
      'listings',
      'listing-reviews',
      'merchants',
      'reports',
      'analytics',
    ],
    operationPermissions: [
      'listing:review',
      'listing:publish',
      'listing:unpublish',
      'merchant:freeze',
      'merchant:restore',
      'report:triage',
      'report:resolve',
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
    menuPermissions: ['dashboard', 'leads', 'customers', 'brokers', 'teams', 'follow-ups'],
    operationPermissions: [
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
    menuPermissions: ['my-leads', 'my-customers', 'follow-ups', 'listings'],
    operationPermissions: [
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
    menuPermissions: ['leads', 'customers'],
    operationPermissions: [
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
