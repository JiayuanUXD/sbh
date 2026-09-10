/**
 * 五个内置角色各自看到的导航（OPT-084 Phase 1）
 *
 * 既有的 `admin-navigation-role-matrix` 只按角色 fixture 反推「哪些一级组可见」，
 * 不走解析器，因此看不见两件本次新引入的事：**单叶组会被扁平成顶级叶子**，以及
 * **collection read 权限也参与筛选**。这条快照补的正是这两件事——它跑的是
 * `resolveAdminNavigation` 本身，断言的是每个角色最终拿到的组顺序、扁平叶和叶子总数。
 *
 * `canReadCollection` 固定成「MGR 读不到 city-partner-applications，其余一律可读」：
 * 这是从 master 上 e2e 的 `ROLE_NAVIGATION` 反推的（MGR 有 city_partner_application:read
 * 却看不到那个入口，差额只能出在 collection read 上）。本测试不复刻真实的 access 判定，
 * 只把那一处差异钉住——真实判定由 `admin-nav-scoped-read` 与权限矩阵各自覆盖。
 */

import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import {
  resolveAdminNavigation,
  type ResolvedAdminNavEntry,
} from '@/domain/admin-navigation/resolve-navigation'
import {
  buildPermissionContext,
  type PermissionContext,
} from '@/domain/auth/permission-context'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'

/** MGR 读不到城市合伙人申请（见文件头注释）。 */
const UNREADABLE_FOR_MGR = new Set(['city-partner-applications'])

function roleFromFixture(code: BuiltinRoleCode): Role {
  const fixture = BUILTIN_ROLES[code]

  return {
    id: code.charCodeAt(0),
    code: fixture.code,
    name: fixture.name,
    description: fixture.description,
    isBuiltin: true,
    status: 'active',
    dataScope: fixture.dataScope,
    menuPermissions: fixture.menuPermissions,
    operationPermissions: fixture.operationPermissions,
    fieldPermissions: fixture.fieldPermissions,
    updatedAt: '',
    createdAt: '',
  } as unknown as Role
}

async function permissionFor(code: BuiltinRoleCode): Promise<PermissionContext> {
  const role = roleFromFixture(code)
  const user = {
    id: code.charCodeAt(0),
    name: `nav-${code}`,
    email: `nav-${code}@example.com`,
    status: 'active',
    sessionVersion: 1,
    roles: [role],
    updatedAt: '',
    createdAt: '',
    collection: 'users',
  } as unknown as User

  const context = await buildPermissionContext({ user, loadedRoles: [role] })
  if (!context) throw new Error(`构建 ${code} 的 PermissionContext 失败`)
  return context
}

async function navigationFor(code: BuiltinRoleCode): Promise<readonly ResolvedAdminNavEntry[]> {
  return resolveAdminNavigation({
    groups: ADMIN_NAV_GROUPS,
    permission: await permissionFor(code),
    canReadCollection: (slug) => !(code === 'MGR' && UNREADABLE_FOR_MGR.has(slug)),
  })
}

function groupLabels(entries: readonly ResolvedAdminNavEntry[]): string[] {
  return entries.filter((entry) => entry.kind === 'group').map((entry) => entry.label)
}

function flatLeafLabels(entries: readonly ResolvedAdminNavEntry[]): string[] {
  return entries.filter((entry) => entry.kind === 'leaf').map((entry) => entry.label)
}

function leafCount(entries: readonly ResolvedAdminNavEntry[]): number {
  return entries.reduce(
    (total, entry) => total + (entry.kind === 'group' ? entry.children.length : 1),
    0,
  )
}

function leafLabelsOfGroup(entries: readonly ResolvedAdminNavEntry[], label: string): string[] {
  const group = entries.find((entry) => entry.kind === 'group' && entry.label === label)
  if (!group || group.kind !== 'group') return []
  return group.children.map((leaf) => leaf.label)
}

describe('五角色导航快照', () => {
  it('ADM：八个组全在，没有扁平叶，39 片叶子', async () => {
    const navigation = await navigationFor('ADM')

    expect(groupLabels(navigation)).toEqual([
      '工作台',
      '待处理',
      '房源与楼盘',
      '客户与线索',
      '站点与内容',
      '城市与区域',
      '团队与账号',
      '设置与工具',
    ])
    expect(flatLeafLabels(navigation)).toEqual([])
    expect(leafCount(navigation)).toBe(39)
  })

  it('OPS：五个组 + 扁平叶「配套字典」，26 片叶子', async () => {
    const navigation = await navigationFor('OPS')

    expect(groupLabels(navigation)).toEqual([
      '工作台',
      '待处理',
      '房源与楼盘',
      '站点与内容',
      '城市与区域',
    ])
    expect(flatLeafLabels(navigation)).toEqual(['配套字典'])
    expect(leafCount(navigation)).toBe(26)

    // 「设置与工具」组只剩配套字典一片 → 扁平化，OPS 缺 audit:view 与 search 菜单码
    expect(leafLabelsOfGroup(navigation, '站点与内容')).toEqual([
      '页面内容',
      '资讯中心',
      '素材库',
      '表单管理',
    ])
    expect(leafLabelsOfGroup(navigation, '城市与区域')).toEqual([
      '城市管理',
      '行政区域',
      '商圈管理',
      '地铁管理',
    ])
  })

  it('MGR：五个组，没有扁平叶，12 片叶子', async () => {
    const navigation = await navigationFor('MGR')

    expect(groupLabels(navigation)).toEqual([
      '工作台',
      '待处理',
      '房源与楼盘',
      '客户与线索',
      '团队与账号',
    ])
    expect(flatLeafLabels(navigation)).toEqual([])
    expect(leafCount(navigation)).toBe(12)

    // 城市合伙人申请只因 collection 不可读而消失（菜单码与操作码 MGR 都有）
    expect(leafLabelsOfGroup(navigation, '待处理')).toEqual(['我的待办', '房源投放申请'])
    expect(leafLabelsOfGroup(navigation, '团队与账号')).toEqual([
      '团队管理',
      '经纪人管理',
      '顾问服务时间',
    ])
  })

  it('BRK：两个组 + 两片扁平叶，7 片叶子', async () => {
    const navigation = await navigationFor('BRK')

    expect(groupLabels(navigation)).toEqual(['工作台', '客户与线索'])
    expect(flatLeafLabels(navigation)).toEqual(['我的待办', '房源列表'])
    expect(leafCount(navigation)).toBe(7)
  })

  it('CSR：三个组 + 扁平叶「表单管理」，7 片叶子', async () => {
    const navigation = await navigationFor('CSR')

    expect(groupLabels(navigation)).toEqual(['工作台', '待处理', '客户与线索'])
    expect(flatLeafLabels(navigation)).toEqual(['表单管理'])
    expect(leafCount(navigation)).toBe(7)

    expect(leafLabelsOfGroup(navigation, '待处理')).toEqual(['我的待办', '提交数据'])
    expect(leafLabelsOfGroup(navigation, '客户与线索')).toEqual(['咨询线索', '客户档案'])
  })
})
