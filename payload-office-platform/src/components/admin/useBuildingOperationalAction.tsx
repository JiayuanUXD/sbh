'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Message, Modal, Space, Tag, Typography } from '@arco-design/web-react'

import type { BuildingOperationalStatus } from '@/domain/supply/building'

const { Text, Paragraph } = Typography

/**
 * 楼盘停用 / 启用的确认流程（OPT-113 从 BuildingOperationalToggleClient 抽出，
 * 编辑页启停按钮与楼盘库列表操作列共用）。
 *
 *   - 停用：打开即预检 `GET deactivation-impact`，展示受影响的对外可见记录数，确认后提交。
 *     停用只撤销前台有效性，绝不改写关联房源的审核 / 发布状态（R3）。
 *   - 启用：无破坏性，直接确认。
 *
 * 提交带 `target`（目标状态），不靠端点的翻转语义：调用方按自己读到的状态渲染按钮，
 * 列表行尤其可能已经过期。已是目标状态时端点幂等返回 `changed: false`，这里如实提示。
 *
 * 权限与状态写入全在端点（building:freeze）；失败时透传端点文案。
 *
 * 用法：`const { open, modal } = useBuildingOperationalAction(onDone)`，按钮里调
 * `open({ id, name, status })`，把 `modal` 渲染在组件里任意位置。整页只挂一个弹层实例。
 */

export type BuildingOperationalTarget = {
  id: string
  name: string
  /** 调用方读到的当前启停状态，决定本次是停用还是启用 */
  status: BuildingOperationalStatus
}

type ImpactSource = { collection: string; label: string; count: number }
type ImpactReport = { sources: ImpactSource[]; total: number }

function parseImpactReport(raw: unknown): ImpactReport | null {
  if (!raw || typeof raw !== 'object') return null
  const { sources, total } = raw as { sources?: unknown; total?: unknown }
  if (!Array.isArray(sources) || typeof total !== 'number') return null
  const parsed: ImpactSource[] = []
  for (const s of sources) {
    if (!s || typeof s !== 'object') return null
    const { collection, label, count } = s as Record<string, unknown>
    if (typeof collection !== 'string' || typeof label !== 'string' || typeof count !== 'number') {
      return null
    }
    parsed.push({ collection, label, count })
  }
  return { sources: parsed, total }
}

function readError(data: unknown): string | null {
  return data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
    ? data.error
    : null
}

export function useBuildingOperationalAction(
  onDone: (next: BuildingOperationalStatus) => void,
): { open: (target: BuildingOperationalTarget) => void; modal: ReactNode } {
  // target 关闭后保留：弹层淡出动画期间标题 / 正文不该跳成另一个动作。
  const [target, setTarget] = useState<BuildingOperationalTarget | null>(null)
  const [visible, setVisible] = useState(false)
  const [impact, setImpact] = useState<ImpactReport | null>(null)
  const [loadingImpact, setLoadingImpact] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 快速换行打开时，前一行的预检响应可能晚到；只认最后一次打开发出的那个。
  const openSeq = useRef(0)

  const willDisable = target?.status === 'active'
  const actionLabel = willDisable ? '停用' : '启用'

  // useCallback：列表把 open 放进列定义的依赖里，引用不稳会让整张表的列每次重建。
  // 里面只碰 setState 与 ref，两者引用本就稳定，依赖为空即可。
  const open = useCallback((next: BuildingOperationalTarget) => {
    const seq = ++openSeq.current
    setTarget(next)
    setVisible(true)
    setImpact(null)
    setError(null)
    if (next.status !== 'active') {
      setLoadingImpact(false)
      return
    }
    setLoadingImpact(true)
    void (async () => {
      try {
        const resp = await fetch(`/api/buildings/${next.id}/deactivation-impact`, {
          credentials: 'include',
        })
        const data: unknown = await resp.json().catch(() => null)
        if (seq !== openSeq.current) return
        const report =
          resp.ok && data && typeof data === 'object' && 'report' in data
            ? parseImpactReport(data.report)
            : null
        if (report) setImpact(report)
        else setError(readError(data) ?? '预检受影响房源失败')
      } catch {
        if (seq === openSeq.current) setError('预检受影响房源失败')
      } finally {
        if (seq === openSeq.current) setLoadingImpact(false)
      }
    })()
  }, [])

  const close = () => {
    openSeq.current += 1
    setVisible(false)
  }

  const confirm = async () => {
    if (!target) return
    const desired: BuildingOperationalStatus = willDisable ? 'disabled' : 'active'
    setSubmitting(true)
    setError(null)
    try {
      const resp = await fetch(`/api/buildings/${target.id}/toggle-operational-status`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: desired }),
      })
      const data: unknown = await resp.json().catch(() => null)
      const ok = resp.ok && data && typeof data === 'object' && 'ok' in data && data.ok === true
      if (!ok) {
        setError(readError(data) ?? `${actionLabel}失败`)
        return
      }
      const changed = !(data && typeof data === 'object' && 'changed' in data && data.changed === false)
      close()
      if (changed) Message.success(`已${actionLabel}`)
      else Message.info(`该楼盘已是${desired === 'disabled' ? '停用' : '启用'}状态`)
      onDone(desired)
    } catch {
      setError(`${actionLabel}失败`)
    } finally {
      setSubmitting(false)
    }
  }

  const modal = (
    <Modal
      title={`${actionLabel}楼盘${target?.name ? `「${target.name}」` : ''}`}
      visible={visible}
      onCancel={close}
      confirmLoading={submitting}
      escToExit={!submitting}
      maskClosable={false}
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
  )

  return { open, modal }
}
