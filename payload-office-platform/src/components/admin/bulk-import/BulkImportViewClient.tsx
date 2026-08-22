'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, RefObject } from 'react'
import {
  Alert,
  Button,
  Card,
  Modal,
  Progress,
  Space,
  Statistic,
  Table,
  Typography,
} from '@arco-design/web-react'
import type { ColumnProps } from '@arco-design/web-react/es/Table'
import { IconDownload, IconUpload } from '@arco-design/web-react/icon'

import { isSupplyImportPollTimedOut } from '@/domain/supply-import/poll-timeout'
import type { RowError } from '@/domain/supply-import/types'

const { Title, Text, Paragraph } = Typography

type ImportMode = 'buildings' | 'listings'

/** 预检响应形状（Task 6 `bulk-import-endpoint.ts` 定稿，接线前已去源码核对）。 */
type PreflightReport = {
  rowCount: number
  validCount: number
  errorCount: number
  rowErrors: RowError[]
}

/** 轮询响应里的批次形状（`GET /bulk-import/batches/:id`，字段集是 Task 6 自定的）。 */
type BatchStatus = {
  id: number
  type: ImportMode
  status: 'preflight' | 'queued' | 'running' | 'completed' | 'failed'
  fileName: string | null
  rowCount: number
  validCount: number
  errorCount: number
  stats: { processed: number; created: number; updated: number; failed: number } | null
  startedAt: string | null
  finishedAt: string | null
}

/**
 * 状态机：idle → report → running → done，running 可能因超时改道 interrupted
 * （最终评审 Important 7）。状态之间不能跳跃（规格硬性要求）。
 */
type Phase = 'idle' | 'report' | 'running' | 'done' | 'interrupted'

const MODE_LABEL: Record<ImportMode, string> = { buildings: '楼盘', listings: '房源' }
/** 回滚确认/结果文案里的单位——与 ReportPanel 既有的「N 套房源 / N 个楼盘」口径保持一致。 */
const MODE_UNIT: Record<ImportMode, string> = { buildings: '个', listings: '套' }

const ERROR_COLUMNS: ColumnProps<RowError>[] = [
  { title: '行号', dataIndex: 'rowNumber', width: 80 },
  { title: '列', dataIndex: 'column', width: 140 },
  { title: '原始值', dataIndex: 'rawValue', width: 160, ellipsis: true },
  { title: '错误信息', dataIndex: 'message', ellipsis: true },
  { title: '修改建议', dataIndex: 'suggestion', ellipsis: true, render: (v: string | undefined) => v ?? '—' },
]

/** 触发浏览器下载：服务端已带 `Content-Disposition: attachment`，同源导航即可，不必手动拼 blob。 */
function triggerDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function readJson(res: Response): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  try {
    return await res.json()
  } catch {
    return { ok: false, error: `请求失败（HTTP ${res.status}）` }
  }
}

