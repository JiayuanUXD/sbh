import type { ListViewClientProps } from 'payload'

/**
 * 自定义列表视图的「渲染上下文」判定（OPT-056）——纯函数，无 UI 依赖，可单测。
 *
 * ## 为什么需要它
 *
 * `collection.admin.components.views.list.Component` 不只用于「整页列表」。
 * Payload 3.86 在下面这些地方渲染的是**同一个覆盖组件**：
 *
 *   - `/admin/collections/<slug>/trash`：`CollectionTrash` 调 `renderListView`，
 *     只把 `viewType` 换成 `'trash'`。覆盖组件若照常查活跃文档，回收站就会显示
 *     未删除的记录、且没有恢复入口——页面标题写着「垃圾箱」，内容却是正常数据。
 *   - 关系字段的列表抽屉（`admin.appearance: 'drawer'`）：`renderListHandler`
 *     带 `drawerSlug` / `enableRowSelections` 调同一入口。覆盖组件若渲染普通
 *     编辑链接，抽屉里就选不中任何记录。
 *
 * 我们的 Arco 列表只为「整页列表」设计（搜索、筛选、快捷编辑、创建按钮）。
 * 其余场景一律让位给 Payload 原生视图——它本来就正确处理回收站与行选择。
 *
 * ## 判定按「白名单」写，失败时降级而不是坏掉
 *
 * 只有**确认是整页列表**才接管；其它一律让位。这样即使将来 Payload 新增调用
 * 场景、或改了这里依赖的信号，最坏结果也只是「看到原生列表」，而不是
 * 「功能坏了但看起来正常」——后者才是真正危险的失败形态。
 */

/** Payload 传给列表视图的、与「渲染上下文」有关的信号。 */
export type ListViewContextSignals = Pick<
  ListViewClientProps,
  'disableBulkDelete' | 'disableBulkEdit' | 'viewType'
>

/**
 * 是否必须让位给 Payload 原生列表视图。
 *
 * - `viewType !== 'list'`：回收站（`'trash'`）以及将来任何新视图类型。
 * - 关系抽屉：`ListDrawer/DrawerContent` 调 `render-list` 时**同时**显式传
 *   `disableBulkDelete: true` 与 `disableBulkEdit: true`；整页列表两者都不传
 *   （除非 collection 自己配了，本仓库没有）。这是服务端唯一能拿到的抽屉信号
 *   ——`drawerSlug` 不在传给组件的 props 里。
 */
export function shouldDeferToDefaultListView(signals: ListViewContextSignals): boolean {
  if (signals.viewType !== 'list') return true
  return signals.disableBulkDelete === true && signals.disableBulkEdit === true
}
