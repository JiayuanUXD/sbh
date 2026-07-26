/**
 * 多城市团队 fixture（tasks.md M2.5）
 *
 * 业务不变量（AGENTS.md §5.5, §6）：
 *   - 团队关联用户、主管、服务城市和服务商圈
 *   - 停用前检查未完成线索并要求转派
 *
 * M0 阶段：仅产出 fixture，不写 Collection。
 */

import type { BuiltinRoleCode } from './roles'

export type CityCode = 'shanghai' | 'beijing' | 'shenzhen' | 'hangzhou' | 'guangzhou'

export type TeamFixture = {
  id: string
  name: string
  city: CityCode
  /** 主管（user fixture id） */
  managerId: string
  /** 成员 user fixture ids */
  memberIds: string[]
  status: 'active' | 'inactive'
  /** 服务商圈（location slug 示例） */
  serviceBusinessAreas: string[]
}

export type UserFixture = {
  id: string
  name: string
  /** 规范化后的 11 位手机号 */
  phone: string
  /** 登录账号（email） */
  email: string
  role: BuiltinRoleCode
  city: CityCode
  teamId?: string
  status: 'active' | 'inactive'
  /** 会话版本：停用账号 → 旧会话失效 */
  sessionVersion: number
}

/** 多城市团队矩阵：覆盖 5 个城市、每城市 1 个团队、每团队 1 主管 + 2 经纪人 */
export const TEAMS: Record<string, TeamFixture> = {
  'team-shanghai-1': {
    id: 'team-shanghai-1',
    name: '上海核心区团队',
    city: 'shanghai',
    managerId: 'user-mgr-shanghai-1',
    memberIds: ['user-brk-shanghai-1', 'user-brk-shanghai-2'],
    status: 'active',
    serviceBusinessAreas: ['jingan', 'huangpu', 'xuhui'],
  },
  'team-beijing-1': {
    id: 'team-beijing-1',
    name: '北京 CBD 团队',
    city: 'beijing',
    managerId: 'user-mgr-beijing-1',
    memberIds: ['user-brk-beijing-1', 'user-brk-beijing-2'],
    status: 'active',
    serviceBusinessAreas: ['cbd', 'wangjing'],
  },
  'team-shenzhen-1': {
    id: 'team-shenzhen-1',
    name: '深圳南山团队',
    city: 'shenzhen',
    managerId: 'user-mgr-shenzhen-1',
    memberIds: ['user-brk-shenzhen-1'],
    status: 'active',
    serviceBusinessAreas: ['nanshan', 'futian'],
  },
  'team-hangzhou-1': {
    id: 'team-hangzhou-1',
    name: '杭州滨江团队',
    city: 'hangzhou',
    managerId: 'user-mgr-hangzhou-1',
    memberIds: [],
    status: 'inactive', // 测试停用团队场景
    serviceBusinessAreas: ['binjiang'],
  },
  'team-guangzhou-1': {
    id: 'team-guangzhou-1',
    name: '广州天河团队',
    city: 'guangzhou',
    managerId: 'user-mgr-guangzhou-1',
    memberIds: ['user-brk-guangzhou-1'],
    status: 'active',
    serviceBusinessAreas: ['tianhe'],
  },
}

