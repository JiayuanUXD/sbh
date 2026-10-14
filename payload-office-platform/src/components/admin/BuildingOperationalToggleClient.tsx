'use client'

import { useRouter } from 'next/navigation'
import { Button, Space, Tag, Typography } from '@arco-design/web-react'
import { IconPause, IconPlayArrow } from '@arco-design/web-react/icon'

import { useBuildingOperationalAction } from './useBuildingOperationalAction'

const { Text } = Typography

/**
 * 楼盘启停按钮 - 客户端（tasks.md M3.4「完成……启停……动作」/ R3, M3 验收门第 3 条）
 *
 * 确认流程（停用前预检受影响房源数、带目标状态提交、失败透传端点文案）在
 * `useBuildingOperationalAction`，与楼盘库列表的「停用」共用一份（OPT-113）。
 * 本组件只渲染状态标签与按钮，成功后 router.refresh() 让编辑视图与聚合卡片重取。
 */

type Props = {
  buildingId: string
  operationalStatus: 'active' | 'disabled'
  buildingName: string
}

export default function BuildingOperationalToggleClient({
  buildingId,
  operationalStatus,
  buildingName,
}: Props) {
  const router = useRouter()
  const { open, modal } = useBuildingOperationalAction(() => router.refresh())

  const willDisable = operationalStatus === 'active'
  const actionLabel = willDisable ? '停用' : '启用'

  return (
    <div>
      <Space align="center">
        <Text type="secondary" style={{ fontSize: 12 }}>
          运营状态
        </Text>
        <Tag color={willDisable ? 'green' : 'gray'}>{willDisable ? '运营中' : '已停用'}</Tag>
        <Button
          type={willDisable ? 'outline' : 'primary'}
          status={willDisable ? 'warning' : 'default'}
          size="small"
          icon={willDisable ? <IconPause /> : <IconPlayArrow />}
          onClick={() => open({ id: buildingId, name: buildingName, status: operationalStatus })}
        >
          {actionLabel}
        </Button>
      </Space>
      {modal}
    </div>
  )
}
