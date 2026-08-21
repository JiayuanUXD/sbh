import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'

export const SUPPLY_IMPORT_BATCH_STATUSES = [
  'preflight',
  'queued',
  'running',
  'completed',
  'failed',
] as const

export const SupplyImportBatches: CollectionConfig = {
  slug: 'supply-import-batches',
  labels: { singular: '导入批次', plural: '导入批次' },
  admin: {
    useAsTitle: 'fileName',
    defaultColumns: ['fileName', 'type', 'status', 'createdAt'],
  },
  access: {
    ...createCollectionAccess({
      read: 'data:import',
      create: 'data:import',
      update: 'data:import',
    }),
    // 业务历史不可物理删除（AGENTS.md 第 4 条）。
    // **必须写字面量 false，不能用 createCollectionAccess 传一个不存在的权限码**——
    // hasOperationPermission 对持有通配符 `*` 的角色一律放行，假权限码根本关不死。
    // 这与 AuditLogs.ts:79 / SupplySubmissions.ts:82 的既有写法一致。
    delete: () => false,
  },
  fields: [
    {
      name: 'type',
      label: '导入对象',
      type: 'select',
      required: true,
      options: [
        { label: '楼盘', value: 'buildings' },
        { label: '房源', value: 'listings' },
      ],
    },
    {
      name: 'status',
      label: '状态',
      type: 'select',
      required: true,
      defaultValue: 'preflight',
      options: [
        { label: '预检完成', value: 'preflight' },
        { label: '排队中', value: 'queued' },
        { label: '写入中', value: 'running' },
        { label: '已完成', value: 'completed' },
        { label: '失败', value: 'failed' },
      ],
    },
    { name: 'operator', label: '操作者', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
    { name: 'city', label: '归属城市', type: 'relationship', relationTo: 'locations', admin: { readOnly: true } },
    { name: 'fileName', label: '文件名', type: 'text', admin: { readOnly: true } },
    { name: 'rowCount', label: '总行数', type: 'number', admin: { readOnly: true } },
    {
      name: 'validRows',
      label: '通过行快照',
      type: 'json',
      admin: { readOnly: true, description: '完成 7 天后由清理任务置空' },
    },
    { name: 'rowErrors', label: '错误行', type: 'json', admin: { readOnly: true } },
    {
      name: 'stats',
      label: '统计',
      type: 'group',
      fields: [
        { name: 'processed', label: '已处理', type: 'number', defaultValue: 0 },
        { name: 'created', label: '新建', type: 'number', defaultValue: 0 },
        { name: 'updated', label: '更新', type: 'number', defaultValue: 0 },
        { name: 'failed', label: '失败', type: 'number', defaultValue: 0 },
      ],
    },
    {
      name: 'affectedIds',
      label: '影响对象 ID',
      type: 'json',
      admin: { readOnly: true, description: '回滚锚点' },
    },
    { name: 'startedAt', label: '开始写入时间', type: 'date', admin: { readOnly: true } },
    { name: 'finishedAt', label: '完成时间', type: 'date', admin: { readOnly: true } },
  ],
}
