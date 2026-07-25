/**
 * 服务端权限上下文（tasks.md M1.3, design.md §6.2）
 *
 * 设计原则（AGENTS.md §6 强制规则）：
 *   - 权限必须在服务端 Payload access、领域服务或 endpoint 中执行
 *   - 隐藏按钮不是权限控制
 *   - 客户端提交的角色、城市、团队或负责人范围不可信
 *   - URL 查询参数不得扩大用户数据范围
 *   - 手机号、IP、设备、坐标和审计前后值按字段权限脱敏
 *
 * 权限四层：
 *   1. 菜单权限：menuPermissions（允许并集）
 *   2. 操作权限：operationPermissions（允许并集）
 *   3. 数据权限：dataScope（global / city / team / self / none）+ 账号 cityScope 上限
 *   4. 字段权限：fieldPermissions（允许并集）
 *
 * 不可违反：
 *   - 账号城市绑定作为最终上限，不允许角色扩大
 */

import type { Location, Role, User } from '@/payload-types'

/** 角色编码集合 */
export type RoleCodeSet = Set<string>

/** 操作权限编码集合 */
export type OperationPermissionSet = Set<string>

/** 字段权限编码集合 */
export type FieldPermissionSet = Set<string>

/** 数据范围（业务域允许并集） */
export type DataScope = 'global' | 'city' | 'team' | 'self' | 'none'

/** 城市范围：'all' 表示无上限，否则为城市 ID 集合 */
export type CityScope = 'all' | Set<number | string>

/** 团队范围：'all' 表示无上限，否则为团队 ID 集合；M1 暂未实现 teams，留空集合 */
export type TeamScope = 'all' | Set<number | string>

/**
 * 服务端权限上下文
 *
 * 每次请求生成，由服务端从登录用户、角色、城市和团队派生。
 * 客户端参数不能扩大范围。
 */
export type PermissionContext = {
  userId: number | string
  /** 角色编码列表（用于审计日志快照） */
  roleCodes: string[]
  /** 城市范围：账号 cityScope 作为最终上限 */
  cityIds: CityScope
  /** 团队范围（M2.5 引入 teams 后启用；M1 留空集合） */
  teamIds: TeamScope
  /** 操作权限编码集合（允许并集） */
  operationPermissions: OperationPermissionSet
  /** 字段权限编码集合（允许并集） */
  fieldPermissions: FieldPermissionSet
  /** 菜单权限编码集合（允许并集） */
  menuPermissions: Set<string>
  /** 数据范围上限（多角色允许并集） */
  dataScope: DataScope
}

/** 内置角色编码（不可改码、不可删除） */
export const BUILTIN_ROLE_CODES = ['ADM', 'OPS', 'MGR', 'BRK', 'CSR'] as const
export type BuiltinRoleCode = (typeof BUILTIN_ROLE_CODES)[number]

/** 通配符：表示全部权限 */
export const WILDCARD_PERMISSION = '*'

/**
 * 从 Payload User 文档构建 PermissionContext
 *
 * 步骤：
 *   1. 读取 user.roles（hasMany → roles）
 *   2. 合并所有角色的 menuPermissions / operationPermissions / fieldPermissions（允许并集）
 *   3. dataScope 取最宽（global > city > team > self > none）
 *   4. 账号 cityScope 作为城市上限；角色 dataScope=global 仍受账号 cityScope 限制
 *
 * 注意：本函数不信任客户端参数，仅从服务端 Payload user 对象派生。
 */
