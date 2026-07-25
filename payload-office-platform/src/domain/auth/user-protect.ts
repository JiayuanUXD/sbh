/**
 * 用户账号保护 hook（tasks.md M1.5）
 *
 * 业务不变量：
 *   - 至少保留一个 status=active 且具备 ADM 角色的账号
 *   - 阻止删除最后一个全局管理员
 *   - 阻止把最后一个全局管理员停用 / 锁定
 *
 * 实现策略：
 *   - beforeDelete：删除前查询剩余 active ADM 用户数，<=1 则抛错
 *   - beforeChange (update)：状态从 active 改为 disabled/locked 时同样校验
 *
 * 性能：
 *   - 仅在状态转换或删除时触发查询；正常编辑不查
 *   - 查询用 overrideAccess=true 直接读 DB，绕过 access 递归
 */

import type { CollectionBeforeChangeHook, CollectionBeforeDeleteHook } from 'payload'
import type { Role, User } from '@/payload-types'
import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'

type AdminCheckUser = Pick<User, 'id' | 'status' | 'roles'>

/**
 * 查询当前 active ADM 用户列表。
 *
 * - 仅查 status=active
 * - roles 包含 code=ADM 的角色
 * - overrideAccess=true 绕过 access 递归
 */
async function findActiveAdminUsers(params: {
  payload: import('payload').BasePayload
  excludeUserId?: number | string
}): Promise<AdminCheckUser[]> {
  const { payload, excludeUserId } = params
  // 1. 查所有 ADM 角色
  const admRoles = await payload.find({
    collection: 'roles',
    where: { code: { equals: 'ADM' } },
    limit: 10,
    depth: 0,
    overrideAccess: true,
  })
  const admRoleIds = (admRoles.docs as unknown as Role[]).map((r) => r.id)
  if (admRoleIds.length === 0) return []

  // 2. 查所有 status=active 且 roles 含 ADM 的用户
  //    Payload relationship hasMany 查询语法：roles: { in: [...] }
  const result = await payload.find({
    collection: 'users',
    where: {
      and: [
        { status: { equals: 'active' } },
        { roles: { in: admRoleIds } },
        ...(excludeUserId !== undefined
          ? [{ id: { not_equals: excludeUserId } }]
          : []),
      ],
    },
    limit: 100,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs as unknown as AdminCheckUser[]
}

/**
 * 敏感字段：自我编辑时必须具备 user:manage 才能修改。
 *
 * - roles / cityScope：直接决定权限与数据范围，允许自改 = 自我提权
 * - status：允许自改 = 自行解除停用/锁定
 */
const SELF_PROTECTED_FIELDS = ['roles', 'cityScope', 'status'] as const

/**
 * beforeChange hook：阻止用户给自己提权（tasks.md M1.5, design.md §6.1）。
 *
 * 背景（P0 修复）：Users.access.update 对"自己改自己"整体放行（便于改密码/姓名），
 * 但这会连带放行 roles/cityScope/status → 低权账号可给自己加 ADM 角色。
 *
 * 策略：
 *   - 仅当"操作者 === 被改账号"且操作者不具备 user:manage 时生效
 *   - 静默剥离 data 中的敏感字段（删除即保留 originalDoc 原值），不抛错
 *   - 他人修改（管理员改别人）由 Collection access.update 的 user:manage 把关，不进此分支
 *   - overrideAccess（seed / 首次建管理员）时 req.user 为空 → 直接放行
 *
 * 为何删字段而非比对：relationship 值在 data 里可能是 ID 数组、在 originalDoc 里是文档数组，
 * 直接比对易误判；删除未授权字段让 Payload 保留原值，行为确定且无副作用。
 */
export const protectSelfPrivilegeEscalation: CollectionBeforeChangeHook<User> = async ({
  operation,
  originalDoc,
  data,
  req,
}) => {
  if (operation !== 'update' || !originalDoc) return data
  const actor = req.user
  if (!actor) return data // overrideAccess / 无登录态：交由 access 层把关
  // 仅拦截"自己改自己"
  if (actor.id !== originalDoc.id) return data

  // 具备 user:manage 的账号（如 ADM）自改敏感字段属正常管理操作
  const ctx = await getPermissionContext(req as RequestContext)
  if (ctx && hasOperationPermission(ctx, 'user:manage')) return data

  // 剥离敏感字段：删除即保留 originalDoc 原值
  for (const field of SELF_PROTECTED_FIELDS) {
    if (field in data) {
      delete (data as Record<string, unknown>)[field]
    }
  }
  return data
}

/**
 * beforeChange hook：阻止把最后一个 active ADM 用户停用 / 锁定。
 *
 * 触发条件：operation=update 且 status 从 active → disabled/locked
 */
export const protectLastAdminBeforeChange: CollectionBeforeChangeHook<User> = async ({
  operation,
  originalDoc,
  data,
  req,
}) => {
  if (operation !== 'update' || !originalDoc) return data
  const oldStatus = originalDoc.status as string | undefined
  const newStatus = data?.status as string | undefined
  // 仅在 active → disabled/locked 转换时检查
  if (oldStatus !== 'active') return data
  if (newStatus !== 'disabled' && newStatus !== 'locked') return data

  // 检查 originalDoc 是否具备 ADM 角色
  // 由于 user.roles 可能是 ID 数组或文档数组，统一展开
  const admRoleIds = await resolveAdmRoleIds(req.payload, originalDoc)
  if (admRoleIds.length === 0) return data // 此用户非 ADM，不阻止

  // 查询除当前用户外的其他 active ADM 用户
  const others = await findActiveAdminUsers({
    payload: req.payload,
    excludeUserId: originalDoc.id,
  })
  if (others.length === 0) {
    throw new Error(
      '无法停用最后一个全局管理员（ADM）：请先创建或启用另一个 ADM 账号。',
    )
  }
  return data
}

/**
 * beforeDelete hook：阻止删除最后一个 active ADM 用户。
 *
 * - 待删用户非 ADM → 放行
 * - 待删用户是 ADM 且无其他 active ADM → 抛错
 */
export const protectLastAdminBeforeDelete: CollectionBeforeDeleteHook = async ({
  id,
  req,
}) => {
  if (id === undefined || id === null) return
  // 读取待删用户的当前状态和角色
  const user = (await req.payload.findByID({
    collection: 'users',
    id: id as number | string,
    depth: 1,
    overrideAccess: true,
  })) as unknown as (AdminCheckUser & { roles?: (number | Role)[] }) | null
  if (!user) return

  // 已停用 / 锁定用户可直接删除（不构成"最后一个 active ADM"）
  if (user.status !== 'active') return

  // 检查用户是否具备 ADM 角色
  const admRoleIds = await resolveAdmRoleIds(req.payload, user)
  if (admRoleIds.length === 0) return

  // 查询除当前用户外的其他 active ADM 用户
  const others = await findActiveAdminUsers({
    payload: req.payload,
    excludeUserId: user.id,
  })
  if (others.length === 0) {
    throw new Error(
      '无法删除最后一个全局管理员（ADM）：请先创建或启用另一个 ADM 账号。',
    )
  }
}

// ────────────────────────────────────────────────────────────
// 辅助
// ────────────────────────────────────────────────────────────

/** 解析用户文档中包含的 ADM 角色 ID 列表 */
async function resolveAdmRoleIds(
  payload: import('payload').BasePayload,
  user: Pick<User, 'roles'>,
): Promise<Array<number | string>> {
  const roles = user.roles
  if (!roles || !Array.isArray(roles) || roles.length === 0) return []

  // 如果 roles 已是文档数组（depth>=1），直接读 code
  const docRoles = roles.filter(
    (r): r is Role => typeof r === 'object' && r !== null && 'code' in r,
  )
  const admDocIds = docRoles.filter((r) => r.code === 'ADM').map((r) => r.id)
  if (admDocIds.length > 0) return admDocIds

  // 否则按 ID 查询角色文档
  const ids = roles.filter(
    (r): r is number => typeof r === 'number',
  )
  if (ids.length === 0) return []
  const result = await payload.find({
    collection: 'roles',
    where: { and: [{ id: { in: ids } }, { code: { equals: 'ADM' } }] },
    limit: 10,
    depth: 0,
    overrideAccess: true,
  })
  return (result.docs as unknown as Role[]).map((r) => r.id)
}
