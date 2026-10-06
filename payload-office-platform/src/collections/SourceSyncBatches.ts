import type { CollectionConfig } from 'payload'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'

export const SOURCE_SYNC_BATCH_STATUSES = ['queued', 'running', 'completed', 'failed'] as const
export const SOURCE_SYNC_BATCH_KINDS = ['buildings', 'listings', 'retire'] as const

/**
 * 外部来源同步批次（OPT-104）。一个上传的同步包 = 一条批次（≤ 1,000 行）。
 *
 * 为什么不复用 `supply-import-batches`：那边的 `type` 枚举在 batch-rollback / import-task /
 * bulk-import-endpoint 三处都按「不是 buildings 就是 listings」分支，扩枚举值会误入；
 * 而且它新建即上架、来源写死 manual-import，语义与本集合（新建一律草稿、按来源幂等）相反。
 *
 * 写入全部来自 endpoint 与 `run-source-sync` 任务（显式 overrideAccess），REST 层只开读。
 */
export const SourceSyncBatches: CollectionConfig = {
  slug: 'source-sync-batches',
  labels: { singular: '同步批次', plural: '同步批次' },
  admin: {
    // 退出 Payload 原生导航；入口由 navigation-config.ts 的「外部数据同步」提供（同 OPT-049 口径）
    group: false,
    pagination: { defaultLimit: 50, limits: [25, 50, 100] },
    useAsTitle: 'fileName',
    defaultColumns: ['fileName', 'kind', 'status', 'cursor', 'rowCount', 'createdAt'],
  },
  access: {
    // 同步只对全局范围的人开放（汇租选址只有上海，但写的是全量楼盘与房源，不按城市切）
    read: async ({ req }) => {
      const ctx = await getPermissionContext(req as RequestContext)
      return Boolean(ctx && hasOperationPermission(ctx, 'data:import') && ctx.cityIds === 'all')
    },
    create: () => false,
    update: () => false,
    // 业务历史不可物理删除（字面量 false，理由见 SupplyImportBatches.ts）
    delete: () => false,
  },
  fields: [
    {
      name: 'source',
      label: '来源',
      type: 'select',
      required: true,
      options: [{ label: '汇租选址', value: 'huizuxuanzhi' }],
      admin: { readOnly: true },
    },
    {
      name: 'kind',
      label: '内容',
      type: 'select',
      required: true,
      options: [
        { label: '楼盘', value: 'buildings' },
        { label: '房源', value: 'listings' },
        { label: '下架旧房源', value: 'retire' },
      ],
      admin: { readOnly: true },
    },
    {
      name: 'status',
      label: '状态',
      type: 'select',
      required: true,
      defaultValue: 'queued',
      options: [
        { label: '排队中', value: 'queued' },
        { label: '写入中', value: 'running' },
        { label: '已完成', value: 'completed' },
        { label: '失败', value: 'failed' },
      ],
      admin: { readOnly: true },
    },
    { name: 'operator', label: '上传者', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
    { name: 'fileName', label: '文件名', type: 'text', admin: { readOnly: true } },
    { name: 'rowCount', label: '总行数', type: 'number', admin: { readOnly: true } },
    {
      name: 'rows',
      label: '同步行',
      type: 'json',
      admin: { readOnly: true, description: '上传时已逐行校验；任务读回时仍按 unknown 再校验一次。' },
    },
    { name: 'cursor', label: '已处理行数', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    {
      name: 'stats',
      label: '统计',
      type: 'group',
      admin: { readOnly: true },
      fields: [
        { name: 'created', label: '新建', type: 'number', defaultValue: 0 },
        { name: 'updated', label: '更新', type: 'number', defaultValue: 0 },
        { name: 'unchanged', label: '无变化', type: 'number', defaultValue: 0 },
        { name: 'retired', label: '已下架', type: 'number', defaultValue: 0 },
        { name: 'skipped', label: '跳过', type: 'number', defaultValue: 0 },
        { name: 'failed', label: '失败', type: 'number', defaultValue: 0 },
        { name: 'imagesCreated', label: '新建图片', type: 'number', defaultValue: 0 },
      ],
    },
    {
      name: 'affected',
      label: '影响对象',
      type: 'json',
      admin: {
        readOnly: true,
        description: '回滚锚点：新建 / 更新的 id，已上架房源被覆盖前的原值，被下架的房源 id。',
      },
    },
    { name: 'writeErrors', label: '写入错误', type: 'json', admin: { readOnly: true } },
    { name: 'startedAt', label: '开始写入时间', type: 'date', admin: { readOnly: true } },
    { name: 'finishedAt', label: '完成时间', type: 'date', admin: { readOnly: true } },
    { name: 'rolledBackAt', label: '回滚时间', type: 'date', admin: { readOnly: true } },
  ],
}
