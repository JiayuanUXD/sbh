'use client'

import { Link, useDocumentInfo } from '@payloadcms/ui'

import { buildLeadOwnershipHistoryURL } from '@/domain/admin-navigation/context-links'

export default function LeadOwnershipHistoryLinkClient() {
  const { id } = useDocumentInfo()
  const href = buildLeadOwnershipHistoryURL(id)

  if (!href) return null

  return (
    <Link href={href} prefetch={false}>
      归属记录
    </Link>
  )
}
