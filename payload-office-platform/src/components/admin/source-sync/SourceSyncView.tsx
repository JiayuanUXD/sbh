import type { AdminViewServerProps } from 'payload'

import GeographyAdminTemplate from '@/components/admin/geography/GeographyAdminTemplate'
import { requireImportAccess } from '@/components/admin/bulk-import/require-import-access'

import SourceSyncViewClient from './SourceSyncViewClient'

/**
 * 外部数据同步 - 服务端入口（OPT-104）。
 *
 * 准入与批量导入同一道门（`data:import`，视图内显式判定——Payload 3.86 的自定义视图
 * 不做登录重定向，也不经导航的 menuCode 过滤）。「必须全局范围」由 endpoint 再收窄一次。
 */
export default async function SourceSyncView(props: AdminViewServerProps) {
  const denied = await requireImportAccess(props)
  if (denied) return denied
  return (
    <GeographyAdminTemplate {...props}>
      <SourceSyncViewClient />
    </GeographyAdminTemplate>
  )
}
