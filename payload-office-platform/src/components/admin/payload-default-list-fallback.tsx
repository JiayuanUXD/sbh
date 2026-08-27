import { DefaultListView } from '@payloadcms/ui'
import type { ListViewClientProps, ListViewServerProps } from 'payload'

/**
 * 回退渲染：以 Payload 原生列表视图呈现（OPT-056）。
 *
 * 何时该回退由 `list-view-context.ts` 的 `shouldDeferToDefaultListView` 判定
 * （纯函数、带单测）；本文件只负责把 props 安全地交给原生视图。
 *
 * `DefaultListView` 是客户端组件，只能收到可序列化的 props；因此这里**按
 * `ListViewClientProps` 逐项挑选**，绝不整包透传——`payload` 实例、`i18n`、
 * 以及带函数的 `collectionConfig` 都在服务端 props 里，透传会直接炸在
 * RSC 序列化边界上。
 */
export function renderDefaultListView(props: ListViewServerProps) {
  const clientProps: ListViewClientProps = {
    AfterList: props.AfterList,
    AfterListTable: props.AfterListTable,
    beforeActions: props.beforeActions,
    BeforeList: props.BeforeList,
    BeforeListTable: props.BeforeListTable,
    collectionSlug: props.collectionSlug,
    columnState: props.columnState,
    Description: props.Description,
    disableBulkDelete: props.disableBulkDelete,
    disableBulkEdit: props.disableBulkEdit,
    disableQueryPresets: props.disableQueryPresets,
    enableRowSelections: props.enableRowSelections,
    hasCreatePermission: props.hasCreatePermission,
    hasDeletePermission: props.hasDeletePermission,
    hasTrashPermission: props.hasTrashPermission,
    listMenuItems: props.listMenuItems,
    listPreferences: props.listPreferences,
    newDocumentURL: props.newDocumentURL,
    queryPreset: props.queryPreset,
    queryPresetPermissions: props.queryPresetPermissions,
    renderedFilters: props.renderedFilters,
    resolvedFilterOptions: props.resolvedFilterOptions,
    Table: props.Table,
    viewType: props.viewType,
  }

  return <DefaultListView {...clientProps} />
}
