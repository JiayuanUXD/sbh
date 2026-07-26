'use client'

import { Button, Descriptions, Empty, Space, Tag, Typography } from '@arco-design/web-react'
import { IconApps } from '@arco-design/web-react/icon'

const { Title, Text } = Typography

/**
 * 楼盘有效房源聚合卡片 - 客户端展示（tasks.md M3.4 / R3）
 *
 * 纯展示 + 一个「查看房源」跳转。数据由服务端父组件按用户权限脱敏后传入,
 * 本组件不再取数(聚合口径与权限已在服务端定稿)。
 *
 * 「查看房源」用原生 Listings 列表的过滤 URL(where[building][equals]=<id>),
 * 不新增端点——列表本身已受 Listings 读权限与字段脱敏约束(R1)。
 */

type RentRange = {
  unit: string
  min: number
  max: number
  count: number
}

type Props = {
  buildingId: string
  count: number
  totalArea: number
  rentRanges: RentRange[]
}

/** 租金单位 → 中文(镜像 Listings.rentUnit options,跨单位绝不合并展示)。 */
const RENT_UNIT_LABELS: Record<string, string> = {
  'rmb-sqm-day': '元/㎡/天',
  'rmb-month': '元/月',
  'rmb-seat-month': '元/工位/月',
}

function formatRent(range: RentRange): string {
  const label = RENT_UNIT_LABELS[range.unit] ?? range.unit
  const value = range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`
  return `${value} ${label}`
}

/** 面积保留至多一位小数,整数不显示 .0。 */
function formatArea(area: number): string {
  return Number.isInteger(area) ? String(area) : area.toFixed(1)
}

export default function BuildingAggregateCardClient({
  buildingId,
  count,
  totalArea,
  rentRanges,
}: Props) {
  const listingsUrl = `/admin/collections/listings?where[building][equals]=${encodeURIComponent(
    buildingId,
  )}`

  return (
    <div
      style={{
        border: '1px solid var(--theme-elevation-100, #e5e5e5)',
        borderRadius: 6,
        padding: '16px 20px',
        marginBottom: 20,
      }}
    >
      <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
        <Title heading={6} style={{ margin: 0 }}>
          有效房源聚合
        </Title>
        <Button type="secondary" size="small" icon={<IconApps />} href={listingsUrl}>
          查看房源
        </Button>
      </Space>

      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
        口径:可租(available) + 楼盘运营中(active) + 未删除
      </Text>

      {count === 0 ? (
        <Empty description="暂无符合有效供给口径的房源" style={{ padding: '16px 0' }} />
      ) : (
        <Descriptions
          style={{ marginTop: 12 }}
          column={2}
          layout="inline-vertical"
          colon=""
          data={[
            { label: '有效套数', value: `${count} 套` },
            { label: '总面积', value: `${formatArea(totalArea)} ㎡` },
            {
              label: '租金区间',
              value:
                rentRanges.length === 0 ? (
                  <Text type="secondary">未录入租金</Text>
                ) : (
                  <Space wrap>
                    {rentRanges.map((r) => (
                      <Tag key={r.unit} color="arcoblue">
                        {formatRent(r)}
                      </Tag>
                    ))}
                  </Space>
                ),
            },
          ]}
        />
      )}
    </div>
  )
}
