'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Message, Modal, Space, Tag, Typography } from '@arco-design/web-react'
import { IconPause, IconPlayArrow } from '@arco-design/web-react/icon'

const { Text, Paragraph } = Typography

/**
 * 楼盘启停按钮 - 客户端（tasks.md M3.4「完成……启停……动作」/ R3, M3 验收门第 3 条）
 *
 * 两个动作,共用一个二次确认 Modal:
 *   - active → disabled(停用):先 GET deactivation-impact 展示受影响房源数(M3.5 语义),
 *     用户确认后再 POST toggle。停用只撤销前台有效性,绝不改写关联房源审核/发布状态(R3)。
 *   - disabled → active(启用):无破坏性,直接确认后 POST toggle。
 *
 * 权限与状态翻转全在 endpoint 服务端强制(building:freeze);本组件失败时透传后端
 * 错误文案(401/403/404/400),成功后 router.refresh() 让编辑视图与聚合卡片重取。
 */

type Props = {
  buildingId: string
  operationalStatus: 'active' | 'disabled'
  buildingName: string
}

type ImpactSource = { collection: string; label: string; count: number }
type ImpactReport = {
  buildingId: number | string
  sources: ImpactSource[]
  total: number
  referenced: boolean
}

export default function BuildingOperationalToggleClient({
  buildingId,
  operationalStatus,
  buildingName,
}: Props) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [impact, setImpact] = useState<ImpactReport | null>(null)
  const [loadingImpact, setLoadingImpact] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const willDisable = operationalStatus === 'active'
  const actionLabel = willDisable ? '停用' : '启用'

  const openModal = async () => {
    setError(null)
    setImpact(null)
    setModalOpen(true)
    // 停用前拉取受影响房源数(启用无破坏性,跳过预检)
    if (willDisable) {
      setLoadingImpact(true)
      try {
        const resp = await fetch(`/api/buildings/${buildingId}/deactivation-impact`, {
          credentials: 'include',
        })
        const data = (await resp.json()) as { ok?: boolean; error?: string; report?: ImpactReport }
        if (!resp.ok || !data.ok || !data.report) {
          setError(data.error ?? '预检受影响房源失败')
        } else {
          setImpact(data.report)
        }
      } catch {
        setError('预检受影响房源失败')
      } finally {
        setLoadingImpact(false)
      }
    }
  }

  const confirm = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const resp = await fetch(`/api/buildings/${buildingId}/toggle-operational-status`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = (await resp.json()) as {
        ok?: boolean
        error?: string
        operationalStatus?: string
      }
      if (!resp.ok || !data.ok) {
        setError(data.error ?? `${actionLabel}失败`)
        return
      }
      setModalOpen(false)
      Message.success(`已${actionLabel}`)
      router.refresh()
    } catch {
      setError(`${actionLabel}失败`)
    } finally {
      setSubmitting(false)
    }
  }

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
          onClick={openModal}
        >
          {actionLabel}
        </Button>
      </Space>

      <Modal
        title={`${actionLabel}楼盘${buildingName ? `「${buildingName}」` : ''}`}
        visible={modalOpen}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText={`确认${actionLabel}`}
        cancelText="取消"
        onOk={confirm}
        okButtonProps={{ status: willDisable ? 'warning' : 'default' }}
      >
        {willDisable ? (
          <>
            <Paragraph>
              停用后该楼盘在 C 端不再展示,其下房源的审核/发布状态<Text bold>保持不变</Text>。
            </Paragraph>
            {loadingImpact ? (
              <Text type="secondary">正在统计受影响房源…</Text>
            ) : impact ? (
              impact.total > 0 ? (
                <Paragraph>
                  将影响 <Text bold>{impact.total}</Text> 项对外可见记录:
                  <Space wrap style={{ marginTop: 8 }}>
                    {impact.sources.map((s) => (
                      <Tag key={s.collection} color="orange">
                        {s.label} {s.count}
                      </Tag>
                    ))}
                  </Space>
                </Paragraph>
              ) : (
                <Text type="secondary">当前无对外可见房源受影响。</Text>
              )
            ) : null}
          </>
        ) : (
          <Paragraph>启用后该楼盘及其符合有效供给口径的房源将重新在 C 端展示。</Paragraph>
        )}
        {error ? (
          <Text type="error" style={{ display: 'block', marginTop: 8 }}>
            {error}
          </Text>
        ) : null}
      </Modal>
    </div>
  )
}
