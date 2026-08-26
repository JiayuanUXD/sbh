import type { AdminViewServerProps } from 'payload'

import GeographyAdminTemplate from '@/components/admin/geography/GeographyAdminTemplate'
import { requireImportAccess } from './require-import-access'
import BulkImportViewClient from './BulkImportViewClient'

/**
 * 批量导入 - 服务端入口（OPT-041 Task 8）
 *
 * 复用地理模块的 `GeographyAdminTemplate`：它只是 `DefaultTemplate` 的透传封装，
 * 不含任何地理领域逻辑，本视图直接复用而非另建一份同构文件。
 *
 * 模式解析踩过的坑（GeographyCityDetail.tsx 的既有教训，本视图照抄同一处理方式）：
 * Payload 3.86 的自定义视图**不落 routeParams**，`props.params.segments` 拿不到路径
 * 段，只能从 `req.pathname` 自己 parse——不要相信「传 props 进去就有 segments」这类
 * 未经源码验证的假设。
 */
export default async function BulkImportView(props: AdminViewServerProps) {
  const denied = await requireImportAccess(props)
  if (denied) return denied

  const pathname = props.initPageResult.req.pathname ?? ''
  const mode: 'buildings' | 'listings' = pathname.includes('/import/buildings')
    ? 'buildings'
    : 'listings'

  return (
    <GeographyAdminTemplate {...props}>
      <BulkImportViewClient mode={mode} />
    </GeographyAdminTemplate>
  )
}
