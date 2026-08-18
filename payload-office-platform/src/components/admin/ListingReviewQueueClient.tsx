'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Input,
  Message,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
} from '@arco-design/web-react'
import type { ColumnProps } from '@arco-design/web-react/es/Table'

/**
 * 房源审核台 - 客户端（tasks.md M4.5 / R1, R4）
 *
 * 纯浏览 + 触发：队列表格、详情抽屉（字段完整度 + 缺失项定位 + 审核历史时间线）、
 * 通过/驳回 Modal（驳回强制原因）、撤回、可选"通过后上架"。
 *
 * 所有写动作走服务端 endpoint，服务端是权限/状态机/原因门槛的唯一强制点：
 *   - 通过/驳回/撤回 → POST /api/listings/:id/review
 *   - 通过后上架    → POST /api/listings/:id/publish (action=publish)
 * 客户端只按权限控制按钮可见性，不复制任何业务规则。
 */

/** 审核历史条目（服务端已归一为纯数据）。 */
export interface ReviewHistoryEntry {
  id: number
  decision: string | null
  taskStatus: 'pending' | 'processing' | 'resolved' | 'cancelled' | null
  reason: string | null
  actorName: string | null
  createdAt: string
}

/** 审核缺失项。 */
export interface MissingItem {
  label: string
  reason: string
}

/** 队列行。 */
export interface QueueRow {
  listingId: number
  title: string
  slug: string
  buildingName: string
  listingType: string
  version: number
  completenessScore: number
  missing: MissingItem[]
  submittedAt: string | null
  history: ReviewHistoryEntry[]
}

interface Props {
  rows: QueueRow[]
  canReview: boolean
  canPublish: boolean
}

/** 房源类型中文标签（与 Listings collection options 一致）。 */
const LISTING_TYPE_LABELS: Record<string, string> = {
  'traditional-office': '传统办公室',
  coworking: '共享办公',
  'full-floor': '整层办公',
  'serviced-office': '独栋办公',
}

/** 审核动作中文标签（与 review-status.ts 一致，客户端内联避免引入 node:crypto）。 */
const DECISION_LABELS: Record<string, string> = {
  submit: '提交审核',
  withdraw: '撤回',
  approve: '审核通过',
  reject: '驳回',
}

/** 任务状态中文标签（与 review-transition.ts 一致）。 */
const TASK_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已完成',
  cancelled: '已取消',
}

/** 时间戳格式化为北京时间可读串。 */
function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 完整度分数配色：<60 红，60-80 橙，>=80 绿。 */
function scoreColor(score: number): string {
  if (score >= 80) return 'green'
  if (score >= 60) return 'orange'
  return 'red'
}

