'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Space, Tag, Typography } from '@arco-design/web-react'
import { useFormFields } from '@payloadcms/ui'

import {
  availablePublicationActions,
  resolveLiveListingState,
  type PublicationActionSpec,
} from '@/domain/listing/publication-actions'
import {
  PUBLICATION_STATUS_LABELS,
  type PublicationStatus,
} from '@/domain/review/publication-status'
import ListingPublicationActionModal from './ListingPublicationActionModal'

const { Text } = Typography

type Props = {
  listingId: string
  listingTitle: string
  /** RSC 渲染那一刻的快照，仅作为表单实时值缺失时的兜底 */
  initialPublicationStatus: PublicationStatus
  /** 已保存文档的租售类型，动作条唯一的来源（不读表单实时值，理由见下方组件注释） */
  initialBusinessType: string | null
  initialVersion: number | null
  /** 权限来自服务端（会话级，表单里没有），只决定按钮显隐；端点才是强制点 */
  canPublish: boolean
  canUnpublish: boolean
}

/**
 * 与房源列表视图的发布态标签同一套配色（`ListingsListViewClient` 的
 * PUBLICATION_STATUS_COLORS）：同一个状态在列表与编辑页必须是同一个颜色，
 * 否则运营会以为是两种东西。
 */
const STATUS_COLOR: Record<PublicationStatus, string> = {
  draft: 'gray',
  published: 'green',
  unpublished: 'orange',
  leased: 'arcoblue',
  sold: 'purple',
}

/**
 * 编辑页顶部的发布轴动作条。
 *
 * **发布态与版本号读 Payload 表单的实时值，不是服务端快照。** 动作条挂在
 * `beforeDocumentControls`，那是服务端组件，只在页面 RSC 渲染时算一次；而
 * `protectListing` 每次 update 都把 `version` +1，`adminAutoPublish` 还可能顺带改
 * `publicationStatus`。编辑视图保存成功后只把新 form state 合并回表单，**不重渲染服务端组件**
 * （`@payloadcms/ui` 的 Edit view：`onSuccess` → `getFormState` → `MERGE_SERVER_STATE`）。
 * 拿快照的后果是「打开 → 改字段 → 保存（21→22）→ 点下架」必撞一次 409，
 * 运营要被弹一次「本页数据已过期」再点第二次。读实时值就没有这一次。
 *
 * **租售类型（businessType）恰恰相反，只认已保存文档**：它决定「标记已租」还是「标记已售」出现，
 * 读实时值的话，未保存的租赁→出售切换会立刻解锁「标记已售」，点下去就把库里仍是租赁的房源
 * 标成已售——不可撤销，且正是这个用来防止点错的控件造出来的。
 *
 * 本组件渲染在 `DocumentControls` 里，而 `DocumentControls` 是 `<Form>` 的子树
 * （`@payloadcms/ui/dist/views/Edit/index.js:452` 的 Form → `:527` 的 DocumentControls），
 * 所以 `useFormFields` 可用；同槽的 `FormModifiedBridge` 用 `useFormModified` 也是同一个前提。
 *
 * 可用动作用 T1 的纯函数现算（客户端不复制状态机规则）；动作为空时只显示状态标签，
 * 不显示任何按钮——终态（已租 / 已售）就是这种情况。
 */
export default function ListingPublicationActionsClient({
  listingId,
  listingTitle,
  initialPublicationStatus,
  initialBusinessType,
  initialVersion,
  canPublish,
  canUnpublish,
}: Props) {
  const router = useRouter()
  const [active, setActive] = useState<PublicationActionSpec | null>(null)

  // 两个字段各订阅一次：useFormFields 是选择器式订阅，只有选中的值变了才重渲染动作条。
  // businessType 故意不订阅表单实时值：未保存的租售切换不能立刻解锁「标记已售」——那会把
  // DB 里仍是租赁的房源标成已售（端点按库里的 lease 走状态机，published → sold 合法），
  // 是一条不可撤销的口径错误。租售类型改动必须先保存，动作后的 router.refresh() 会带回新值。
  const liveStatus = useFormFields(([fields]) => fields.publicationStatus?.value)
  const liveVersion = useFormFields(([fields]) => fields.version?.value)

  const { publicationStatus, businessType, version } = resolveLiveListingState(
    {
      publicationStatus: liveStatus,
      version: liveVersion,
    },
    {
      publicationStatus: initialPublicationStatus,
      businessType: initialBusinessType,
      version: initialVersion,
    },
  )

  const actions = availablePublicationActions({
    publicationStatus,
    businessType,
    canPublish,
    canUnpublish,
  })

  return (
    <div className="listing-publication-actions">
      <Space align="center" wrap>
        <Text type="secondary" style={{ fontSize: 12 }}>
          发布状态
        </Text>
        <Tag color={STATUS_COLOR[publicationStatus]}>
          {PUBLICATION_STATUS_LABELS[publicationStatus]}
        </Tag>
        {actions.map((spec) => (
          <Button
            key={spec.action}
            size="small"
            type={spec.tone === 'primary' ? 'primary' : 'outline'}
            status={spec.tone === 'primary' ? 'default' : spec.tone}
            onClick={() => setActive(spec)}
          >
            {spec.label}
          </Button>
        ))}
      </Space>
      <ListingPublicationActionModal
        listingId={listingId}
        listingTitle={listingTitle}
        spec={active}
        version={version}
        onClose={() => setActive(null)}
        // 端点改的是库，表单不知道；router.refresh() 重取整条路由，Payload 会把新的
        // initialState 交给 <Form>（Form 对 initialState 变化做 REPLACE_STATE），
        // 于是实时值与新快照一起翻新——发布态、version、可用动作一次到位。
        onDone={() => router.refresh()}
      />
    </div>
  )
}