export default function BulkImportViewClient({ mode }: { mode: ImportMode }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<number | null>(null)
  const [report, setReport] = useState<PreflightReport | null>(null)
  const [executing, setExecuting] = useState(false)
  const [batch, setBatch] = useState<BatchStatus | null>(null)
  const [rollingBack, setRollingBack] = useState(false)
  const [rollbackError, setRollbackError] = useState<string | null>(null)
  const [rollbackResult, setRollbackResult] = useState<{
    unpublished: number
    skipped: number
    failed: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const label = MODE_LABEL[mode]

  const resetToIdle = useCallback(() => {
    setPhase('idle')
    setUploading(false)
    setUploadError(null)
    setBatchId(null)
    setReport(null)
    setExecuting(false)
    setBatch(null)
    setRollingBack(false)
    setRollbackError(null)
    setRollbackResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const runPreflight = useCallback(
    async (file: File) => {
      setUploading(true)
      setUploadError(null)
      try {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(`/api/bulk-import/preflight?type=${mode}`, {
          method: 'POST',
          body: form,
        })
        const data = await readJson(res)
        if (!res.ok || !data.ok) {
          setUploadError((data.error as string | undefined) ?? '预检失败，请检查文件格式后重试')
          return
        }
        setBatchId(data.batchId as number)
        setReport(data.report as PreflightReport)
        setPhase('report')
      } catch {
        setUploadError('预检请求失败，请检查网络后重试')
      } finally {
        setUploading(false)
      }
    },
    [mode],
  )

  const confirmImport = useCallback(async () => {
    if (batchId === null) return
    setExecuting(true)
    try {
      const res = await fetch(`/api/bulk-import/batches/${batchId}/execute`, { method: 'POST' })
      const data = await readJson(res)
      if (!res.ok || !data.ok) {
        setUploadError((data.error as string | undefined) ?? '执行失败，请重试')
        return
      }
      // report 态必须经这一步确认才能进入 running——不允许绕过 execute 直接轮询。
      setPhase('running')
    } catch {
      setUploadError('执行请求失败，请检查网络后重试')
    } finally {
      setExecuting(false)
    }
  }, [batchId])

  // Task 9：按批次回滚——下架而非删除，前台立即不可见。成功后就地显示
  // 「已下架 N 套」，不重置到 idle（运营可能还要核对本批的其它信息）。
  const rollbackBatch = useCallback(async () => {
    if (batchId === null) return
    setRollingBack(true)
    setRollbackError(null)
    try {
      const res = await fetch(`/api/bulk-import/batches/${batchId}/rollback`, { method: 'POST' })
      const data = await readJson(res)
      if (!res.ok || !data.ok) {
        setRollbackError((data.error as string | undefined) ?? '回滚失败，请重试')
        return
      }
      setRollbackResult({
        unpublished: data.unpublished as number,
        skipped: data.skipped as number,
        failed: (data.failed as number | undefined) ?? 0,
      })
    } catch {
      setRollbackError('回滚请求失败，请检查网络后重试')
    } finally {
      setRollingBack(false)
    }
  }, [batchId])

  // running 态：每 2 秒轮询批次状态；completed/failed 才进 done，不用百分比推断完成
  // （结构守卫失败的行只加 stats.failed、不进 processed，是 Task 7 的已知 Minor，
  // 这里不为它写任何 workaround——进度条到不了 100% 是预期行为）。
  //
  // 最终评审 Important 7：此前是无界轮询——Job 崩溃/实例回收后批次停在 running
  // （`recoverStaleSupplyImportJobs` 释放的是 job 租约，不改批次 status），这里会
  // 永远显示进度条，DonePanel（回滚按钮所在地）不出现，恰好在最需要回滚的失败态
  // 下回滚不可达。超时判定委托给纯函数 isSupplyImportPollTimedOut（domain 层单测
  // 覆盖，本文件不重复写判定逻辑）；超时则转 interrupted，显示已处理计数并让
  // 回滚按钮可用（复用 rollbackBatch，回滚不看批次 status，只看 affectedIds，
  // 中途中断也能回滚已经写入的部分）。
  useEffect(() => {
    if (phase !== 'running' || batchId === null) return
    let cancelled = false
    const startedAt = Date.now()

    const poll = async () => {
      try {
        const res = await fetch(`/api/bulk-import/batches/${batchId}`)
        const data = await readJson(res)
        if (cancelled || !res.ok || !data.ok) return
        const next = data.batch as BatchStatus
        setBatch(next)
        if (next.status === 'completed' || next.status === 'failed') {
          setPhase('done')
          return
        }
        if (isSupplyImportPollTimedOut(next.status, Date.now() - startedAt)) {
          setPhase('interrupted')
        }
      } catch {
        // 轮询瞬时失败不打断状态机，下一轮再试
      }
    }

    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [phase, batchId])

  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (file) void runPreflight(file)
    },
    [runPreflight],
  )

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <Title heading={5} style={{ marginBottom: 4 }}>
        {label}批量导入
      </Title>

      {phase === 'idle' && (
        <IdlePanel
          mode={mode}
          label={label}
          uploading={uploading}
          uploadError={uploadError}
          fileInputRef={fileInputRef}
          onFileChange={handleFileChange}
        />
      )}

      {phase === 'report' && report && batchId !== null && (
        <ReportPanel
          mode={mode}
          label={label}
          batchId={batchId}
          report={report}
          executing={executing}
          uploadError={uploadError}
          onCancel={resetToIdle}
          onConfirm={confirmImport}
        />
      )}

      {phase === 'running' && <RunningPanel batch={batch} />}

      {phase === 'done' && batch && (
        <DonePanel
          batch={batch}
          onRestart={resetToIdle}
          onRollback={rollbackBatch}
          rollingBack={rollingBack}
          rollbackError={rollbackError}
          rollbackResult={rollbackResult}
        />
      )}

      {phase === 'interrupted' && batch && (
        <InterruptedPanel
          batch={batch}
          onRestart={resetToIdle}
          onRollback={rollbackBatch}
          rollingBack={rollingBack}
          rollbackError={rollbackError}
          rollbackResult={rollbackResult}
        />
      )}
    </div>
  )
}

function IdlePanel({
  mode,
  label,
  uploading,
  uploadError,
  fileInputRef,
  onFileChange,
}: {
  mode: ImportMode
  label: string
  uploading: boolean
  uploadError: string | null
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <Card>
      <Paragraph type="secondary">
        上传符合模板格式的 Excel 表，系统会先做预检（不写入任何{label}数据），
        校验通过后需要你手动确认才会真正导入。
        {mode === 'listings' && '房源需要按外部编号关联到已存在的楼盘，建议先下载「楼盘对照表」核对楼盘编号。'}
      </Paragraph>

      <Space size="medium" style={{ marginBottom: 20 }}>
        <Button icon={<IconDownload />} onClick={() => triggerDownload(`/api/bulk-import/template?type=${mode}`)}>
          下载{label}导入模板
        </Button>
        {mode === 'listings' && (
          <Button icon={<IconDownload />} onClick={() => triggerDownload('/api/bulk-import/building-reference')}>
            下载楼盘对照表
          </Button>
        )}
      </Space>

      {uploadError && (
        <Alert type="error" content={uploadError} style={{ marginBottom: 16 }} closable onClose={() => {}} />
      )}

      <div>
        <Button
          type="primary"
          icon={<IconUpload />}
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          选择文件并开始预检
        </Button>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onFileChange}
        />
      </div>
    </Card>
  )
}

