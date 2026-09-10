'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Space, Tag, Typography } from '@arco-design/web-react'

import type { PublicationActionSpec } from '@/domain/listing/publication-actions'
import {
  PUBLICATION_STATUS_LABELS,
  type PublicationStatus,
} from '@/domain/review/publication-status'
import ListingPublicationActionModal from './ListingPublicationActionModal'

const { Text } = Typography

type Props = {
  listingId: string
  listingTitle: string
  publicationStatus: PublicationStatus
  version: number | null
  actions: readonly PublicationActionSpec[]
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
 * 编辑页顶部的发布轴动作条。可用动作由服务端算好传进来（按当前状态 × 租售 × 权限），
 * 这里只渲染；动作为空时只显示状态标签，不显示任何按钮——终态（已租 / 已售）就是这种情况。
 */
export default function ListingPublicationActionsClient({
  listingId,
  listingTitle,
  publicationStatus,
  version,
  actions,
}: Props) {
  const router = useRouter()
  const [active, setActive] = useState<PublicationActionSpec | null>(null)

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
        // 服务端组件重取：新的发布态、新的 version、新的可用动作一次到位
        // （本地 setState 只能改标签，改不了「下架后应该出现重新上架按钮」）。
        onDone={() => router.refresh()}
      />
    </div>
  )
}