export default function ListingReviewQueueClient({ rows, canReview, canPublish }: Props) {
  const router = useRouter()
  const [detail, setDetail] = useState<QueueRow | null>(null)
  // 动作抽屉：通过（可选上架）/ 驳回（强制原因）统一在这里确认执行，
  // 替代原来的"行内一键通过 + 驳回小弹窗"，避免误触并提供完整上下文。
  const [actionTarget, setActionTarget] = useState<{
    row: QueueRow
    type: 'approve' | 'reject'
  } | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [publishAfterApprove, setPublishAfterApprove] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const dualPermission = canReview && canPublish

  /** 打开动作抽屉（重置表单状态）。 */
  const openAction = useCallback((row: QueueRow, type: 'approve' | 'reject') => {
    setActionTarget({ row, type })
    setActionReason('')
    if (type === 'approve') setPublishAfterApprove(false)
  }, [])

  /** 调用 review 端点（通过/驳回/撤回)。返回是否成功。 */
  const callReview = useCallback(
    async (
      row: QueueRow,
      decision: 'approve' | 'reject' | 'withdraw',
      reason?: string,
    ): Promise<boolean> => {
      const res = await fetch(`/api/listings/${row.listingId}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          reason,
          expectedVersion: row.version,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: { message?: string } | string
      }
      if (!res.ok || !data.ok) {
        const msg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message || `操作失败（HTTP ${res.status}）`
        Message.error(msg)
        return false
      }
      return true
    },
    [],
  )

  /** 调用 publish 端点（通过后上架）。返回是否成功。 */
  const callPublish = useCallback(async (row: QueueRow): Promise<boolean> => {
    const res = await fetch(`/api/listings/${row.listingId}/publish`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'publish' }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      error?: { message?: string } | string
    }
    if (!res.ok || !data.ok) {
      const msg =
        typeof data.error === 'string'
          ? data.error
          : data.error?.message || `上架失败（HTTP ${res.status}）`
      Message.error(msg)
      return false
    }
    return true
  }, [])

  /** 通过（可选通过后上架）。 */
  const handleApprove = useCallback(
    async (row: QueueRow) => {
      setSubmitting(true)
      try {
        const approved = await callReview(row, 'approve')
        if (!approved) return
        if (dualPermission && publishAfterApprove) {
          const published = await callPublish(row)
          if (published) {
            Message.success('已通过并上架')
          } else {
            Message.warning('已通过，但上架失败，请到房源列表手动上架')
          }
        } else {
          Message.success('已通过')
        }
        setDetail(null)
        setActionTarget(null)
        setPublishAfterApprove(false)
        router.refresh()
      } finally {
        setSubmitting(false)
      }
    },
    [dualPermission, publishAfterApprove, callReview, callPublish, router],
  )

  /** 撤回（作者/运营把 pending 退回 not_submitted）。 */
  async function handleWithdraw(row: QueueRow) {
    setSubmitting(true)
    try {
      const ok = await callReview(row, 'withdraw')
      if (ok) {
        Message.success('已撤回')
        setDetail(null)
        router.refresh()
      }
    } finally {
      setSubmitting(false)
    }
  }

  /** 确认驳回（强制原因，服务端 422 兜底）。 */
  async function handleConfirmReject() {
    if (!actionTarget) return
    if (actionReason.trim().length === 0) {
      Message.warning('驳回必须填写原因')
      return
    }
    setSubmitting(true)
    try {
      const ok = await callReview(actionTarget.row, 'reject', actionReason.trim())
      if (ok) {
        Message.success('已驳回')
        setActionTarget(null)
        setActionReason('')
        setDetail(null)
        router.refresh()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const columns = useMemo<ColumnProps<QueueRow>[]>(
    () => [
      { title: '房源', dataIndex: 'title', render: (v: string) => <strong>{v}</strong> },
      { title: '所属楼盘', dataIndex: 'buildingName' },
      {
        title: '租售类型',
        dataIndex: 'listingType',
        render: (v: string) => LISTING_TYPE_LABELS[v] ?? (v || '—'),
      },
      {
        title: '完整度',
        dataIndex: 'completenessScore',
        sorter: (a: QueueRow, b: QueueRow) => a.completenessScore - b.completenessScore,
        render: (v: number, row: QueueRow) => (
          <Tag color={scoreColor(v)}>
            {v}
            {row.missing.length > 0 ? ` · 缺 ${row.missing.length} 项` : ''}
          </Tag>
        ),
      },
      {
        title: '提交时间',
        dataIndex: 'submittedAt',
        sorter: (a: QueueRow, b: QueueRow) =>
          (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''),
        render: (v: string | null) => formatTime(v),
      },
      {
        title: '操作',
        dataIndex: 'op',
        fixed: 'right' as const,
        width: 200,
        render: (_: unknown, row: QueueRow) => (
          <Space>
            <Button size="mini" onClick={() => setDetail(row)}>
              详情
            </Button>
            {canReview && (
              <>
                <Button
                  size="mini"
                  type="primary"
                  status="success"
                  onClick={() => openAction(row, 'approve')}
                >
                  通过
                </Button>
                <Button
                  size="mini"
                  status="danger"
                  onClick={() => openAction(row, 'reject')}
                >
                  驳回
                </Button>
              </>
            )}
          </Space>
        ),
      },
    ],
    [canReview, openAction],
  )

  return (
    <div className="listing-review-queue" style={{ padding: 24 }}>
      <Typography.Title heading={5} style={{ marginTop: 0 }}>
        房源审核台
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        待审核队列，按提交时间先进先审。通过 / 驳回 / 撤回均经服务端强制权限与状态机校验。
        {!canReview && '（当前账号无 listing:review 权限，仅可浏览）'}
      </Typography.Paragraph>

      <Table<QueueRow>
        rowKey="listingId"
        columns={columns}
        data={rows}
        pagination={{ pageSize: 20, sizeCanChange: true }}
        scroll={{ x: 900 }}
        noDataElement="暂无待审核房源"
      />

      {/* 详情抽屉：完整度缺失项定位 + 审核历史时间线 + 动作入口 */}
      <Drawer
        width={560}
        title={detail?.title ?? '房源详情'}
        visible={!!detail}
        onCancel={() => setDetail(null)}
        footer={
          detail && canReview ? (
            <Space>
              <Button onClick={() => handleWithdraw(detail)} loading={submitting}>
                撤回
              </Button>
              <Button status="danger" onClick={() => openAction(detail, 'reject')}>
                驳回
              </Button>
              <Button
                type="primary"
                status="success"
                onClick={() => openAction(detail, 'approve')}
              >
                通过
              </Button>
            </Space>
          ) : null
        }
      >
        {detail && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Descriptions
              column={1}
              size="small"
              data={[
                { label: '所属楼盘', value: detail.buildingName },
                { label: '租售类型', value: LISTING_TYPE_LABELS[detail.listingType] ?? (detail.listingType || '—') },
                { label: 'slug', value: detail.slug || '—' },
                { label: '工作版本', value: `v${detail.version}` },
                {
                  label: '提交完整度',
                  value: (
                    <Tag color={scoreColor(detail.completenessScore)}>
                      {detail.completenessScore}
                    </Tag>
                  ),
                },
                { label: '提交时间', value: formatTime(detail.submittedAt) },
              ]}
            />

            <div>
              <Typography.Title heading={6}>缺失项</Typography.Title>
              {detail.missing.length === 0 ? (
                <Typography.Text type="success">字段完整,无缺失项</Typography.Text>
              ) : (
                <Space direction="vertical" size="mini" style={{ width: '100%' }}>
                  {detail.missing.map((m) => (
                    <div key={m.label}>
                      <Tag color="red">{m.label}</Tag>{' '}
                      <Typography.Text type="secondary">{m.reason}</Typography.Text>
                    </div>
                  ))}
                </Space>
              )}
            </div>

            <div>
              <Typography.Title heading={6}>审核历史</Typography.Title>
              {detail.history.length === 0 ? (
                <Typography.Text type="secondary">暂无审核记录</Typography.Text>
              ) : (
                <Timeline>
                  {detail.history.map((h) => (
                    <Timeline.Item key={h.id}>
                      <Space>
                        <strong>{h.decision ? DECISION_LABELS[h.decision] ?? h.decision : '—'}</strong>
                        {h.taskStatus && (
                          <Tag size="small">{TASK_STATUS_LABELS[h.taskStatus] ?? h.taskStatus}</Tag>
                        )}
                      </Space>
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {formatTime(h.createdAt)}
                          {h.actorName ? ` · ${h.actorName}` : ''}
                        </Typography.Text>
                      </div>
                      {h.reason && (
                        <div>
                          <Typography.Text>原因：{h.reason}</Typography.Text>
                        </div>
                      )}
                    </Timeline.Item>
                  ))}
                </Timeline>
              )}
            </div>
          </Space>
        )}
      </Drawer>

      {/* 动作抽屉：通过（可选上架）/ 驳回（强制原因）的确认与执行 */}
      <Drawer
        width={480}
        title={actionTarget?.type === 'approve' ? '确认通过' : '驳回房源'}
        visible={!!actionTarget}
        onCancel={() => setActionTarget(null)}
        footer={
          actionTarget ? (
            <Space>
              <Button onClick={() => setActionTarget(null)}>取消</Button>
              {actionTarget.type === 'approve' ? (
                <Button
                  type="primary"
                  status="success"
                  loading={submitting}
                  onClick={() => handleApprove(actionTarget.row)}
                >
                  确认通过
                </Button>
              ) : (
                <Button
                  status="danger"
                  loading={submitting}
                  disabled={actionReason.trim().length === 0}
                  onClick={handleConfirmReject}
                >
                  确认驳回
                </Button>
              )}
            </Space>
          ) : null
        }
      >
        {actionTarget && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Descriptions
              column={1}
              size="small"
              data={[
                { label: '房源', value: <strong>{actionTarget.row.title}</strong> },
                { label: '所属楼盘', value: actionTarget.row.buildingName },
                {
                  label: '租售类型',
                  value:
                    LISTING_TYPE_LABELS[actionTarget.row.listingType] ??
                    (actionTarget.row.listingType || '—'),
                },
                { label: '工作版本', value: `v${actionTarget.row.version}` },
                {
                  label: '提交完整度',
                  value: (
                    <Tag color={scoreColor(actionTarget.row.completenessScore)}>
                      {actionTarget.row.completenessScore}
                      {actionTarget.row.missing.length > 0
                        ? ` · 缺 ${actionTarget.row.missing.length} 项`
                        : ''}
                    </Tag>
                  ),
                },
              ]}
            />

            {actionTarget.type === 'approve' ? (
              <>
                {actionTarget.row.missing.length > 0 && (
                  <div>
                    <Typography.Text type="warning">
                      仍有 {actionTarget.row.missing.length} 项缺失（通过后可继续补全）：
                    </Typography.Text>
                    <div style={{ marginTop: 4 }}>
                      {actionTarget.row.missing.slice(0, 5).map((m) => (
                        <Tag key={m.label} color="orange" style={{ marginBottom: 4 }}>
                          {m.label}
                        </Tag>
                      ))}
                      {actionTarget.row.missing.length > 5 && (
                        <Tag color="orange">+{actionTarget.row.missing.length - 5}</Tag>
                      )}
                    </div>
                  </div>
                )}
                {dualPermission && (
                  <div>
                    <Checkbox
                      checked={publishAfterApprove}
                      onChange={(checked) => setPublishAfterApprove(!!checked)}
                    >
                      通过后立即上架
                    </Checkbox>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ fontSize: 12, marginBottom: 0, marginTop: 4 }}
                    >
                      勾选后审核通过与发布上架一步完成；上架失败时需到房源列表手动上架。
                    </Typography.Paragraph>
                  </div>
                )}
              </>
            ) : (
              <>
                <Typography.Paragraph>
                  驳回后房源退回「未提交」状态，原因将写入审核历史（必填）。
                </Typography.Paragraph>
                <Input.TextArea
                  value={actionReason}
                  onChange={setActionReason}
                  placeholder="例如:图片不足 3 张 / 价格信息缺失 / 联系人无效……"
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  maxLength={500}
                  showWordLimit
                />
              </>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  )
}
