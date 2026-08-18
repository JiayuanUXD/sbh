'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Descriptions,
  Drawer,
  Message,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from '@arco-design/web-react'
import type { ColumnProps } from '@arco-design/web-react/es/Table'

import type { AuditLog } from '@/payload-types'

/**
 * 审计日志列表 - 客户端（后台表单优化 · 抽屉交互第一批）
 *
 * 审计日志是全后台字段最多的只读详情页（23 字段、append-only、不可编辑），
 * 原默认列表点进整页编辑视图再返回，滚动成本高。改为：
 *   - 列表：服务端分页 + 动作/结果筛选（URL searchParams 驱动）
 *   - 详情：抽屉内按语义分组展示全部字段，看完即关，不丢列表上下文
 *
 * 详情数据按需经 REST GET /api/audit-logs/:id 获取：
 *   - before/after 脱敏由服务端 afterRead hook 按当前用户 audit:before_after
 *     权限执行（客户端不复制任何权限规则）
 *   - 单条读取会触发 audit.view_detail 审计（符合「查看详情本身也被审计」设计）
 */

/** 列表行（服务端已裁剪，不含 before/after 等大字段）。 */
export interface AuditLogRow {
  id: number
  auditId: string
  action: string
  result: 'success' | 'failed'
  objectCollection: string
  objectId: string
  subjectUserId: string | null
  requestId: string | null
  occurredAt: string
}

interface Props {
  rows: AuditLogRow[]
  page: number
  pageSize: number
  totalDocs: number
  totalPages: number
  actionOptions: Array<{ value: string; label: string }>
  resultOptions: Array<{ value: string; label: string }>
  activeAction: string | null
  activeResult: string | null
  canViewBeforeAfter: boolean
}

/** 时间戳格式化为北京时间可读串。 */
function formatTime(iso: string | null | undefined): string {
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
    second: '2-digit',
  })
}

/** 详情分组小节。 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Typography.Title heading={6} style={{ marginTop: 0 }}>
        {title}
      </Typography.Title>
      {children}
    </div>
  )
}

/** JSON 值渲染（样式类定义在 custom.scss，含深色模式）。 */
function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <Typography.Text type="secondary">—</Typography.Text>
  }
  const text =
    typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2)
  return <pre className="audit-log-detail__json">{text}</pre>
}

