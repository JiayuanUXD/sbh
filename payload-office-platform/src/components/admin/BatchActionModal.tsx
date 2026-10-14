'use client'

import { useEffect, useState } from 'react'
import { Input, Message, Modal, Typography } from '@arco-design/web-react'

import { effectiveSupplyExclusionLabel } from '@/domain/review/effective-supply-labels'
import {
  parseBatchResponse,
  type BatchItem,
  type BatchItemResult,
  type BatchResponse,
} from '@/domain/shared/batch-request'

const { Paragraph, Text } = Typography

/**
 * 列表批量动作的确认 + 结果弹层（OPT-113，楼盘库与房源列表共用）。
 *
 * 只做三件事：把后果和「将跳过哪些」说清楚、需要时收原因、提交后逐条展示结果。
 * 规则全在端点（`/api/{listings,buildings}/batch-publish`、`/api/buildings/batch-operational-status`），
 * 三个端点同一响应形状。
 *
 * 两段式：
 *   - 确认段：正文 + 只读预检结果（如批量停用的受影响房源数）+ 跳过清单 + 原因输入；
 *   - 结果段：仅在有失败条目时出现，逐条列出失败原因。全部成功直接 toast 并关闭——
 *     没有需要运营读的东西，就别让他多点一次。
 * 关闭（无论哪一段，只要已提交过）都会触发 onDone，由调用方刷新列表、清空勾选。
 *
 * 外层只负责开关、内层以 request.key 为 key：每次打开都是全新挂载，原因 / 结果自然回到初值
 * （理由同 ListingPublicationActionModal）。
 */

export type BatchActionRequest = {
  /** 每次打开换一个值，保证内层重新挂载 */
  key: string
  endpoint: string
  /** 合进请求体的动作参数：批量上下架 `{ action }`，批量启停 `{ target }` */
  params: Readonly<Record<string, string>>
  title: string
  /** 动作动词，用于「已上架 3 条」之类的提示 */
  verb: string
  tone: 'primary' | 'warning'
  body: readonly string[]
  items: readonly BatchItem[]
  skipped: ReadonlyArray<{ id: number; name: string; reason: string }>
  /** 原因输入框的无障碍名；null 表示不收原因 */
  reasonLabel: string | null
  /**
   * 打开时就已发出的只读预检，resolve 成一句展示文案（批量停用用它展示受影响房源数）。
   * 由调用方在点击处理里发起，弹层只负责等结果；预检失败不挡确认（停用是人为决策，与单条一致）。
   */
  preflight?: Promise<string>
}

export type BatchActionModalProps = {
  request: BatchActionRequest | null
  /** id → 行名（标题 / 楼盘名），结果段用 */
  nameOf: (id: number) => string
  onClose: () => void
  /** 只要提交过（不论成败），关闭时调用一次 */
  onDone: () => void
}

/** 跳过清单最多列这么多行，多出的折成「等 N 条」——一页 100 行全列出来弹层会比列表还长。 */
const SKIPPED_PREVIEW = 8

export default function BatchActionModal(props: BatchActionModalProps) {
  const { request } = props
  if (!request) return null
  return <BatchActionModalBody key={request.key} {...props} request={request} />
}

type BodyProps = Omit<BatchActionModalProps, 'request'> & { request: BatchActionRequest }

/**
 * 失败条目的展示文案。ILLEGAL_TRANSITION 只会在列表数据过期时出现（列表已按状态机预筛），
 * 房源端点对它的原文带英文枚举名，这里统一换成同义中文。
 */
function failureText(result: Extract<BatchItemResult, { ok: false }>): string {
  if (result.code === 'ILLEGAL_TRANSITION') return '状态已被他人变更，此操作不再适用'
  return result.error
}

