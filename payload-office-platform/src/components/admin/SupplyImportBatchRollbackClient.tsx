'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Message, Modal, Space, Tag, Typography } from '@arco-design/web-react'
import { IconUndo } from '@arco-design/web-react/icon'

const { Text, Paragraph } = Typography

/**
 * 导入批次回滚按钮 - 客户端（最终评审 Important 6）
 *
 * 组件头注释见服务端 `SupplyImportBatchRollback.tsx`。核心区别于导入页面
 * `BulkImportViewClient.tsx` 的 `DonePanel`：这里没有页面内存里的 `report`/`batch`
 * 完整状态可用，只从批次文档本身读 type/status/affectedIds.length 就够——
 * 回滚 endpoint 本就不看这些字段做判定，只是用来给运营一个可操作的展示。
 */

type ImportType = 'buildings' | 'listings'

const MODE_LABEL: Record<ImportType, string> = { buildings: '楼盘', listings: '房源' }
const MODE_UNIT: Record<ImportType, string> = { buildings: '个', listings: '套' }

const STATUS_LABEL: Record<string, string> = {
  preflight: '预检完成',
  queued: '排队中',
  running: '写入中',
  completed: '已完成',
  failed: '失败',
}

const STATUS_COLOR: Record<string, string> = {
  preflight: 'gray',
  queued: 'arcoblue',
  running: 'arcoblue',
  completed: 'green',
  failed: 'red',
}

type Props = {
  batchId: string
  type: ImportType
  status: string
  affectedCount: number
}

type RollbackResult = { unpublished: number; skipped: number; failed: number }

export default function SupplyImportBatchRollbackClient({ batchId, type, status, affectedCount }: Props) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RollbackResult | null>(null)

  const label = MODE_LABEL[type]
  const unit = MODE_UNIT[type]
  const rolledBack = result !== null

  const confirm = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/bulk-import/batches/${batchId}/rollback`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        unpublished?: number
        skipped?: number
        failed?: number
      }
      if (!res.ok || !data.ok) {
        setError(data.error ?? '回滚失败，请重试')
        return
      }
      setModalOpen(false)
      setResult({
        unpublished: data.unpublished ?? 0,
        skipped: data.skipped ?? 0,
        failed: data.failed ?? 0,
      })
      Message.success('回滚已执行')
      router.refresh()
    } catch {
      setError('回滚请求失败，请检查网络后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <Space align="center">
        <Text type="secondary" style={{ fontSize: 12 }}>
          批次止血
        </Text>
        <Tag color={STATUS_COLOR[status] ?? 'gray'}>{STATUS_LABEL[status] ?? status}</Tag>
        <Button
          type="outline"
          status="danger"
          size="small"
          icon={<IconUndo />}
          // 有失败条目时不锁死按钮——回滚是幂等的，已下架的会被计入 skipped 直接跳过，
          // 留一条路让运营对同一批次重试。affectedCount<=0（预检/排队中，还没写入
          // 任何东西，或者结构守卫失败导致锚点为空）时没有什么可回滚的。
          disabled={affectedCount <= 0 || (rolledBack && result.failed === 0)}
          onClick={() => setModalOpen(true)}
        >
          {rolledBack && result.failed > 0 ? '重试失败条目' : `批量下架本批${label}`}
        </Button>
      </Space>

      {result && (
        <Alert
          type={result.failed > 0 ? 'warning' : 'success'}
          content={`已下架 ${result.unpublished} ${unit}${
            result.skipped > 0 ? `（另有 ${result.skipped} ${unit}此前已不是上架状态，未重复处理）` : ''
          }${result.failed > 0 ? `；有 ${result.failed} ${unit}回滚失败，请重试或联系技术支持` : ''}`}
          style={{ marginTop: 8, maxWidth: 480 }}
        />
      )}

      <Modal
        title={`确认批量下架本批${label}？`}
        visible={modalOpen}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="确认下架"
        cancelText="取消"
        onOk={confirm}
        okButtonProps={{ status: 'danger' }}
      >
        <Paragraph>
          将把本批约 {affectedCount} {unit}{label}全部下架（不是删除，AGENTS.md 禁止物理删除已引用主数据），前台立即不可见。
        </Paragraph>
        {error ? (
          <Text type="error" style={{ display: 'block', marginTop: 8 }}>
            {error}
          </Text>
        ) : null}
      </Modal>
    </div>
  )
}
