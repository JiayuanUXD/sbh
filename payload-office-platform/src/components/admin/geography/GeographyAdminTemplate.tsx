import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'
import type { ReactNode } from 'react'

type GeographyAdminTemplateProps = AdminViewServerProps & {
  children: ReactNode
}

export default function GeographyAdminTemplate({
  children,
  initPageResult,
  params,
  searchParams,
  viewActions,
  viewType,
}: GeographyAdminTemplateProps) {
  const { req, permissions, visibleEntities } = initPageResult

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={req.payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={req.user ?? undefined}
      viewActions={viewActions}
      viewType={viewType}
      visibleEntities={{
        collections: [...visibleEntities.collections],
        globals: [...visibleEntities.globals],
      }}
    >
      {children}
    </DefaultTemplate>
  )
}
