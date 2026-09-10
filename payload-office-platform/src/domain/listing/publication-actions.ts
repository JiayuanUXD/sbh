import {
  PUBLICATION_STATUS_LABELS,
  PUBLISH_ACTIONS,
  PUBLISH_ACTION_LABELS,
  isPublicationStatus,
  nextPublicationStatus,
  type PublicationStatus,
  type PublishAction,
} from '@/domain/review/publication-status'

export type PublicationActionSpec = {
  action: PublishAction
  label: string
  /** 按钮语义：primary=上架类，warning=下架，danger=成交终态（不可逆） */
  tone: 'primary' | 'warning' | 'danger'
  /** 仅 unpublish 为 true（端点强制下架必填原因） */
  requiresReason: boolean
  /** 确认弹层标题与正文（正文逐段，客户端逐段渲染） */
  confirmTitle: string
  confirmBody: readonly string[]
}

export type PublicationActionInput = {
  publicationStatus: PublicationStatus
  /** 'lease' | 'sale'；缺省按 lease */
  businessType: string | null | undefined
  /** hasOperationPermission('listing:publish') */
  canPublish: boolean
  /** hasOperationPermission('listing:unpublish') */
  canUnpublish: boolean
}

/**
 * 动作条从 Payload 表单状态里取到的原始值（`useFormFields` 给的是 unknown）。
 *
 * 故意**不含** `businessType`：租售类型只认已保存文档，理由见 `resolveLiveListingState`。
 */
export type LiveListingStateFields = {
  publicationStatus?: unknown
  version?: unknown
}

/** 服务端渲染那一刻的快照，作为实时值缺失 / 非法时的兜底。 */
export type LiveListingState = {
  publicationStatus: PublicationStatus
  businessType: string | null
  version: number | null
}

/**
 * 把「表单实时值」与「RSC 初始快照」合成动作条真正要用的状态。
 *
 * 为什么 `publicationStatus` / `version` 必须读实时值：`beforeDocumentControls` 是服务端组件，
 * 只在页面 RSC 渲染时算一次；而 `protectListing`（`src/domain/review/listing-protect.ts`）
 * 每次 update 都把 `version` +1，`adminAutoPublish` 还可能顺带改 `publicationStatus`。
 * 编辑视图保存成功后只会把新 form state 合并回表单（`@payloadcms/ui` 的 Form
 * `MERGE_SERVER_STATE`），**不重渲染服务端组件**。于是「打开 → 改字段 → 保存（21→22）→ 点下架」
 * 会带着 21 提交，必撞 409，运营得被弹一次「本页数据已过期」再点第二次。读实时值就没有这一次。
 *
 * 为什么 `businessType` 反过来**只认已保存文档**：它决定的是「标记已租 / 标记已售」哪个按钮出现。
 * 如果读实时值，表单里把租赁改成出售、还没保存，动作条就立刻解锁「标记已售」；点下去端点按库里的
 * `lease` 走状态机（`published → sold` 合法），结果是 `publicationStatus=sold` 而 `businessType`
 * 仍是 `lease`——一条不可撤销的口径错误，恰恰由「防止点错」的控件制造。租售类型改动必须先保存，
 * 动作后的 `router.refresh()` 会把保存后的新值带回来，所以保存过的切换不会滞后。
 *
 * 回落规则：实时值缺失或类型不对就用初始快照——表单状态里没有该字段（权限裁剪、
 * 字段被条件隐藏）时不能把动作条打成空白，旧快照至少还能撞出一次可解释的 409。
 */
export function resolveLiveListingState(
  fields: LiveListingStateFields,
  initial: LiveListingState,
): LiveListingState {
  return {
    publicationStatus: isPublicationStatus(fields.publicationStatus)
      ? fields.publicationStatus
      : initial.publicationStatus,
    // 只取已保存文档的值，表单实时值一律不参与（理由见上）。
    businessType: initial.businessType,
    // 会被原样当 expectedVersion 发出去，所以 NaN / Infinity / 字符串 '22' 一律不认。
    version:
      typeof fields.version === 'number' && Number.isFinite(fields.version)
        ? fields.version
        : initial.version,
  }
}

/**
 * 表单有未保存改动时，发布动作一律不可用；返回禁用理由，可用则返回 null。
 *
 * 为什么必须挡：动作成功后动作条会 `router.refresh()`，Payload 会把重取到的
 * `initialState` 交给 `<Form>`（对 initialState 变化做 REPLACE_STATE），表单里没保存的编辑
 * 会被整体换掉、连一句提示都没有。「改了几个字段 → 顺手点下架 → 编辑全没了」是个静默的数据丢失，
 * 而下架本身还成功了，运营多半不会意识到发生过什么。
 *
 * 这里选择禁用而不是隐藏（与 `availablePublicationActions` 里「不可用就不渲染」相反）：
 * 那边的不可用是结构性的（状态机 / 权限不给），说不清也没得说；这里是暂时的，
 * 按钮留在原位加一句「先保存」才能告诉运营下一步该干什么。
 */
