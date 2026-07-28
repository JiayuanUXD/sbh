import type { BeforeDocumentControlsServerProps } from 'payload'

import { canReadContextCollection } from '@/domain/admin-navigation/context-links'
import FormSubmissionsLinkClient from './FormSubmissionsLinkClient'

/**
 * 表单编辑页的提交数据入口。
 *
 * 权限判断留在服务端，只向获准用户渲染不带权限数据的客户端链接。
 */
export default function FormSubmissionsLink({
  id,
  permissions,
}: BeforeDocumentControlsServerProps) {
  if (id === undefined || id === null || id === '') return null
  if (!canReadContextCollection(permissions, 'form-submissions')) return null

  return <FormSubmissionsLinkClient />
}