/** 5 个角色 × 多城市 → 用户 fixture */
export const USERS: Record<string, UserFixture> = {
  // 平台管理员（全局）
  'user-adm-1': {
    id: 'user-adm-1',
    name: '平台管理员',
    phone: '13900000001',
    email: 'adm@example.com',
    role: 'ADM',
    city: 'shanghai',
    status: 'active',
    sessionVersion: 1,
  },
  // 运营（全局）
  'user-ops-1': {
    id: 'user-ops-1',
    name: '运营小李',
    phone: '13900000002',
    email: 'ops@example.com',
    role: 'OPS',
    city: 'shanghai',
    status: 'active',
    sessionVersion: 1,
  },
  // 客服（全局，脱敏手机号）
  'user-csr-1': {
    id: 'user-csr-1',
    name: '客服小张',
    phone: '13900000003',
    email: 'csr@example.com',
    role: 'CSR',
    city: 'shanghai',
    status: 'active',
    sessionVersion: 1,
  },
  // 上海团队
  'user-mgr-shanghai-1': {
    id: 'user-mgr-shanghai-1',
    name: '上海主管',
    phone: '13900100001',
    email: 'mgr-shanghai@example.com',
    role: 'MGR',
    city: 'shanghai',
    teamId: 'team-shanghai-1',
    status: 'active',
    sessionVersion: 1,
  },
  'user-brk-shanghai-1': {
    id: 'user-brk-shanghai-1',
    name: '上海经纪人 A',
    phone: '13900100002',
    email: 'brk-shanghai-a@example.com',
    role: 'BRK',
    city: 'shanghai',
    teamId: 'team-shanghai-1',
    status: 'active',
    sessionVersion: 1,
  },
  'user-brk-shanghai-2': {
    id: 'user-brk-shanghai-2',
    name: '上海经纪人 B',
    phone: '13900100003',
    email: 'brk-shanghai-b@example.com',
    role: 'BRK',
    city: 'shanghai',
    teamId: 'team-shanghai-1',
    status: 'active',
    sessionVersion: 1,
  },
  // 北京团队
  'user-mgr-beijing-1': {
    id: 'user-mgr-beijing-1',
    name: '北京主管',
    phone: '13900200001',
    email: 'mgr-beijing@example.com',
    role: 'MGR',
    city: 'beijing',
    teamId: 'team-beijing-1',
    status: 'active',
    sessionVersion: 1,
  },
  'user-brk-beijing-1': {
    id: 'user-brk-beijing-1',
    name: '北京经纪人 A',
    phone: '13900200002',
    email: 'brk-beijing-a@example.com',
    role: 'BRK',
    city: 'beijing',
    teamId: 'team-beijing-1',
    status: 'active',
    sessionVersion: 1,
  },
  'user-brk-beijing-2': {
    id: 'user-brk-beijing-2',
    name: '北京经纪人 B（停用）',
    phone: '13900200003',
    email: 'brk-beijing-b@example.com',
    role: 'BRK',
    city: 'beijing',
    teamId: 'team-beijing-1',
    status: 'inactive', // 测试停用经纪人场景
    sessionVersion: 2, // 停用时 sessionVersion + 1 → 旧会话失效
  },
  // 深圳团队
  'user-mgr-shenzhen-1': {
    id: 'user-mgr-shenzhen-1',
    name: '深圳主管',
    phone: '13900300001',
    email: 'mgr-shenzhen@example.com',
    role: 'MGR',
    city: 'shenzhen',
    teamId: 'team-shenzhen-1',
    status: 'active',
    sessionVersion: 1,
  },
  'user-brk-shenzhen-1': {
    id: 'user-brk-shenzhen-1',
    name: '深圳经纪人 A',
    phone: '13900300002',
    email: 'brk-shenzhen-a@example.com',
    role: 'BRK',
    city: 'shenzhen',
    teamId: 'team-shenzhen-1',
    status: 'active',
    sessionVersion: 1,
  },
  // 杭州团队（停用）
  'user-mgr-hangzhou-1': {
    id: 'user-mgr-hangzhou-1',
    name: '杭州主管（团队停用）',
    phone: '13900400001',
    email: 'mgr-hangzhou@example.com',
    role: 'MGR',
    city: 'hangzhou',
    teamId: 'team-hangzhou-1',
    status: 'inactive',
    sessionVersion: 2,
  },
  // 广州团队
  'user-mgr-guangzhou-1': {
    id: 'user-mgr-guangzhou-1',
    name: '广州主管',
    phone: '13900500001',
    email: 'mgr-guangzhou@example.com',
    role: 'MGR',
    city: 'guangzhou',
    teamId: 'team-guangzhou-1',
    status: 'active',
    sessionVersion: 1,
  },
  'user-brk-guangzhou-1': {
    id: 'user-brk-guangzhou-1',
    name: '广州经纪人 A',
    phone: '13900500002',
    email: 'brk-guangzhou-a@example.com',
    role: 'BRK',
    city: 'guangzhou',
    teamId: 'team-guangzhou-1',
    status: 'active',
    sessionVersion: 1,
  },
}

/** 按 role 获取用户 fixture 列表 */
export function listUsersByRole(role: BuiltinRoleCode): UserFixture[] {
  return Object.values(USERS).filter((u) => u.role === role)
}

/** 按 team 获取成员列表 */
export function listTeamMembers(teamId: string): UserFixture[] {
  const team = TEAMS[teamId]
  if (!team) return []
  return [team.managerId, ...team.memberIds]
    .map((id) => USERS[id])
    .filter((u): u is UserFixture => Boolean(u))
}