/** changedFields 归一为可读串（数组 → 路径列表；其他 → JSON）。 */
function changedFieldsText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(' · ')
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export default function AuditLogListClient({
  rows,
  page,
  pageSize,
  totalDocs,
  totalPages,
  actionOptions,
  resultOptions,
  activeAction,
  activeResult,
  canViewBeforeAfter,
}: Props) {
  const router = useRouter()

  // —— 筛选 / 分页（URL 驱动，服务端过滤） ——
  const actionLabelMap = useMemo(
    () => new Map(actionOptions.map((o) => [o.value, o.label])),
    [actionOptions],
  )
  const resultLabelMap = useMemo(
    () => new Map(resultOptions.map((o) => [o.value, o.label])),
    [resultOptions],
  )

  // —— 详情抽屉（按需拉取单条，脱敏与审计在服务端） ——
  const [detailRow, setDetailRow] = useState<AuditLogRow | null>(null)
  const [detail, setDetail] = useState<AuditLog | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const navigate = useCallback(
    (nextPage: number, action: string | null, result: string | null) => {
      // 列表刷新（筛选/翻页）时关闭残留抽屉，避免展示过期数据
      setDetailRow(null)
      setDetail(null)
      const qs = new URLSearchParams()
      if (nextPage > 1) qs.set('page', String(nextPage))
      if (action) qs.set('action', action)
      if (result) qs.set('result', result)
      const query = qs.toString()
      router.push(
        query ? `/admin/collections/audit-logs?${query}` : '/admin/collections/audit-logs',
      )
    },
    [router],
  )

  const openDetail = useCallback(async (row: AuditLogRow) => {
    setDetailRow(row)
    setDetail(null)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/audit-logs/${row.id}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setDetail((await res.json()) as AuditLog)
    } catch {
      Message.error('加载审计详情失败')
      setDetailRow(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const columns = useMemo<ColumnProps<AuditLogRow>[]>(
    () => [
      {
        title: '发生时间',
        dataIndex: 'occurredAt',
        width: 170,
        render: (v: string) => (
          <Typography.Text style={{ fontSize: 13 }}>{formatTime(v)}</Typography.Text>
        ),
      },
      {
        title: '动作',
        dataIndex: 'action',
        width: 180,
        render: (v: string) => actionLabelMap.get(v) ?? v,
      },
      {
        title: '结果',
        dataIndex: 'result',
        width: 90,
        render: (v: AuditLogRow['result']) => (
          <Tag color={v === 'success' ? 'green' : 'red'} size="small">
            {resultLabelMap.get(v) ?? v}
          </Tag>
        ),
      },
      {
        title: '对象',
        dataIndex: 'objectCollection',
        render: (_: unknown, row: AuditLogRow) => (
          <span>
            <Typography.Text style={{ fontSize: 13 }}>{row.objectCollection}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {' '}
              / {row.objectId}
            </Typography.Text>
          </span>
        ),
      },
      {
        title: '操作人',
        dataIndex: 'subjectUserId',
        width: 110,
        render: (v: string | null) => v ?? '系统',
      },
      {
        title: '请求 ID',
        dataIndex: 'requestId',
        width: 130,
        ellipsis: true,
        render: (v: string | null) => (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {v ?? '—'}
          </Typography.Text>
        ),
      },
      {
        title: '操作',
        dataIndex: 'op',
        fixed: 'right' as const,
        width: 80,
        render: (_: unknown, row: AuditLogRow) => (
          <Button size="mini" onClick={() => openDetail(row)}>
            详情
          </Button>
        ),
      },
    ],
    [actionLabelMap, resultLabelMap, openDetail],
  )

  const d = detail

  return (
    <div className="audit-log-list" style={{ padding: 24 }}>
      <Typography.Title heading={5} style={{ marginTop: 0 }}>
        审计日志
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        追加式高风险操作审计，按发生时间倒序。共 {totalDocs} 条。查看详情本身也会被审计。
      </Typography.Paragraph>

      <Space size="medium" style={{ marginBottom: 12 }}>
        <Select
          placeholder="按动作筛选"
          style={{ width: 220 }}
          allowClear
          showSearch
          value={activeAction ?? undefined}
          options={actionOptions}
          onChange={(v) => navigate(1, (v as string | undefined) ?? null, activeResult)}
        />
        <Select
          placeholder="按结果筛选"
          style={{ width: 140 }}
          allowClear
          value={activeResult ?? undefined}
          options={resultOptions}
          onChange={(v) => navigate(1, activeAction, (v as string | undefined) ?? null)}
        />
      </Space>

      <Table<AuditLogRow>
        rowKey="id"
        columns={columns}
        data={rows}
        onRow={(row) => ({ onClick: () => openDetail(row), style: { cursor: 'pointer' } })}
        pagination={{
          current: page,
          pageSize,
          total: totalDocs,
          hideOnSinglePage: false,
          onChange: (nextPage) => navigate(nextPage, activeAction, activeResult),
        }}
        noDataElement="暂无审计日志"
      />

      {/* 详情抽屉：全部字段按语义分组，只读展示 */}
      <Drawer
        width={640}
        title={detailRow ? `审计详情 · ${actionLabelMap.get(detailRow.action) ?? detailRow.action}` : '审计详情'}
        visible={!!detailRow}
        onCancel={() => setDetailRow(null)}
        unmountOnExit
        footer={
          <Button onClick={() => setDetailRow(null)}>关闭</Button>
        }
      >
        {detailLoading && <Spin style={{ display: 'block', margin: '48px auto' }} />}
        {d && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Section title="核心信息">
              <Descriptions
                column={1}
                size="small"
                data={[
                  { label: '审计 ID', value: d.auditId },
                  { label: '动作', value: actionLabelMap.get(d.action) ?? d.action },
                  {
                    label: '结果',
                    value: (
                      <Tag color={d.result === 'success' ? 'green' : 'red'} size="small">
                        {resultLabelMap.get(d.result) ?? d.result}
                      </Tag>
                    ),
                  },
                  { label: '发生时间', value: formatTime(d.occurredAt) },
                  { label: '对象集合', value: d.objectCollection },
                  { label: '对象 ID', value: d.objectId },
                  { label: '对象版本', value: `v${d.objectVersion}` },
                  { label: '关联事件', value: d.eventId ?? '—' },
                ]}
              />
            </Section>

            <Section title="变更内容">
              <Descriptions
                column={1}
                size="small"
                data={[
                  {
                    label: '变更字段',
                    value:
                      d.changedFields == null ? (
                        <Typography.Text type="secondary">—</Typography.Text>
                      ) : (
                        changedFieldsText(d.changedFields)
                      ),
                  },
                ]}
              />
              <div style={{ marginTop: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  变更前（before）
                </Typography.Text>
                {d.before == null ? (
                  <div>
                    <Typography.Text type="secondary">
                      —{canViewBeforeAfter ? '（无值）' : '（需 audit:before_after 权限）'}
                    </Typography.Text>
                  </div>
                ) : (
                  <JsonBlock value={d.before} />
                )}
              </div>
              <div style={{ marginTop: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  变更后（after）
                </Typography.Text>
                {d.after == null ? (
                  <div>
                    <Typography.Text type="secondary">
                      —{canViewBeforeAfter ? '（无值）' : '（需 audit:before_after 权限）'}
                    </Typography.Text>
                  </div>
                ) : (
                  <JsonBlock value={d.after} />
                )}
              </div>
            </Section>

            <Section title="操作人快照">
              <Descriptions
                column={1}
                size="small"
                data={[
                  { label: '操作人 ID', value: d.subjectUserId ?? '系统动作' },
                  { label: '操作人团队', value: d.subjectTeamId ?? '—' },
                  {
                    label: '操作人角色',
                    value:
                      d.subjectRoleCodes == null ? (
                        <Typography.Text type="secondary">—</Typography.Text>
                      ) : (
                        changedFieldsText(d.subjectRoleCodes)
                      ),
                  },
                ]}
              />
              {d.subjectCityScope != null && (
                <div style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    城市范围快照
                  </Typography.Text>
                  <JsonBlock value={d.subjectCityScope} />
                </div>
              )}
            </Section>

            <Section title="请求上下文">
              <Descriptions
                column={1}
                size="small"
                data={[
                  { label: '请求 ID', value: d.requestId ?? '—' },
                  { label: 'HTTP 方法', value: d.method ?? '—' },
                  { label: '请求路径', value: d.path ?? '—' },
                  { label: '客户端 IP', value: d.ip ?? '—' },
                  { label: 'User-Agent', value: d.userAgent ?? '—' },
                ]}
              />
            </Section>

            {(d.result === 'failed' || d.errorCode != null || d.errorMessage != null) && (
              <Section title="错误详情">
                <Descriptions
                  column={1}
                  size="small"
                  data={[
                    { label: '错误码', value: d.errorCode ?? '—' },
                    { label: '错误信息', value: d.errorMessage ?? '—' },
                  ]}
                />
              </Section>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  )
}
