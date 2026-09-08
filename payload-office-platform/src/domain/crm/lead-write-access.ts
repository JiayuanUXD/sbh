import type { CollectionConfig } from 'payload'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasMenuPermission, hasOperationPermission } from '@/domain/auth/permission-context'
import { buildLeadReadScope } from './lead-read-access'
import { LEAD_MENU_CODES } from './lead-menu-codes'

type LeadAccess = NonNullable<NonNullable<CollectionConfig['access']>['update']>

/**
 * 线索写侧准入（2026-09-08 收口）
 *
 * Leads 此前只写了 `read: leadReadAccess`，create/update/delete 三个全缺 →
 * 落到 Payload 3.86 的 `defaultAccess`（判据仅 `Boolean(req.user)`），
 * 任何登录账号都能新建、改写、物理删除线索。读侧早就按数据范围收窄了，
 * 写侧却完全敞着——**读比写严**，这本身就说明是漏写而非设计。
 *
 * 三条写路径已逐一确认不受影响（改之前查过，别凭印象重查）：
 *   - C 端留资 `app/api/inquiries/route.ts` 走 Local API，
 *     payload 3.86 的 `local/create.js` 默认 `overrideAccess = true`；
 *   - `app/api/inquiries/demand/route.ts` 显式 `overrideAccess: true`；
 *   - `endpoints/traffic-endpoint.ts` 的 `overrideAccess: false` 是**读**，不是写。
 * 后台没有任何自定义组件直接 PATCH `/api/leads`，走的是 Payload 原生表单。
 */

/**
 * create：认操作码 `lead:create`（ADM 的 `*` 与 CSR 持有）。
 *
 * 这是 permissions.md 的口径：CSR「受理咨询 / 创建线索」，而 MGR 是「线索分配」、
 * BRK 是「跟进自有线索 / 认领」——两者的职责里都没有「创建」。`lead:create`
 * 早就注册在 permission-codes.ts、也早就授给了 CSR（迁移
 * 20260728_180000 与 roles fixture），却从没被任何 collection 消费过——
 * 与 OPT-051 接上 `building:delete` / `listing:delete` 是同一类死代码，这里接上。
 *
 * **这一条确实收窄了 MGR / BRK 今天能做的事**（收口前任何登录账号都能建）。
 * 不粉饰：如果某个团队确实要让主管建线索，在「角色管理」里给该角色勾上
 * `lead:create` 即可，不需要改代码。
 */
export const leadCreateAccess: LeadAccess = async ({ req }) => {
  const ctx = await getPermissionContext(req as RequestContext)
  if (!ctx) return false
  return hasOperationPermission(ctx, 'lead:create')
}

/**
 * update：线索菜单码任一命中，**再叠上与读侧同一套数据范围收窄**。
 *
 * 复用 `buildLeadReadScope` 而不是另写一份判据：本仓库已经因为「同一条业务规则
 * 写两遍然后分叉」翻车过多次（见 .agent/frontend.md）。于是 BRK（dataScope
 * `self`）的 update 自动被收窄成 `owner.user = 自己` 且在授权城市内——
 * 收口前它能改任何人的线索。
 *
 * 为什么 update 要多一道菜单码、而 read 不要：OPS 的 dataScope 是 `global`，
 * `buildLeadReadScope` 对它返回 `true`，读侧这样是对的（看板与流量分析确实要跨角色
 * 读线索）；但 OPS 是供给侧运营，两个线索菜单码都没有，导航里根本没有「咨询线索」
 * 入口，没有任何理由能改线索。所以写侧比读侧多这一道。
 */
export const leadUpdateAccess: LeadAccess = async ({ req }) => {
  const ctx = await getPermissionContext(req as RequestContext)
  if (!ctx) return false
  if (!LEAD_MENU_CODES.some((code) => hasMenuPermission(ctx, code))) return false
  return buildLeadReadScope(ctx)
}
