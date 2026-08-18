'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Message, Modal, Space, Typography } from '@arco-design/web-react'

/**
 * 免审直发 - 客户端（管理员发布的房源无需人工审核即可上架）
 *
 * 只负责确认与触发，规则全在服务端：
 *   - 权限（listing:review + listing:fast_track_review）
 *   - 状态机（仅 not_submitted / rejected 可直发，pending 不行）
 *   - 完整度校验（422 + missing 列表）
 *
 * 客户端不复制任何一条，也不预判能否成功——按钮点下去由服务端裁决。这里唯一的
 * 「本地判断」是把服务端返回的 missing 渲染出来，方便人知道要补什么。
 */

export type FastTrackMissingItem = Readonly<{
  field: string
  label?: string
  message?: string
}>

type Props = Readonly<{
  listingId: string
  expectedVersion?: number
  /** 用于文案区分：未提交是首次直发，已驳回是驳回后重新直发 */
  reviewStatus: 'not_submitted' | 'rejected'
}>

export default function ListingFastTrackActionClient({
  listingId,
  expectedVersion,
  reviewStatus,
}: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [missing, setMissing] = useState<readonly FastTrackMissingItem[]>([])

  const run = useCallback(async () => {
    setSubmitting(true)
    setMissing([])

    try {
      const res = await fetch(`/api/listings/${listingId}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'fast_track',
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        }),
      })

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        code?: string
        missing?: readonly FastTrackMissingItem[]
      }

      if (res.ok && data.ok) {
        Message.success('已免审直发，房源审核状态为「审核通过」')
        setConfirming(false)
        router.refresh()
        return
      }

      // 完整度不足：把缺什么摊开，而不是只丢一句「失败」
      if (res.status === 422 && data.code === 'INCOMPLETE_LISTING') {
        setMissing(data.missing ?? [])
        Message.error('房源信息不完整，无法免审直发')
        return
      }

      Message.error(data.error || `免审直发失败（HTTP ${res.status}）`)
    } catch (err) {
      Message.error(err instanceof Error ? err.message : '免审直发请求失败')
    } finally {
      setSubmitting(false)
    }
  }, [listingId, expectedVersion, router])

  return (
    <div style={{ marginBottom: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Space>
          <Button type="primary" onClick={() => setConfirming(true)}>
            免审直发
          </Button>
          <Typography.Text type="secondary">
            {reviewStatus === 'rejected'
              ? '该房源已被驳回。直发将跳过重新送审，直接置为审核通过。'
              : '跳过人工审核，直接置为审核通过。完整度校验仍然强制执行。'}
          </Typography.Text>
        </Space>

        {missing.length > 0 && (
          <Alert
            type="error"
            title="以下信息缺失，补齐后才能直发"
            content={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {missing.map((m) => (
                  <li key={m.field}>{m.label ?? m.message ?? m.field}</li>
                ))}
              </ul>
            }
          />
        )}
      </Space>

      <Modal
        title="确认免审直发？"
        visible={confirming}
        onCancel={() => setConfirming(false)}
        onOk={run}
        okText="确认直发"
        cancelText="取消"
        confirmLoading={submitting}
      >
        <Typography.Paragraph>
          直发会**跳过另一个人复核**这道约束，房源审核状态直接变为「审核通过」，并在
          审核记录里留下一条 <Typography.Text code>免审直发</Typography.Text> 事件，
          记录操作人——事后可追溯。
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          注意：直发只改审核状态，不会自动上架。是否对外可见仍由「发布状态」决定。
        </Typography.Paragraph>
      </Modal>
    </div>
  )
}
