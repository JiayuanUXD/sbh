import type { CollectionConfig, Where } from 'payload'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'

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
    // OPT-049：`group: false` 让本集合退出 Payload **原生**导航
    // （3.86 的 groupNavItems 对 group===false 直接跳过）。
    //
    // 不设它的后果就是后台左下角那个「挤成一团、与上面九个分组风格不一致」的区块
    // ——那不是样式没写好，是本集合落进了 Payload 的默认分组，其 i18n 标签
    // 恰好就叫「集合」。入口由 navigation-config.ts 的自定义导航提供（OPT-045 D4），
    // 原生那份是纯粹的重复。
    group: false,
    useAsTitle: 'fileName',
    defaultColumns: ['fileName', 'type', 'status', 'createdAt'],
    components: {
      edit: {
        // 最终评审 Important 6：止血按钮此前只活在导入页面的 React state 里，
        // 刷新/关标签/断网后只能靠手搓 curl。这里挂一个不依赖页面内存状态的入口——
        // 批次记录本身持久存在，随时能从这个编辑视图直接回滚。抄
        // Buildings.ts:94 的 BuildingOperationalToggle 同款 beforeDocumentControls 做法。
        beforeDocumentControls: ['/components/admin/SupplyImportBatchRollback'],
      },
    },
  },
  access: {
    // 最终评审 Critical 1：REST 门此前用 createCollectionAccess({read/create/update:'data:import'})，
    // 该工厂只返回布尔判定（access.ts 的 makeChecker 不看 operator、不看 cityScope、不返回 where），
    // 而这个集合没有 disableREST。后果：任何持 data:import 的账号都能通过
    // GET /api/supply-import-batches?limit=0 读到所有人的批次（含 validRows/rowErrors 里的原始单元格
    // 文本），并通过 PATCH :id { affectedIds: [] } 把别人批次的回滚锚点清空——
    // 止血能力被一个 PATCH 永久删除，且这不是删除记录，delete:()=>false 挡不住它。
    //
    // create / update 改字面量 () => false：endpoint（bulk-import-endpoint.ts）与写入 Job
    // （import-task.ts / batch-rollback.ts）对这个集合的所有写入都显式传了 overrideAccess: true，
    // 关掉 REST 层的 create/update 不影响任何现有路径。
    //
    // read 改成返回 where 的访问函数，与 endpoint 层的 isBatchVisibleTo（bulk-import-endpoint.ts）
    // 同口径：ctx.cityIds === 'all'（全局范围，ADM）放行，否则只能读到自己创建的批次。
    read: async ({ req }) => {
      const ctx = await getPermissionContext(req as RequestContext)
      if (!ctx || !hasOperationPermission(ctx, 'data:import')) return false
      if (ctx.cityIds === 'all') return true
      const where: Where = { operator: { equals: ctx.userId } }
      return where
    },
    create: () => false,
    update: () => false,
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
      admin: {
        readOnly: true,
        description:
          '预检通过行的规范化快照。规格 D9 设想完成 7 天后由清理任务置空以省空间，但该清理任务本期未实现（已作为剩余风险记录），实际会随批次记录永久保留。',
      },
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
