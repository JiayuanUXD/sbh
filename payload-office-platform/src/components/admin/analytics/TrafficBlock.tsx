'use client'

/**
 * 数据看板 - 流量与转化漏斗块（OPT-066）
 *
 * 消费 `/api/traffic`。三条与业务块一致的原则：
 *
 * 1. **整块独立降级**：Umami 不可达时本块显示「暂不可用」，业务块照常
 *    （同 `resolveSingleCard` 哲学）。
 * 2. **无权限时整块不渲染**：API 返回 403 就什么都不画，而不是画个空壳。
 * 3. **拿不到的数显示「—」而不是 0**：`detailView` 与 `leadsInWindow` 都可能是
 *    `null`，含义是「这一环量不到 / 你无权看全量」，与「值为 0」完全不同。
 */

import { useEffect, useState } from 'react'
import { Alert, Card, Grid, Space, Statistic, Tag, Typography, Radio } from '@arco-design/web-react'

import {
  TRAFFIC_RANGES,
  type TrafficBlock as TrafficBlockData,
  type TrafficRange,
} from '@/domain/analytics/traffic'
import { formatMetricValue } from './overview-view-model'

const { Row, Col } = Grid
const { Text } = Typography

const RANGE_LABELS: Record<TrafficRange, string> = {
  yesterday: '昨日',
  '7d': '近 7 日',
  '30d': '近 30 日',
}

const TRAFFIC_TIMEOUT_MS = 20_000

type Outcome =
  | { kind: 'ok'; data: TrafficBlockData }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }

type LoadState = { phase: 'loading' } | { phase: 'done'; outcome: Outcome }

