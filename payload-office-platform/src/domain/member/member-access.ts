/**
 * 会员集合的准入与闸门（OPT-088，母文档 §7）
 *
 * 三条不变量：
 *   1. 只有 users 集合、持 member:manage 的员工能经 Payload access 读改会员；会员自己的
 *      操作全部走 /api/member/*（Local API + overrideAccess），不经这里。
 *   2. 创建只有两条路：服务端验证流程（req.context.memberFlow）或持 member:manage 的员工。
 *      这一条同时堵住 Payload 自带的 first-register（它走 overrideAccess，但 beforeChange 照跑）。
 *   3. Payload 的 login 操作只接受 req.context.memberFlow === 'password'，其余一律拒绝——
 *      这是 /api/members/login 被总路由封成 404 之外的第二道门。
 */
import type {
  AccessArgs,
  CollectionBeforeChangeHook,
  CollectionBeforeLoginHook,
  CollectionConfig,
  PayloadRequest,
} from 'payload'
import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { ForbiddenError } from '@/domain/shared/errors'

export const MEMBER_MANAGE_CODE = 'member:manage'
/** 会员会话 30 天；Payload 的 sessions.expiresAt 与我们签的 JWT 都用它。 */
export const MEMBER_TOKEN_EXPIRATION_SECONDS = 60 * 60 * 24 * 30

export function isStaffRequest(req: { user?: unknown }): boolean {
  const user = req.user
  if (user === null || typeof user !== 'object') return false
  return (user as { collection?: unknown }).collection === 'users'
}

export async function canManageMembers(args: { req: PayloadRequest }): Promise<boolean> {
  if (!isStaffRequest(args.req)) return false
  const ctx = await getPermissionContext(args.req as RequestContext)
  if (!ctx) return false
  return hasOperationPermission(ctx, MEMBER_MANAGE_CODE)
}

const manage = (args: AccessArgs): Promise<boolean> => canManageMembers({ req: args.req })

export const memberCollectionAccess: CollectionConfig['access'] = {
  read: manage,
  readVersions: manage,
  create: manage,
  update: manage,
  // 会员不物理删：停用即可。有收藏 / 会话引用，删了会级联丢历史。
  delete: () => false,
  unlock: manage,
}

function memberFlowOf(req: PayloadRequest): string | null {
  const flow = (req.context as Record<string, unknown> | undefined)?.memberFlow
  return typeof flow === 'string' && flow.length > 0 ? flow : null
}

export const guardMemberCreate: CollectionBeforeChangeHook = async ({ operation, req, data }) => {
  if (operation !== 'create') return data
  if (memberFlowOf(req)) return data
  if (await canManageMembers({ req })) return data
  throw new ForbiddenError({ domain: 'member', message: '会员只能通过验证流程创建' })
}

export const clearSessionsOnDisable: CollectionBeforeChangeHook = async ({ operation, originalDoc, data }) => {
  if (operation !== 'update' || !originalDoc) return data
  const before = (originalDoc as { status?: unknown }).status
  const after = (data as { status?: unknown }).status
  if (before !== 'disabled' && after === 'disabled') {
    ;(data as Record<string, unknown>).sessions = []
  }
  return data
}

export const guardMemberLogin: CollectionBeforeLoginHook = async ({ req, user }) => {
  if (memberFlowOf(req) !== 'password') {
    throw new ForbiddenError({ domain: 'member', message: '会员登录只允许经 /api/member/login/password' })
  }
  if ((user as { status?: unknown }).status !== 'active') {
    throw new ForbiddenError({ domain: 'member', message: '账号已停用' })
  }
  return user
}