function BatchActionModalBody({ request, nameOf, onClose, onDone }: BodyProps) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<BatchResponse | null>(null)
  const [preflightText, setPreflightText] = useState<string | null>(null)

  // 只在 promise 落定后写 state（不在 effect 体里同步 setState）；卸载后晚到的结果丢弃。
  useEffect(() => {
    if (!request.preflight) return
    let active = true
    request.preflight.then(
      (text) => {
        if (active) setPreflightText(text)
      },
      () => {
        if (active) setPreflightText('受影响记录统计失败，仍可继续操作')
      },
    )
    return () => {
      active = false
    }
  }, [request.preflight])

  const needsReason = request.reasonLabel !== null
  const reasonMissing = needsReason && reason.trim().length === 0
  const nothingToDo = request.items.length === 0

  const close = () => {
    onClose()
    if (submitted) onDone()
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(request.endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...request.params,
          items: request.items,
          ...(needsReason ? { reason: reason.trim() } : {}),
        }),
      })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setError('没有执行该操作的权限')
        } else {
          const message =
            data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
              ? data.error
              : null
          setError(message ?? `操作失败（HTTP ${res.status}）`)
        }
        return
      }
      const parsed = parseBatchResponse(data)
      if (!parsed) {
        setError('服务端返回格式异常，请刷新列表确认结果')
        setSubmitted(true)
        return
      }
      setSubmitted(true)
      if (parsed.failed === 0) {
        Message.success(`已${request.verb} ${parsed.succeeded} 条`)
        onClose()
        onDone()
        return
      }
      setResponse(parsed)
    } catch {
      setError('网络异常，请刷新列表确认结果后重试')
      // 网络异常时不知道服务端处理到了哪一条，关闭时也刷新一次列表。
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (response) {
    const failures = response.results.filter(
      (r): r is Extract<BatchItemResult, { ok: false }> => !r.ok,
    )
    return (
      <Modal
        title={`${request.title}：部分未完成`}
        visible
        onCancel={close}
        onOk={close}
        okText="知道了"
        hideCancel
        maskClosable={false}
      >
        <Paragraph>
          成功 <Text bold>{response.succeeded}</Text> 条，未完成{' '}
          <Text bold type="error">
            {response.failed}
          </Text>{' '}
          条：
        </Paragraph>
        <ul style={{ margin: 0, maxHeight: 320, overflowY: 'auto', paddingLeft: 18 }}>
          {failures.map((f) => (
            <li key={f.id} style={{ marginBottom: 6 }}>
              <Text bold>{nameOf(f.id)}</Text>
              <Text type="secondary">：</Text>
              <Text type="error">{failureText(f)}</Text>
              {f.reasons && f.reasons.length > 0 ? (
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  {f.reasons.map(effectiveSupplyExclusionLabel).join('；')}
                </Text>
              ) : null}
            </li>
          ))}
        </ul>
      </Modal>
    )
  }

  const skippedPreview = request.skipped.slice(0, SKIPPED_PREVIEW)
  const skippedRest = request.skipped.length - skippedPreview.length

  return (
    <Modal
      title={request.title}
      visible
      onCancel={close}
      onOk={submit}
      // 提交中不给 ESC / 点遮罩关闭：请求已发出，弹层一关运营就看不到结果（同单条弹层）。
      escToExit={!submitting}
      maskClosable={false}
      confirmLoading={submitting}
      okText={`确认${request.verb}`}
      cancelText="取消"
      okButtonProps={{
        status: request.tone === 'primary' ? 'default' : request.tone,
        disabled: nothingToDo || reasonMissing,
      }}
    >
      {nothingToDo ? (
        <Paragraph>所选记录当前状态都不适用此操作。</Paragraph>
      ) : (
        request.body.map((line) => <Paragraph key={line}>{line}</Paragraph>)
      )}
      {request.preflight && !nothingToDo ? (
        <Paragraph>
          {preflightText ?? <Text type="secondary">正在统计受影响记录…</Text>}
        </Paragraph>
      ) : null}
      {request.skipped.length > 0 ? (
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          将跳过 {request.skipped.length} 条：
          {skippedPreview.map((s) => `${s.name}（${s.reason}）`).join('、')}
          {skippedRest > 0 ? ` 等 ${skippedRest} 条` : ''}
        </Paragraph>
      ) : null}
      {needsReason && !nothingToDo ? (
        <Input.TextArea
          aria-label={request.reasonLabel ?? undefined}
          value={reason}
          onChange={setReason}
          placeholder={`${request.reasonLabel}（必填，记入每条的审计）`}
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
    </Modal>
  )
}