export function publicationActionsDisabledReason(formModified: boolean): string | null {
  return formModified ? '有未保存的改动，请先保存再执行发布动作' : null
}

/** 与 listing-publish-endpoint.ts 的 permissionForAction 同口径；端点是唯一强制点，这里只用来决定按钮显隐。 */
export function permissionForPublishAction(action: PublishAction): 'listing:publish' | 'listing:unpublish' {
  return action === 'unpublish' ? 'listing:unpublish' : 'listing:publish'
}

/**
 * 房源编辑页动作条的可用动作。
 *
 * 候选只从状态机的转移表派生——客户端绝不复制转移表，否则状态机改了
 * 这里不会红。租赁房源只给「标记已租」、出售房源只给「标记已售」：同一套房源给两个
 * 成交按钮，运营点错一个就是不可逆的口径错误（leased/sold 分开的理由见 publication-status.ts）。
 * 不可用的动作不返回（不渲染），不是禁用：一个灰按钮要解释「为什么灰」，不渲染不用解释。
 *
 * 权限：unpublish 需 canUnpublish，其余需 canPublish。
 * 顺序：直接沿用 PUBLISH_ACTIONS 的声明序（publish → unpublish → mark_leased → mark_sold），
 * 让按钮位置在不同状态间稳定，运营不会因为状态变化而点错位置。
 */
export function availablePublicationActions(
  input: PublicationActionInput,
): readonly PublicationActionSpec[] {
  const isSale = input.businessType === 'sale'
  const specs: PublicationActionSpec[] = []
  for (const action of PUBLISH_ACTIONS) {
    // 用 nextPublicationStatus 而不是 canTransitionPublication 当闸门：两者读的是同一张
    // 转移表（null 即非法转移），但前者顺带把目标状态给出来，确认文案就不必再写一遍状态名。
    const next = nextPublicationStatus(input.publicationStatus, action)
    if (next === null) continue
    if (action === 'mark_leased' && isSale) continue
    if (action === 'mark_sold' && !isSale) continue
    const allowed = action === 'unpublish' ? input.canUnpublish : input.canPublish
    if (!allowed) continue
    specs.push(specFor(action, input.publicationStatus, next))
  }
  return specs
}

/**
 * 文案唯一来源是 PUBLISH_ACTION_LABELS / PUBLICATION_STATUS_LABELS，这里不另写一份动作名或状态名。
 *
 * `next` 由调用方从状态机取得（不是本函数再判一次动作 → 目标状态）：目标状态名一旦写成
 * 字面量，改一次 PUBLICATION_STATUS_LABELS 就会出现「状态徽标说 A、确认弹层说 B」，
 * 而弹层里那句正是运营点「不可撤销」之前唯一会读的话。
 */
function specFor(
  action: PublishAction,
  status: PublicationStatus,
  next: PublicationStatus,
): PublicationActionSpec {
  const label = PUBLISH_ACTION_LABELS[action]
  const current = PUBLICATION_STATUS_LABELS[status]
  const target = PUBLICATION_STATUS_LABELS[next]
  switch (action) {
    case 'publish':
      return {
        action, label, tone: 'primary', requiresReason: false,
        // 从已下架回到已发布是「重新上架」而不是「发布」：运营看到「发布」会以为是首次上架。
        confirmTitle: status === 'unpublished' ? '重新上架' : label,
        confirmBody: [
          `当前状态：${current} → ${target}。`,
          '房源需满足有效供给条件（审核通过、楼盘与商户启用、商户资质有效等）才会真正出现在前台；不满足时会列出原因，不改状态。',
        ],
      }
    case 'unpublish':
      return {
        action, label, tone: 'warning', requiresReason: true,
        confirmTitle: label,
        confirmBody: [
          `当前状态：${current} → ${target}。下架后前台立即不可见。`,
          '必须填写下架原因，会记入审计。',
        ],
      }
    case 'mark_leased':
    case 'mark_sold':
      return {
        action, label, tone: 'danger', requiresReason: false,
        confirmTitle: label,
        confirmBody: [
          `当前状态：${current} → ${target}。`,
          '将同时撤销首页推荐，并收回前台可见。',
          '成交为终态，不可撤销；要重新出租或出售请新建房源。',
        ],
      }
  }
}
