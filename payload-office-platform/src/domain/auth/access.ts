/**
 * Access hook 统一守卫（tasks.md M1.3, design.md §6.1）
 *
 * 职责：
 *   - 从 Payload 请求派生 PermissionContext 并按请求缓存（避免重复加载角色）
 *   - 提供 requireAdminContext / requireOperationPermission / requireFieldPermission 守卫
 *   - 提供 Payload Collection access 工厂：createCollectionAccess / createDataScopeAccess
 *   - 自定义 endpoint / Custom View 必须先调用 requireAdminContext，再执行业务
 *
 * 设计原则（AGENTS.md §6）：
 *   - 权限必须在服务端执行；隐藏按钮不是权限控制
 *   - 客户端参数不能扩大数据范围
 *   - 越权返回 403，不暴露存在性
 *   - PermissionContext 仅从 req.user 派生；任何客户端 query/body 字段都不参与
 */

import type { PayloadRequest, User as PayloadUser } from 'payload'
import type { Role, User } from '@/payload-types'
import {
  buildPermissionContext,
  hasFieldPermission,
  hasMenuPermission,
  hasOperationPermission,
  isCityInScope,
  type PermissionContext,
} from './permission-context'
import { ForbiddenError } from '@/domain/shared/errors'

/**
 * 请求级缓存键：在 req 对象上挂载 PermissionContext 避免重复加载角色。
 *
 * Payload access.read/create/update/delete 与 beforeOperation 在同一请求内
 * 顺序触发，每次都重新加载角色会产生 N+1 查询。请求开始时构建一次即可。
 */
const PERM_CTX_CACHE_KEY = '__permissionContext'

/**
 * 请求类型扩展：携带可选 PermissionContext 缓存。
 *
 * 通过声明合并让 req 上可以读写该字段；运行期由 getPermissionContext 派生。
 */
export type RequestContext = PayloadRequest & {
  [PERM_CTX_CACHE_KEY]?: PermissionContext | null
}

/**
 * 从 Payload 请求构建（或复用缓存的）PermissionContext。
 *
 * - 未登录用户返回 null；调用方决定拒绝或允许匿名访问
 * - 停用 / 锁定账号返回 null（由 buildPermissionContext 内部判定）
 * - 角色加载通过 req.payload.findByID 完成；同一请求只加载一次
 *
 * 不信客户端参数：仅使用 req.user.id / roles / cityScope / status / sessionVersion。
 */
export async function getPermissionContext(
  req: RequestContext,
): Promise<PermissionContext | null> {
  if (req[PERM_CTX_CACHE_KEY] !== undefined) {
    return req[PERM_CTX_CACHE_KEY]!
  }
  const user = extractUser(req)
  if (!user) {
    req[PERM_CTX_CACHE_KEY] = null
    return null
  }
  const ctx = await buildPermissionContext({
    user,
    loadRoles: async (roleIds) => {
      const docs = await req.payload.find({
        collection: 'roles',
        where: { id: { in: roleIds } },
        depth: 0,
        overrideAccess: true,
        limit: roleIds.length,
      })
      return docs.docs as unknown as Role[]
    },
  })
  req[PERM_CTX_CACHE_KEY] = ctx
  return ctx
}

/**
 * 自定义 endpoint / Custom View 必须先调用此守卫。
 *
 * 不通过则抛 ForbiddenError（领域层统一异常，HTTP 映射 403）。
 * 通过则返回 PermissionContext 供后续业务使用。
 */
export async function requireAdminContext(
  req: RequestContext,
): Promise<PermissionContext> {
  const ctx = await getPermissionContext(req)
  if (!ctx) {
    throw new ForbiddenError({
      domain: 'auth',
      message: '未登录或会话已失效',
    })
  }
  return ctx
}

/**
 * 要求具备指定操作权限；缺失则抛 ForbiddenError。
 *
 * 用于领域服务前置校验和 endpoint 路由守卫。
 */
export async function requireOperationPermission(
  req: RequestContext,
  code: string,
): Promise<PermissionContext> {
  const ctx = await requireAdminContext(req)
  if (!hasOperationPermission(ctx, code)) {
    throw new ForbiddenError({
      domain: 'auth',
      message: `缺少操作权限：${code}`,
      details: { requiredOperation: code, roleCodes: ctx.roleCodes },
    })
  }
  return ctx
}

/**
 * 要求具备指定字段权限；缺失则抛 ForbiddenError。
 *
 * 用于敏感字段读取接口的前置校验。
 */
