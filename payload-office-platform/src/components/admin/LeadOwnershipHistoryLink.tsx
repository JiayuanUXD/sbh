import type { SanitizedPermissions } from 'payload'

import { canReadContextCollection } from '@/domain/admin-navigation/context-links'
import LeadOwnershipHistoryLinkClient from './LeadOwnershipHistoryLinkClient'

/**
 * 线索编辑页的归属记录入口。
 *
 * `beforeDocumentControls` 只提供服务端 props；先在此依据 Payload 已净化的目标
 * collection read 权限作准入，避免将权限对象或无权限入口传到客户端。
 */
export default function LeadOwnershipHistoryLink({
  id,
  permissions,
}: {
  id?: number | string
  permissions?: SanitizedPermissions
}) {
  if (id === undefined || id === null || id === '') return null
  if (!canReadContextCollection(permissions, 'lead-ownership-history')) return null

  return <LeadOwnershipHistoryLinkClient />
}
