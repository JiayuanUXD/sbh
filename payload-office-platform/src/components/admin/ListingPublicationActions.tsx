import type { BeforeDocumentControlsServerProps } from 'payload'

import {
  buildPermissionContext,
  hasOperationPermission,
  type PermissionContext,
} from '@/domain/auth/permission-context'
import { isPublicationStatus } from '@/domain/review/publication-status'
import type { Role, User } from '@/payload-types'
import ListingPublicationActionsClient from './ListingPublicationActionsClient'

/**
 * 房源发布轴动作条 - 服务端（OPT-086 PR1）
 *
 * 落点与楼盘启停按钮同一个槽（`beforeDocumentControls`）。该槽只给 ServerProps
 * （`{ id, payload, user, i18n, ... }`），**不含 `doc`/`req`**，所以用 `payload.findByID`
 * 读回发布态 / 租售 / 版本 / 标题（同 `BuildingOperationalToggle`）。
 *
 * 这里只负责两件事：**会话级的权限**（表单里没有，只能服务端算）与**首屏兜底快照**。
 * 可用动作不在这里算——服务端组件只在页面 RSC 渲染时跑一次，保存一次
 * `protectListing` 就把 version +1、`adminAutoPublish` 还可能改 publicationStatus，
 * 快照当场过期。状态 / 租售 / 版本由客户端读表单实时值，可用动作也在客户端用同一个
 * 纯函数现算（理由详见 `ListingPublicationActionsClient`）。
 *
 * 权限只决定按钮显隐；端点才是唯一强制点——隐藏按钮不是权限控制（`.agent/permissions.md`）。
 * 因此这里的读用 `overrideAccess: true`：只为把当前状态显示出来，写侧仍由端点鉴权。
 *
 * 新建（无 id）不渲染：没保存的房源没有发布轴。
 */
export default async function ListingPublicationActions({
  id,
  payload,
  user,
}: BeforeDocumentControlsServerProps) {
  if (id === undefined || id === null || id === '' || !user) return null

  let doc: Record<string, unknown> | null = null
  try {
    doc = (await payload.findByID({
      collection: 'listings',
      id,
      depth: 0,
      overrideAccess: true,
    })) as unknown as Record<string, unknown>
  } catch {
    // 文档不存在或已删除 → 不渲染
    return null
  }
  if (!doc || !isPublicationStatus(doc.publicationStatus)) return null

  // 权限上下文的构造照抄 ListingReviewQueue：控件槽同样只有 payload + user（无 req），
  // 走不了 getPermissionContext(req)。
  // 与上面的 findByID 同样吞异常：这是每个房源编辑页都要跑的一次角色查询，
  // 抛出去就等于整页 500——一个装饰性动作条不该有能力搞垮编辑页。
  let ctx: PermissionContext | null = null
  try {
    ctx = await buildPermissionContext({
      user: user as unknown as Pick<
        User,
        'id' | 'roles' | 'cityScope' | 'status' | 'sessionVersion'
      >,
      loadRoles: async (roleIds) => {
        const docs = await payload.find({
          collection: 'roles',
          where: { id: { in: roleIds } },
          depth: 0,
          overrideAccess: true,
          limit: roleIds.length,
        })
        return docs.docs as unknown as Role[]
      },
    })
  } catch {
    return null
  }
  if (!ctx) return null

  return (
    <ListingPublicationActionsClient
      listingId={String(id)}
      listingTitle={typeof doc.title === 'string' ? doc.title : ''}
      initialPublicationStatus={doc.publicationStatus}
      initialBusinessType={typeof doc.businessType === 'string' ? doc.businessType : null}
      initialVersion={typeof doc.version === 'number' ? doc.version : null}
      canPublish={hasOperationPermission(ctx, 'listing:publish')}
      canUnpublish={hasOperationPermission(ctx, 'listing:unpublish')}
    />
  )
}
