import type { BeforeDocumentControlsServerProps } from 'payload'

import SupplyImportBatchRollbackClient from './SupplyImportBatchRollbackClient'

/**
 * 导入批次回滚按钮 - 服务端（最终评审 Important 6）
 *
 * 背景：`BulkImportViewClient.tsx` 的回滚按钮只活在那个页面的 React state 里——
 * 运营刷新页面/关标签/断网之后，止血能力只能靠手搓 curl 带 cookie 触发，而 §3
 * 写的是「三十秒止血」，这个前提在最常见的意外下不成立。
 *
 * 修法：挂载点选在 `supply-import-batches` 集合自己的编辑视图
 * `beforeDocumentControls`（抄 `Buildings.ts` 的 `BuildingOperationalToggle` 同款
 * 做法），因为批次记录本身持久存在、随时可以通过 `/admin/collections/
 * supply-import-batches/:id` 直接打开——不依赖任何页面内存状态。
 *
 * ⚠️ 同 `BuildingOperationalToggle.tsx` 的既有教训：Payload 3.86 的
 * `beforeDocumentControls` 槽只传 `ServerProps`（`{ id, payload, user, i18n,
 * locale, permissions }`）——不含 `doc`/`req`。这里从 props 直接取 `id`，
 * 再用 `payload.findByID` 读回展示所需字段。
 *
 * 权限与回滚执行全在 `POST /bulk-import/batches/:id/rollback` endpoint 服务端强制
 * （`requireOperationPermission` + `isBatchVisibleTo`），本组件不做任何判定
 * ——只负责展示与触发，与 `BuildingOperationalToggleClient` 同一原则。
 *
 * 新建（未保存）批次或找不到对应记录时不渲染。
 */
export default async function SupplyImportBatchRollback({
  id,
  payload,
}: BeforeDocumentControlsServerProps) {
  if (id === undefined || id === null || id === '') return null

  let batch: {
    type?: unknown
    status?: unknown
    affectedIds?: unknown
  } | null = null
  try {
    batch = (await payload.findByID({
      collection: 'supply-import-batches',
      id,
      depth: 0,
      overrideAccess: true,
    })) as unknown as { type?: unknown; status?: unknown; affectedIds?: unknown }
  } catch {
    // 批次不存在 → 不渲染
    return null
  }
  if (!batch) return null

  const type = batch.type === 'buildings' ? 'buildings' : 'listings'
  const status = typeof batch.status === 'string' ? batch.status : 'preflight'
  const affectedCount = Array.isArray(batch.affectedIds) ? batch.affectedIds.length : 0

  return (
    <SupplyImportBatchRollbackClient
      batchId={String(id)}
      type={type}
      status={status}
      affectedCount={affectedCount}
    />
  )
}
