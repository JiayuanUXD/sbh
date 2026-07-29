'use client'

import { Link, useDocumentInfo } from '@payloadcms/ui'

import { buildFormSubmissionsURL } from '@/domain/admin-navigation/context-links'

export default function FormSubmissionsLinkClient() {
  const { id } = useDocumentInfo()
  const href = buildFormSubmissionsURL(id)

  if (!href) return null

  return (
    <Link href={href} prefetch={false}>
      查看提交数据
    </Link>
  )
}
