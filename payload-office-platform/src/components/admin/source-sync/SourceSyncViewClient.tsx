'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Alert, Button, Modal, Progress, Space, Table, Tag, Typography } from '@arco-design/web-react'
import type { ColumnProps } from '@arco-design/web-react/es/Table'
import { IconRefresh, IconUpload } from '@arco-design/web-react/icon'

const { Title, Paragraph, Text } = Typography

type Kind = 'buildings' | 'listings' | 'retire'
type Status = 'queued' | 'running' | 'completed' | 'failed'

type Batch = {
  id: number
  fileName: string | null
  kind: Kind
  status: Status
  rowCount: number | null
  cursor: number | null
  stats: Partial<
    Record<'created' | 'updated' | 'unchanged' | 'retired' | 'skipped' | 'failed' | 'imagesCreated', number>
  > | null
  affected: { updatedPublishedListings?: unknown[]; retiredListings?: unknown[] } | null
  writeErrors: { row: number; externalId: string; message: string }[] | null
  rolledBackAt: string | null
  createdAt: string
}

type UploadLog = { name: string; state: 'waiting' | 'uploading' | 'ok' | 'error'; message?: string }

const KIND_LABEL: Record<Kind, string> = { buildings: '楼盘', listings: '房源', retire: '下架旧房源' }
const STATUS_TAG: Record<Status, { color: string; label: string }> = {
  queued: { color: 'gray', label: '排队中' },
  running: { color: 'arcoblue', label: '写入中' },
  completed: { color: 'green', label: '已完成' },
  failed: { color: 'red', label: '失败' },
}
const POLL_MS = 5000
/** 楼盘包还没写完时房源包会被 409 拒收，隔一会儿再试 */
const PENDING_RETRY_MS = 15000