/** 纯取数：不碰 setState（react-hooks/set-state-in-effect 会追进被调函数体） */
async function fetchTraffic(range: TrafficRange, signal: AbortSignal): Promise<Outcome> {
  const res = await fetch(`/api/traffic?range=${encodeURIComponent(range)}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  })
  // 无 analytics:traffic → 整块不渲染。画个「无权限」的空壳只会占位置。
  if (res.status === 401 || res.status === 403) return { kind: 'forbidden' }

  const body: unknown = await res.json().catch(() => null)
  if (!res.ok || typeof body !== 'object' || body === null) {
    return { kind: 'error', message: '流量数据加载失败' }
  }
  const traffic = (body as { traffic?: unknown }).traffic
  if (typeof traffic !== 'object' || traffic === null) {
    return { kind: 'error', message: '流量响应形状异常' }
  }
  return { kind: 'ok', data: traffic as TrafficBlockData }
}

/** 漏斗单步。`value` 为 null 时显示「—」并注明不可测。 */
function FunnelStep({
  label,
  value,
  hint,
}: {
  label: string
  value: number | null
  hint?: string
}) {
  return (
    <div className="analytics-funnel__step">
      <Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Text>
      <div className="analytics-funnel__value">{value === null ? '—' : value.toLocaleString('zh-CN')}</div>
      {hint ? (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {hint}
        </Text>
      ) : null}
    </div>
  )
}

function TopList({
  title,
  rows,
}: {
  title: string
  rows: Array<{ label: string; value: number }>
}) {
  return (
    <Card title={title} className="arco-admin-dashboard__panel">
      {rows.length === 0 ? (
        <Text type="secondary">暂无数据</Text>
      ) : (
        <div className="analytics-buckets">
          {rows.map((row) => (
            <div key={row.label} className="analytics-buckets__row">
              <span className="analytics-buckets__label" title={row.label}>
                {row.label || '(直接访问)'}
              </span>
              <span className="analytics-buckets__track">
                <span
                  className="analytics-buckets__fill"
                  style={{
                    width: `${Math.round((row.value / Math.max(...rows.map((r) => r.value), 1)) * 100)}%`,
                  }}
                />
              </span>
              <span className="analytics-buckets__value">{row.value.toLocaleString('zh-CN')}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function TrafficBlock(): React.ReactElement | null {
  const [range, setRange] = useState<TrafficRange>('yesterday')
  const [state, setState] = useState<LoadState>({ phase: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    let isMounted = true
    const timeoutId = window.setTimeout(() => controller.abort(), TRAFFIC_TIMEOUT_MS)

    void fetchTraffic(range, controller.signal)
      .then((outcome) => {
        if (isMounted) setState({ phase: 'done', outcome })
      })
      .catch(() => {
        if (isMounted) {
          setState({ phase: 'done', outcome: { kind: 'error', message: '流量数据请求失败' } })
        }
      })
      .finally(() => window.clearTimeout(timeoutId))

    return () => {
      isMounted = false
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [range])

  if (state.phase === 'loading') {
    return (
      <div className="arco-admin-dashboard__section" data-testid="traffic-loading">
        <Card className="arco-admin-dashboard__panel">
          <Text type="secondary">加载流量数据…</Text>
        </Card>
      </div>
    )
  }

  // 无权限：整块不渲染
  if (state.outcome.kind === 'forbidden') return null

  const header = (
    <Space size={12} align="center" style={{ marginBottom: 12 }}>
      <Tag color="arcoblue" bordered>
        流量与转化
      </Tag>
      <Radio.Group
        type="button"
        size="small"
        value={range}
        onChange={(v: TrafficRange) => setRange(v)}
        data-testid="traffic-range"
      >
        {TRAFFIC_RANGES.map((r) => (
          <Radio key={r} value={r}>
            {RANGE_LABELS[r]}
          </Radio>
        ))}
      </Radio.Group>
    </Space>
  )

  if (state.outcome.kind === 'error') {
    return (
      <div className="arco-admin-dashboard__section" data-testid="traffic-error">
        {header}
        <Alert type="error" content={state.outcome.message} />
      </div>
    )
  }

  const traffic = state.outcome.data
  if (traffic.status === 'unavailable') {
    return (
      <div className="arco-admin-dashboard__section" data-testid="traffic-unavailable">
        {header}
        <Alert
          type="warning"
          content="流量数据暂不可用（统计服务未接入或不可达）。本页其余数据不受影响。"
        />
      </div>
    )
  }

  const { funnel } = traffic

  return (
    <div className="arco-admin-dashboard__section" data-testid="traffic-block">
      {header}

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card className="arco-admin-dashboard__metric">
            <Statistic title="浏览量 PV" value={traffic.pageviews.toLocaleString('zh-CN')} groupSeparator={false} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="arco-admin-dashboard__metric">
            <Statistic title="访客数 UV" value={traffic.visitors.toLocaleString('zh-CN')} groupSeparator={false} />
          </Card>
        </Col>
      </Row>

      <div className="arco-admin-dashboard__section">
        <Card title="转化漏斗" className="arco-admin-dashboard__panel">
          {/* 口径必须写在脸上：按事件量计数、不去重、不校验步骤先后，
              后一步理论上可能大于前一步。不标注会被误读成转化人数。 */}
          <Text type="secondary" style={{ fontSize: 12 }}>
            按事件量计数（不做会话去重，不校验步骤先后顺序）
          </Text>
          <div className="analytics-funnel">
            <FunnelStep
              label="详情页浏览"
              value={funnel.detailView}
              hint={funnel.detailView === null ? '该环暂不可测' : undefined}
            />
            <FunnelStep label="打开咨询" value={funnel.inquiryOpen} />
            <FunnelStep label="提交咨询" value={funnel.inquirySubmit} />
            <FunnelStep label="咨询成功" value={funnel.inquirySuccess} />
          </div>

          {/* leadsInWindow 为 null = 调用方不是 global 范围，服务端就没给这个数。
              此时整行不渲染——不是「藏起来」，是真的没有。 */}
          {traffic.leadsInWindow === null ? null : (
            <div className="analytics-funnel__reconcile">
              <Text type="secondary" style={{ fontSize: 12 }}>
                同窗口真实线索 <b>{traffic.leadsInWindow.toLocaleString('zh-CN')}</b> 条 · 埋点漏报率{' '}
                <b data-testid="traffic-miss-rate">
                  {traffic.missRate === null ? '—' : formatMetricValue(traffic.missRate, 'rate')}
                </b>
              </Text>
            </div>
          )}
        </Card>
      </div>

      <div className="arco-admin-dashboard__section">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <TopList
              title="来源 Top"
              rows={traffic.topReferrers.map((r) => ({ label: r.name, value: r.visitors }))}
            />
          </Col>
          <Col xs={24} md={12}>
            <TopList
              title="落地页 Top"
              rows={traffic.topPages.map((p) => ({ label: p.path, value: p.pageviews }))}
            />
          </Col>
        </Row>
      </div>
    </div>
  )
}
