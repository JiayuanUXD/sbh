import type { Payload } from 'payload'

import {
  buildPermissionContext,
  hasOperationPermission,
} from '@/domain/auth/permission-context'
import { canTransitionReview } from '@/domain/review/review-status'
import type { Role, User } from '@/payload-types'
import ListingFastTrackActionClient from './ListingFastTrackActionClient'

/**
 * 免审直发 - 服务端入口（房源编辑页 ui 字段）
 *
 * 为什么入口在这里而不是审核台：审核台只列 `reviewStatus=pending` 的房源，而直发的
 * 起点恰恰是**未提交 / 已驳回**——那些房源根本不在队列里。放在房源编辑页的审核状态
 * 旁边，才是「我刚录完这套房，想直接发」的实际动线。
 *
 * 三道门都在服务端判，客户端只拿到「渲染 / 不渲染」的结果：
 *   1. 权限：listing:review + listing:fast_track_review（后者单独授予，见 endpoint 注释）
 *   2. 状态：仅 not_submitted / rejected 可直发（pending 刻意不允许，见 review-status.ts）
 *   3. 完整度：由 endpoint 强制，本组件不预判——预判会和服务端口径漂移
 *
 * 新建未保存的房源没有 id，无从直发，不渲染。
 */

type FieldProps = Readonly<{
  payload: Payload
  user?: unknown
  data?: Readonly<{ id?: string | number; reviewStatus?: unknown; version?: unknown }> &
    Record<string, unknown>
  id?: string | number
}>

export default async function ListingFastTrackAction({ payload, user, data, id }: FieldProps) {
  const docId = id ?? data?.id
  if (docId === undefined || docId === null || docId === '') return null
  if (!user) return null

  // 状态门：只有状态机允许 fast_track 的起点才显示入口。
  // 用 canTransitionReview 而不是自己写 `=== 'not_submitted' || === 'rejected'`，
  // 这样以后转移表改了，入口跟着变，不会两处漂移。
  const reviewStatus = typeof data?.reviewStatus === 'string' ? data.reviewStatus : 'not_submitted'
  if (reviewStatus !== 'not_submitted' && reviewStatus !== 'rejected') return null
  if (!canTransitionReview(reviewStatus, 'fast_track')) return null

  const ctx = await buildPermissionContext({
    user: user as Pick<User, 'id' | 'roles' | 'cityScope' | 'status' | 'sessionVersion'>,
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

  if (!ctx) return null
  if (!hasOperationPermission(ctx, 'listing:review')) return null
  if (!hasOperationPermission(ctx, 'listing:fast_track_review')) return null

  const version = typeof data?.version === 'number' ? data.version : undefined

  return (
    <ListingFastTrackActionClient
      listingId={String(docId)}
      reviewStatus={reviewStatus}
      {...(version !== undefined ? { expectedVersion: version } : {})}
    />
  )
}
