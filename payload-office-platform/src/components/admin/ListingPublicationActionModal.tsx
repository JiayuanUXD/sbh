'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Message, Modal, Typography } from '@arco-design/web-react'

import type { PublicationActionSpec } from '@/domain/listing/publication-actions'
import { isPublicationStatus, type PublicationStatus } from '@/domain/review/publication-status'

const { Paragraph, Text } = Typography

export type ListingPublicationActionModalProps = {
  listingId: string
  listingTitle: string
  /** null = 关闭 */
  spec: PublicationActionSpec | null
  /** 读取时的版本号，作为 expectedVersion；null 表示不带乐观锁 */
  version: number | null
  onClose: () => void
  /** 成功后调用（调用方负责 router.refresh() 或本地刷新） */
  onDone: (next: PublicationStatus) => void
}

type PublishResponse = {
  ok?: boolean
  publicationStatus?: unknown
  error?: string
  code?: string
  reasons?: unknown
}

/**
 * 发布轴动作的共享确认弹层（编辑页动作条与列表「下架」共用）。
 *
 * 所有规则都在端点：这里只做三件事——把后果说清楚、下架时收原因、带 expectedVersion 提交。
 * 409（版本冲突 / 非法转移）与 422（前置不满足 / 缺原因）都把端点结论原样展示，
 * 不自己翻译成「操作失败」——运营需要知道是「别人改过了」还是「商户资质过期」。
 *
 * 外层只负责开关：真正的表单状态放在内层，并以 spec.action 为 key。这样每次打开
 * （以及换一个动作）都是一次全新挂载，原因 / 错误天然回到初值，不必在 effect 里手动清空
 * （effect 清空会先渲染一帧上一次的内容，也会撞 React Compiler 的 cascading-render 规则）。
 */
export default function ListingPublicationActionModal(
  props: ListingPublicationActionModalProps,
) {
  const { spec } = props
  if (!spec) return null
  return <ListingPublicationActionModalBody key={spec.action} {...props} spec={spec} />
}

type BodyProps = Omit<ListingPublicationActionModalProps, 'spec'> & {
  spec: PublicationActionSpec
}

function ListingPublicationActionModalBody({
  listingId,
  listingTitle,
  spec,
  version,
  onClose,
  onDone,
}: BodyProps) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasons, setReasons] = useState<string[]>([])

  const reasonMissing = spec.requiresReason && reason.trim().length === 0

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    setReasons([])
    try {
      const res = await fetch(`/api/listings/${listingId}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: spec.action,
          ...(spec.requiresReason ? { reason: reason.trim() } : {}),
          ...(version !== null ? { expectedVersion: version } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as PublishResponse
      if (res.ok && data.ok && isPublicationStatus(data.publicationStatus)) {
        Message.success(`已${spec.label}`)
        onDone(data.publicationStatus)
        onClose()
        return
      }
      // 两个 409 都意味着「本页读到的状态已经不是库里的状态」：VERSION_CONFLICT 是版本号对不上，
      // ILLEGAL_TRANSITION 是别人已经把它推到了别的状态。端点对后者的原文带的是英文枚举名
      // （「当前状态 published 不允许 unpublish」），运营读不懂，这里换成同义的中文提示。
      if (res.status === 409 && data.code === 'ILLEGAL_TRANSITION') {
        setError('房源状态已被他人变更，当前动作不再适用，请刷新后重试')
      } else if (res.status === 409) {
        setError('本页数据已过期，请刷新后重试')
      } else if (res.status === 401 || res.status === 403) {
        setError('没有执行该动作的权限')
      } else {
        setError(data.error ?? `${spec.label}失败（HTTP ${res.status}）`)
      }
      if (res.status === 409) {
        // 顺手把服务端组件重取一遍：拿到新的 version 与可用动作，用户刷新前重试就不会再撞 409。
        // 弹层不自动关闭——错误文案要留在屏幕上，否则用户只看到按钮没反应。
        router.refresh()
      }
      if (Array.isArray(data.reasons)) {
        setReasons(data.reasons.filter((r): r is string => typeof r === 'string'))
      }
    } catch {
      setError('网络异常，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={`${spec.confirmTitle}${listingTitle ? `「${listingTitle}」` : ''}`}
      visible
      onCancel={onClose}
      onOk={submit}
      confirmLoading={submitting}
      okText={`确认${spec.label}`}
      cancelText="取消"
      okButtonProps={{
        // Arco 的 status 没有 primary（那是 type），上架类用默认色，其余按语义上警告 / 危险色。
        status: spec.tone === 'primary' ? 'default' : spec.tone,
        // 下架原因为空时直接禁用确认，而不是提交后吃一个 422（G5：不拿 422 当校验）。
        disabled: reasonMissing,
      }}
    >
      {spec.confirmBody.map((line) => (
        <Paragraph key={line}>{line}</Paragraph>
      ))}
      {spec.requiresReason ? (
        <Input.TextArea
          value={reason}
          onChange={setReason}
          placeholder="下架原因（必填，记入审计）"
          autoSize={{ minRows: 2, maxRows: 5 }}
          maxLength={200}
          showWordLimit
        />
      ) : null}
      {error ? (
        <Paragraph style={{ marginTop: 12 }}>
          <Text type="error">{error}</Text>
        </Paragraph>
      ) : null}
      {reasons.length > 0 ? (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {reasons.map((r) => (
            <li key={r}>
              <Text type="error">{r}</Text>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}