export async function buildPermissionContext(params: {
  user: Pick<User, 'id' | 'roles' | 'cityScope' | 'status' | 'sessionVersion'>
  /** 通过 payload.findByID 加载的角色文档（避免重复查询） */
  loadedRoles?: Role[]
  /** 加载角色的回调（用于测试时注入 mock） */
  loadRoles?: (roleIds: (number | string)[]) => Promise<Role[]>
}): Promise<PermissionContext | null> {
  const { user, loadedRoles, loadRoles } = params

  if (user.status !== 'active') {
    return null
  }

  // 收集角色 ID（user.roles 是 hasMany → roles）
  const roleDocs = loadedRoles ?? (await loadRolesForUser(user, loadRoles))

  // 合并权限（允许并集）
  const operationPermissions = new Set<string>()
  const fieldPermissions = new Set<string>()
  const menuPermissions = new Set<string>()
  const roleCodes: string[] = []
  let dataScope: DataScope = 'none'

  for (const role of roleDocs) {
    if (role.status !== 'active') continue
    roleCodes.push(role.code ?? '')
    addAll(operationPermissions, parsePermissionArray(role.operationPermissions))
    addAll(fieldPermissions, parsePermissionArray(role.fieldPermissions))
    addAll(menuPermissions, parsePermissionArray(role.menuPermissions))
    dataScope = mergeDataScope(dataScope, (role.dataScope as DataScope) ?? 'self')
  }

  // 账号城市范围：留空 = 'all'；否则收集 city ID
  const cityIds = buildCityScopeFromUser(user)

  return {
    userId: user.id,
    roleCodes,
    cityIds,
    teamIds: new Set(), // M2.5 引入 teams 后启用
    operationPermissions,
    fieldPermissions,
    menuPermissions,
    dataScope,
  }
}

/** 是否拥有指定操作权限（包含通配符 * 检测） */
export function hasOperationPermission(
  ctx: PermissionContext,
  permissionCode: string,
): boolean {
  if (ctx.operationPermissions.has(WILDCARD_PERMISSION)) return true
  return ctx.operationPermissions.has(permissionCode)
}

/** 是否拥有指定字段权限（包含通配符 * 检测） */
export function hasFieldPermission(
  ctx: PermissionContext,
  fieldCode: string,
): boolean {
  if (ctx.fieldPermissions.has(WILDCARD_PERMISSION)) return true
  return ctx.fieldPermissions.has(fieldCode)
}

/** 是否拥有指定菜单权限（包含通配符 * 检测） */
export function hasMenuPermission(
  ctx: PermissionContext,
  menuCode: string,
): boolean {
  if (ctx.menuPermissions.has(WILDCARD_PERMISSION)) return true
  return ctx.menuPermissions.has(menuCode)
}

/** 数据范围合并：取最宽 */
export function mergeDataScope(a: DataScope, b: DataScope): DataScope {
  const order: DataScope[] = ['none', 'self', 'team', 'city', 'global']
  const idxA = order.indexOf(a)
  const idxB = order.indexOf(b)
  return idxA >= idxB ? a : b
}

/** 判断城市是否在权限范围内 */
export function isCityInScope(
  ctx: PermissionContext,
  cityId: number | string | null | undefined,
): boolean {
  if (ctx.cityIds === 'all') return true
  if (cityId === null || cityId === undefined) return false
  return ctx.cityIds.has(cityId)
}

// ────────────────────────────────────────────────────────────
// 内部辅助函数
// ────────────────────────────────────────────────────────────

async function loadRolesForUser(
  user: Pick<User, 'roles' | 'id'>,
  loadRoles?: (roleIds: (number | string)[]) => Promise<Role[]>,
): Promise<Role[]> {
  const roles = user.roles
  if (!roles || !Array.isArray(roles) || roles.length === 0) return []
  // roles 可能是 ID 数组或 Role 文档数组
  const roleIds: (number | string)[] = []
  const alreadyLoaded: Role[] = []
  for (const r of roles) {
    if (typeof r === 'number' || typeof r === 'string') {
      roleIds.push(r)
    } else if (r && typeof r === 'object' && 'id' in r) {
      alreadyLoaded.push(r as unknown as Role)
    }
  }
  if (roleIds.length > 0 && loadRoles) {
    const loaded = await loadRoles(roleIds)
    return [...alreadyLoaded, ...loaded]
  }
  return alreadyLoaded
}

function parsePermissionArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string')
  }
  return []
}

function addAll(set: Set<string>, values: string[]): void {
  for (const v of values) set.add(v)
}

function buildCityScopeFromUser(
  user: Pick<User, 'cityScope'>,
): CityScope {
  const cityScope = user.cityScope
  if (!cityScope || !Array.isArray(cityScope) || cityScope.length === 0) {
    return 'all'
  }
  const ids = new Set<number | string>()
  for (const c of cityScope) {
    if (typeof c === 'number' || typeof c === 'string') {
      ids.add(c)
    } else if (c && typeof c === 'object' && 'id' in c) {
      ids.add((c as Location).id)
    }
  }
  return ids
}