function ReportPanel({
  mode,
  label,
  batchId,
  report,
  executing,
  uploadError,
  onCancel,
  onConfirm,
}: {
  mode: ImportMode
  label: string
  batchId: number
  report: PreflightReport
  executing: boolean
  uploadError: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const { rowCount, validCount, errorCount, rowErrors } = report
  const truncated = errorCount > rowErrors.length

  // 规格 §3 硬性要求：房源/楼盘两套文案不可互换、不可改写。
  const warningText =
    mode === 'listings'
      ? `确认后 ${validCount} 套房源将立即对外可见，请确认数据无误。`
      : `确认后 ${validCount} 个楼盘将立即启用。`

  return (
    <Card>
      <Space size="large" style={{ marginBottom: 16 }}>
        <Statistic title="总行数" value={rowCount} />
        <Statistic title="校验通过" value={validCount} />
        <Statistic title="校验失败" value={errorCount} />
      </Space>

      <Alert type="error" content={warningText} style={{ marginBottom: 16 }} />

      {uploadError && <Alert type="error" content={uploadError} style={{ marginBottom: 16 }} />}

      {rowErrors.length > 0 && (
        <>
          <Text bold style={{ display: 'block', marginBottom: 8 }}>
            错误明细
          </Text>
          <Table
            rowKey={(row) => `${row.rowNumber}-${row.column}`}
            columns={ERROR_COLUMNS}
            data={rowErrors}
            pagination={false}
            size="small"
            scroll={{ y: 320 }}
            style={{ marginBottom: 8 }}
          />
          {truncated && (
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              仅显示前 {rowErrors.length} 条，完整清单请下载错误表
            </Text>
          )}
          <div style={{ marginBottom: 16 }}>
            <Button
              icon={<IconDownload />}
              onClick={() => triggerDownload(`/api/bulk-import/batches/${batchId}/errors`)}
            >
              下载完整错误表
            </Button>
          </div>
        </>
      )}

      <Space>
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" status="danger" loading={executing} disabled={validCount <= 0} onClick={onConfirm}>
          确认导入
        </Button>
      </Space>
      {validCount <= 0 && (
        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          没有校验通过的{label}行，无法执行导入，请修正后重新上传。
        </Text>
      )}
    </Card>
  )
}

function RunningPanel({ batch }: { batch: BatchStatus | null }) {
  const processed = batch?.stats?.processed ?? 0
  const total = batch?.rowCount ?? 0
  // 展示用百分比，可能因结构守卫失败行不计入 processed 而到不了 100%——这是已知行为，
  // 完成判定只看下面 useEffect 里的 status 字段，不看这个百分比。
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0

  return (
    <Card>
      <Text style={{ display: 'block', marginBottom: 8 }}>
        已处理 {processed}/{total}
      </Text>
      <Progress percent={percent} status="normal" style={{ marginBottom: 16 }} />
      <Space size="large">
        <Statistic title="新建" value={batch?.stats?.created ?? 0} />
        <Statistic title="更新" value={batch?.stats?.updated ?? 0} />
        <Statistic title="失败" value={batch?.stats?.failed ?? 0} />
      </Space>
    </Card>
  )
}

/**
 * 回滚控制区：DonePanel 与 InterruptedPanel（最终评审 Important 7）共用同一套
 * 确认弹窗 + 结果展示 + 按钮态逻辑，不重复一份。回滚 endpoint 本身不看批次
 * status（只看 affectedIds），interrupted 态下已写入的部分同样可以回滚——
 * 这正是新增 InterruptedPanel 要解决的问题：中断态之前回滚按钮根本不可达。
 */
function RollbackControls({
  batch,
  onRollback,
  rollingBack,
  rollbackError,
  rollbackResult,
}: {
  batch: BatchStatus
  onRollback: () => void
  rollingBack: boolean
  rollbackError: string | null
  rollbackResult: { unpublished: number; skipped: number; failed: number } | null
}) {
  const label = MODE_LABEL[batch.type]
  const unit = MODE_UNIT[batch.type]
  // 回滚锚点是批次的 affectedIds，前端拿不到那个数组，用 created+updated 近似
  // 「本批实际写入的条数」——预检失败的行本就不在 affectedIds 里，口径一致。
  const total = (batch.stats?.created ?? 0) + (batch.stats?.updated ?? 0)
  const rolledBack = rollbackResult !== null

  const openRollbackConfirm = () => {
    Modal.confirm({
      title: `确认批量下架本批${label}？`,
      content: `将把本批 ${total} ${unit}${label}全部下架，前台立即不可见。`,
      okText: '确认下架',
      cancelText: '取消',
      okButtonProps: { status: 'danger' },
      onOk: onRollback,
    })
  }

  return (
    <>
      {rollbackError && (
        <Alert type="error" content={rollbackError} style={{ marginBottom: 16 }} closable onClose={() => {}} />
      )}

      {rolledBack ? (
        <Alert
          // 评审 Important 前端同步：有失败条目时不能只显示"已下架 N 套"、把没处理成功
          // 的几条藏起来——运营需要知道还有几条没生效，才能判断要不要重试或人工介入。
          type={rollbackResult.failed > 0 ? 'warning' : 'success'}
          content={`已下架 ${rollbackResult.unpublished} ${unit}${
            rollbackResult.skipped > 0 ? `（另有 ${rollbackResult.skipped} ${unit}此前已不是上架状态，未重复处理）` : ''
          }${rollbackResult.failed > 0 ? `；有 ${rollbackResult.failed} ${unit}回滚失败，请重试或联系技术支持` : ''}`}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Button
        status="danger"
        // 有失败条目时不锁死按钮——回滚是幂等的，已下架的会被计入 skipped 直接跳过，
        // 留一条路让运营对同一批次重试，而不是逼着重新导一遍。
        disabled={total <= 0 || (rolledBack && rollbackResult.failed === 0)}
        loading={rollingBack}
        onClick={openRollbackConfirm}
      >
        {rolledBack && rollbackResult.failed > 0 ? '重试失败条目' : `批量下架本批${label}`}
      </Button>
    </>
  )
}

function DonePanel({
  batch,
  onRestart,
  onRollback,
  rollingBack,
  rollbackError,
  rollbackResult,
}: {
  batch: BatchStatus
  onRestart: () => void
  onRollback: () => void
  rollingBack: boolean
  rollbackError: string | null
  rollbackResult: { unpublished: number; skipped: number; failed: number } | null
}) {
  const failed = batch.status === 'failed'

  return (
    <Card>
      <Alert
        type={failed ? 'error' : 'success'}
        content={failed ? '本批导入执行失败，请查看统计后联系技术支持。' : '本批导入已完成。'}
        style={{ marginBottom: 16 }}
      />
      <Space size="large" style={{ marginBottom: 20 }}>
        <Statistic title="新建" value={batch.stats?.created ?? 0} />
        <Statistic title="更新" value={batch.stats?.updated ?? 0} />
        <Statistic title="失败" value={batch.stats?.failed ?? 0} />
      </Space>

      <Space>
        <RollbackControls
          batch={batch}
          onRollback={onRollback}
          rollingBack={rollingBack}
          rollbackError={rollbackError}
          rollbackResult={rollbackResult}
        />
        <Button type="primary" onClick={onRestart}>
          再导一批
        </Button>
      </Space>
    </Card>
  )
}

/**
 * 最终评审 Important 7：规格 §8「已中断」态——轮询超过 isSupplyImportPollTimedOut 的阈值仍未到终态时
 * 展示。恰是最需要止血的场景（Job 可能已经崩溃/被回收），回滚按钮必须在这里可达，
 * 不能像此前那样卡死在无限进度条上、DonePanel 永远不出现。
 */
function InterruptedPanel({
  batch,
  onRestart,
  onRollback,
  rollingBack,
  rollbackError,
  rollbackResult,
}: {
  batch: BatchStatus
  onRestart: () => void
  onRollback: () => void
  rollingBack: boolean
  rollbackError: string | null
  rollbackResult: { unpublished: number; skipped: number; failed: number } | null
}) {
  const processed = batch.stats?.processed ?? 0
  const total = batch.rowCount

  return (
    <Card>
      <Alert
        type="warning"
        content={`本批导入已中断（长时间未收到进度更新，写入任务可能已崩溃或所在实例被回收）。已处理 ${processed}/${total} 行，已写入的部分仍可回滚。`}
        style={{ marginBottom: 16 }}
      />
      <Space size="large" style={{ marginBottom: 20 }}>
        <Statistic title="新建" value={batch.stats?.created ?? 0} />
        <Statistic title="更新" value={batch.stats?.updated ?? 0} />
        <Statistic title="失败" value={batch.stats?.failed ?? 0} />
      </Space>

      <Space>
        <RollbackControls
          batch={batch}
          onRollback={onRollback}
          rollingBack={rollingBack}
          rollbackError={rollbackError}
          rollbackResult={rollbackResult}
        />
        <Button onClick={onRestart}>放弃本批，重新开始</Button>
      </Space>
    </Card>
  )
}