export async function requireFieldPermission(
  req: RequestContext,
  code: string,
): Promise<PermissionContext> {
  const ctx = await requireAdminContext(req)
  if (!hasFieldPermission(ctx, code)) {
    throw new ForbiddenError({
      domain: 'auth',
      message: `缺少字段权限：${code}`,
      details: { requiredField: code, roleCodes: ctx.roleCodes },
    })
  }
  return ctx
}

/**
 * 要求具备指定菜单权限；缺失则抛 ForbiddenError。
 *
 * 用于 Custom View 路由守卫，避免无权用户直接访问 URL 绕过菜单。
 */
export async function requireMenuPermission(
  req: RequestContext,
  code: string,
): Promise<PermissionContext> {
  const ctx = await requireAdminContext(req)
  if (!hasMenuPermission(ctx, code)) {
    throw new ForbiddenError({
      domain: 'auth',
      message: `缺少菜单权限：${code}`,
      details: { requiredMenu: code, roleCodes: ctx.roleCodes },
    })
  }
  return ctx
}

/**
 * 数据范围守卫：检查 ctx 是否能看到目标文档的城市归属。
 *
 * - ctx.dataScope === 'global' 且 cityId 在 cityIds 范围内 → 通过
 * - ctx.dataScope === 'city' 且 cityId 在 cityIds 范围内 → 通过
 * - ctx.dataScope === 'team' / 'self' / 'none' → 由调用方进一步收窄
 *
 * 返回 false 时调用方应返回 404（不暴露存在性）。
 */
export function canReadByCity(
  ctx: PermissionContext,
  cityId: number | string | null | undefined,
): boolean {
  // 所有数据范围都以"城市范围"为最终上限：cityIds 为空表示不限城市。
  //   - global/city：城市范围是唯一约束，命中即可读
  //   - team/self/none：此处只校验城市上限，owner/team 归属由上层领域服务再收窄
  // 两种情况的城市判定完全一致，故统一走 isCityInScope（P3：合并原先重复分支）。
  return isCityInScope(ctx, cityId)
}

// ────────────────────────────────────────────────────────────
// Payload Collection access 工厂
// ────────────────────────────────────────────────────────────

type CollectionAccessConfig = NonNullable<
  import('payload').CollectionConfig['access']
>

type AccessArgs = Parameters<NonNullable<CollectionAccessConfig['read']>>[0]

/**
 * 创建基于操作权限的 Collection access 配置。
 *
 * 用法：
 *   ```ts
 *   access: createCollectionAccess({
 *     read: 'listing:review',     // 读取需要 review 权限
 *     create: 'listing:create',
 *     update: 'listing:update',
 *     delete: 'listing:delete',
 *   })
 *   ```
 *
 * 注意：
 *   - 此工厂仅校验操作权限；数据范围（city/team/self）需在领域服务层进一步收窄
 *   - 通配符 * 权限自动通过（hasOperationPermission 内部处理）
 *   - 未登录用户被拒绝
 */
export function createCollectionAccess(params: {
  read?: string
  create?: string
  update?: string
  delete?: string
}): CollectionAccessConfig {
  function makeChecker(requiredOp?: string) {
    // 未指定操作码：不代表公开，仍要求登录态（P2-7：修复此前 () => true 的不安全默认，
    // 该默认会让未配置的动作对匿名请求开放，与"未登录用户被拒绝"的约定相悖）。
    // 需要匿名可读的 Collection 应显式写自己的 access.read，而非依赖本工厂的缺省值。
    if (!requiredOp) {
      return (args: AccessArgs) => Boolean(args.req.user)
    }
    return async (args: AccessArgs) => {
      const ctx = await getPermissionContext(args.req as RequestContext)
      if (!ctx) return false
      return hasOperationPermission(ctx, requiredOp)
    }
  }
  return {
    read: makeChecker(params.read),
    create: makeChecker(params.create),
    update: makeChecker(params.update),
    delete: makeChecker(params.delete),
  }
}

// ────────────────────────────────────────────────────────────
// 内部辅助
// ────────────────────────────────────────────────────────────

/**
 * 从 Payload req 提取 user，仅取权限相关字段。
 *
 * 不信任 req.user 上的扩展字段；只保留 PermissionContext 派生所需的最小集合。
 */
function extractUser(req: RequestContext): Pick<User, 'id' | 'roles' | 'cityScope' | 'status' | 'sessionVersion'> | null {
  const raw = req.user as PayloadUser | undefined
  if (!raw) return null
  // Payload 的 user 类型为 Record<string, unknown>；运行期字段来自 users Collection
  const u = raw as unknown as User
  if (u.id === undefined || u.id === null) return null
  return {
    id: u.id,
    roles: u.roles,
    cityScope: u.cityScope,
    status: u.status,
    sessionVersion: u.sessionVersion,
  }
}