/** 同步包文件名形如 `0001-b.ndjson.gz` / `0042-l…` / `0063-r…`；楼盘 → 房源 → 下架 依次上传 */
const kindOrder = (name: string) => (/-b\./.test(name) ? 0 : /-l\./.test(name) ? 1 : 2)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function SourceSyncViewClient() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<UploadLog[]>([])
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(false)

  const load = useCallback(async () => {
    try {
      // rows 是整包数据（可达 1MB），列表里用不到，不让 REST 拉回来
      const res = await fetch(
        '/api/source-sync-batches?limit=200&sort=-createdAt&depth=0&select[rows]=false&select[affected]=true',
        { credentials: 'include' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { docs?: Batch[] }
      setBatches(json.docs ?? [])
      setLoadError(null)
    } catch (e) {
      setLoadError(`批次列表加载失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  useEffect(() => {
    // 首轮也走定时器回调：effect 体内不直接触发 setState（react-hooks/set-state-in-effect）
    const first = setTimeout(() => void load(), 0)
    const timer = setInterval(() => void load(), POLL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [load])

  useEffect(
    () => () => {
      cancelRef.current = true
    },
    [],
  )

  const setLog = (name: string, patch: Partial<UploadLog>) =>
    setUploads((prev) => prev.map((u) => (u.name === name ? { ...u, ...patch } : u)))

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].sort(
      (a, b) => kindOrder(a.name) - kindOrder(b.name) || a.name.localeCompare(b.name),
    )
    event.target.value = ''
    if (!files.length) return
    setUploads(files.map((f) => ({ name: f.name, state: 'waiting' })))
    setUploading(true)
    setNotice(null)
    for (const file of files) {
      if (cancelRef.current) break
      setLog(file.name, { state: 'uploading', message: undefined })
      for (;;) {
        const body = new FormData()
        body.append('file', file)
        const res = await fetch('/api/source-sync/upload', { method: 'POST', body, credentials: 'include' })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          code?: string
          error?: string
          errors?: string[]
          rowCount?: number
        }
        if (res.status === 409 && json.code === 'BUILDINGS_PENDING') {
          setLog(file.name, { message: json.error ?? '等待楼盘包写完…' })
          await sleep(PENDING_RETRY_MS)
          if (cancelRef.current) break
          continue
        }
        if (res.ok && json.ok) setLog(file.name, { state: 'ok', message: `${json.rowCount ?? 0} 行，已入队` })
        else
          setLog(file.name, {
            state: 'error',
            message: json.error ?? json.errors?.slice(0, 3).join('；') ?? `HTTP ${res.status}`,
          })
        break
      }
      void load()
    }
    setUploading(false)
  }

  const revalidate = async () => {
    const res = await fetch('/api/source-sync/revalidate', { method: 'POST', credentials: 'include' })
    setNotice(res.ok ? '已按城市刷新前台缓存' : `刷新失败：HTTP ${res.status}`)
  }

  const rollback = (batch: Batch) => {
    Modal.confirm({
      title: `回滚「${batch.fileName ?? batch.id}」？`,
      content:
        '会把本批被下架的旧房源恢复上架、把被覆盖字段的已上架房源还原成写入前的值。新建的楼盘和房源都是草稿，不做改动。',
      onOk: async () => {
        const res = await fetch(`/api/source-sync/batches/${batch.id}/rollback`, {
          method: 'POST',
          credentials: 'include',
        })
        const json = (await res.json().catch(() => ({}))) as {
          restored?: number
          republished?: number
          failures?: string[]
          error?: string
        }
        setNotice(
          res.ok
            ? `已回滚：还原 ${json.restored ?? 0} 条、恢复上架 ${json.republished ?? 0} 条${json.failures?.length ? `，${json.failures.length} 条失败` : ''}`
            : `回滚失败：${json.error ?? `HTTP ${res.status}`}`,
        )
        void load()
      },
    })
  }

  const totals = batches.reduce(
    (acc, b) => {
      acc.rows += b.rowCount ?? 0
      acc.done += b.cursor ?? 0
      return acc
    },
    { rows: 0, done: 0 },
  )
  const active = batches.some((b) => b.status === 'queued' || b.status === 'running')

  const columns: ColumnProps<Batch>[] = [
    { title: '文件', dataIndex: 'fileName', width: 180 },
    { title: '内容', dataIndex: 'kind', width: 100, render: (k: Kind) => KIND_LABEL[k] },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: Status) => <Tag color={STATUS_TAG[s].color}>{STATUS_TAG[s].label}</Tag>,
    },
    {
      title: '进度',
      width: 150,
      render: (_: unknown, b) => (
        <Progress size="small" percent={b.rowCount ? Math.round(((b.cursor ?? 0) / b.rowCount) * 100) : 0} />
      ),
    },
    {
      title: '新建 / 更新 / 无变化',
      width: 150,
      render: (_: unknown, b) => `${b.stats?.created ?? 0} / ${b.stats?.updated ?? 0} / ${b.stats?.unchanged ?? 0}`,
    },
    { title: '下架', width: 70, render: (_: unknown, b) => b.stats?.retired ?? 0 },
    { title: '跳过', width: 70, render: (_: unknown, b) => b.stats?.skipped ?? 0 },
    {
      title: '失败',
      width: 70,
      render: (_: unknown, b) => (b.stats?.failed ? <Text type="error">{b.stats.failed}</Text> : 0),
    },
    { title: '图片', width: 70, render: (_: unknown, b) => b.stats?.imagesCreated ?? 0 },
    {
      title: '操作',
      width: 110,
      render: (_: unknown, b) => {
        const hasVisibleChanges =
          (b.affected?.updatedPublishedListings?.length ?? 0) + (b.affected?.retiredListings?.length ?? 0) > 0
        if (b.rolledBackAt) return <Text type="secondary">已回滚</Text>
        if ((b.status === 'completed' || b.status === 'failed') && hasVisibleChanges) {
          return (
            <Button size="mini" status="warning" onClick={() => rollback(b)}>
              回滚
            </Button>
          )
        }
        return null
      },
    },
  ]

  return (
    <div style={{ padding: 24, maxWidth: 1240 }}>
      <Title heading={5} style={{ marginBottom: 4 }}>
        外部数据同步
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        上传本地生成的汇租选址同步包（<Text code>.ndjson.gz</Text>，每包不超过 1,000 行）。新建的楼盘和房源一律是草稿，
        前台不可见；已有房源按采集值更新，已有楼盘只补空字段。可以一次选中全部文件上传，上传完即可关闭本页——
        写入在服务器后台进行，房源包会自动排在楼盘包写完之后；楼盘要拉图，全部写完可能需要数小时。
      </Paragraph>

      <Space size="medium" style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<IconUpload />} loading={uploading} onClick={() => inputRef.current?.click()}>
          选择同步包
        </Button>
        <Button icon={<IconRefresh />} disabled={active} onClick={() => void revalidate()}>
          刷新前台缓存
        </Button>
        <Text type="secondary">
          总进度 {totals.done.toLocaleString()} / {totals.rows.toLocaleString()} 行
        </Text>
      </Space>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".gz,.ndjson"
        style={{ display: 'none' }}
        onChange={(e) => void onFiles(e)}
      />

      {notice && (
        <Alert type="info" content={notice} style={{ marginBottom: 16 }} closable onClose={() => setNotice(null)} />
      )}
      {loadError && <Alert type="error" content={loadError} style={{ marginBottom: 16 }} />}

      {uploads.length > 0 && (
        <Table
          size="small"
          style={{ marginBottom: 24 }}
          pagination={uploads.length > 10 ? { pageSize: 10 } : false}
          rowKey="name"
          data={uploads}
          columns={[
            { title: '上传文件', dataIndex: 'name', width: 220 },
            {
              title: '结果',
              dataIndex: 'state',
              width: 90,
              render: (s: UploadLog['state']) =>
                ({ waiting: '等待', uploading: '上传中', ok: '已入队', error: '失败' })[s],
            },
            { title: '说明', dataIndex: 'message' },
          ]}
        />
      )}

      <Table
        size="small"
        rowKey="id"
        data={batches}
        columns={columns}
        pagination={{ pageSize: 50 }}
        expandedRowRender={(b) =>
          b.writeErrors?.length ? (
            <div style={{ maxHeight: 240, overflow: 'auto' }}>
              {b.writeErrors.slice(0, 100).map((e, i) => (
                <div key={i}>
                  <Text type="secondary">
                    第 {e.row} 行{e.externalId ? `（${e.externalId}）` : ''}：
                  </Text>
                  {e.message}
                </div>
              ))}
            </div>
          ) : (
            <Text type="secondary">没有写入错误</Text>
          )
        }
      />
    </div>
  )
}
