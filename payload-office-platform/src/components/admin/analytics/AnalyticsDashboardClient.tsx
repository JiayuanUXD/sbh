'use client'

/**
 * 数据看板 - 业务日报块（OPT-065）
 *
 * 消费**已有**的 `/api/overview`：卡 / 趋势 / 分布 + asOf。零后端改动。
 *
 * ## 两条刻意的取舍
 *
 * 1. **失败的卡照样渲染成占位**，不过滤。服务端已按卡做失败隔离，页面若把失败卡
 *    藏掉，「指标炸了」和「指标没配」就长得一样了，而这两件事的处置完全不同。
 * 2. **不引图表库**。趋势/分布用手绘 SVG 与 Arco Progress——为一页两张图给整个
 *    后台 bundle 加一个重依赖不划算，新依赖按宪章也要单独决策。
 */

import { useEffect, useState } from 'react'
import { Alert, Button, Card, Grid, Space, Spin, Statistic, Tag, Typography } from '@arco-design/web-react'
import { IconRefresh } from '@arco-design/web-react/icon'

import {
  cardStatusHint,
  formatAsOf,
  formatMetricValue,
  maxBucketValue,
  parseOverviewPayload,
  type OverviewCardView,
  type OverviewViewModel,
} from './overview-view-model'
import TrafficBlock from './TrafficBlock'

const { Row, Col } = Grid
const { Title, Text } = Typography

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; forbidden: boolean }
  | { phase: 'ready'; data: OverviewViewModel }

/** 单张指标卡：成功显示值，其余显示降级占位（保留卡位，不隐藏） */
function MetricCard({ card }: { card: OverviewCardView }) {
  const hint = cardStatusHint(card)

  return (
    <Card className="arco-admin-dashboard__metric" hoverable={card.status === 'success'}>
      {card.status === 'success' ? (
        <Statistic
          title={card.label}
          value={formatMetricValue(card.value, card.unit)}
          groupSeparator={false}
        />
      ) : (
        <Space direction="vertical" size={4}>
          <Text type="secondary">{card.label}</Text>
          <Text style={{ fontSize: 20 }}>—</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {hint}
          </Text>
        </Space>
      )}
      {card.status === 'success' && card.drilldownUrl ? (
        <a href={card.drilldownUrl} style={{ fontSize: 12 }}>
          查看明细
        </a>
      ) : null}
    </Card>
  )
}

/** 手绘水平条形图：桶少、值域小，SVG 足够，不值得引图表库 */
function BucketBars({ card }: { card: OverviewCardView }) {
  const max = maxBucketValue(card)
  if (card.buckets.length === 0) {
    return <Text type="secondary">暂无数据</Text>
  }

  return (
    <div className="analytics-buckets">
      {card.buckets.map((bucket) => {
        const ratio = max > 0 ? bucket.value / max : 0
        return (
          <div key={bucket.label} className="analytics-buckets__row">
            <span className="analytics-buckets__label" title={bucket.label}>
              {bucket.label}
            </span>
            <span className="analytics-buckets__track">
              <span
                className="analytics-buckets__fill"
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
            <span className="analytics-buckets__value">
              {formatMetricValue(bucket.value, card.unit)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** 序列卡（趋势/分布）容器：失败时同样保留卡位并说明原因 */
function SeriesCard({ card }: { card: OverviewCardView }) {
  const hint = cardStatusHint(card)
  return (
    <Card title={card.label} className="arco-admin-dashboard__panel">
      {card.status === 'success' ? <BucketBars card={card} /> : <Text type="secondary">{hint}</Text>}
    </Card>
  )
}

/** 取数超时：挂住的请求不该让 spinner 永远转下去 */
const OVERVIEW_TIMEOUT_MS = 15_000

type FetchOutcome =
  | { ok: true; data: OverviewViewModel }
  | { ok: false; message: string; forbidden: boolean }

/**
 * 纯取数：**不碰 setState**。
 *
 * 这不是风格问题——`react-hooks/set-state-in-effect` 会追进 effect 里调用的函数体，
 * 只要里面有 setState 就报错（即使都在 await 之后）。仓库里 `StatsWidgetClient`
 * 已确立这个形状：effect 调纯函数，setState 只出现在 .then/.catch 回调里。
 */
async function fetchOverview(signal: AbortSignal): Promise<FetchOutcome> {
  const res = await fetch('/api/overview', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  })

  // 401/403 单独识别：视图层守卫已挡过一次，这里兜住「守卫放行但指标全无权限」，
  // 且这两种情况重试没有意义，不该给「重试」按钮。
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      forbidden: true,
      message:
        res.status === 401 ? '登录状态已失效，请重新登录。' : '当前账号没有经营概览查看权限。',
    }
  }

  const parsed = parseOverviewPayload((await res.json()) as unknown)
  return parsed.ok
    ? { ok: true, data: parsed.data }
    : { ok: false, forbidden: false, message: parsed.reason }
}

export default function AnalyticsDashboardClient(): React.ReactElement {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let isMounted = true
    const timeoutId = window.setTimeout(() => controller.abort(), OVERVIEW_TIMEOUT_MS)

    void fetchOverview(controller.signal)
      .then((outcome) => {
        if (!isMounted) return
        setState(
          outcome.ok
            ? { phase: 'ready', data: outcome.data }
            : { phase: 'error', message: outcome.message, forbidden: outcome.forbidden },
        )
      })
      .catch((err: unknown) => {
        if (!isMounted) return
        const aborted = err instanceof DOMException && err.name === 'AbortError'
        setState({
          phase: 'error',
          forbidden: false,
          message: aborted ? '请求超时，请重试。' : err instanceof Error ? err.message : '网络请求失败',
        })
      })
      .finally(() => window.clearTimeout(timeoutId))

    return () => {
      isMounted = false
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [requestVersion])

  /** 手动刷新：事件回调里 setState 是正常的，靠 requestVersion 重跑 effect */
  const refresh = () => {
    setState({ phase: 'loading' })
    setRequestVersion((v) => v + 1)
  }

  if (state.phase === 'loading') {
    return (
      <div className="arco-admin-dashboard" data-testid="analytics-loading">
        <Spin tip="加载经营概览…" />
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="arco-admin-dashboard">
        <Alert
          type={state.forbidden ? 'warning' : 'error'}
          content={state.message}
          data-testid="analytics-error"
        />
        {state.forbidden ? null : (
          <Button icon={<IconRefresh />} onClick={refresh} style={{ marginTop: 12 }}>
            重试
          </Button>
        )}
      </div>
    )
  }

  const { cards, trends, distributions, asOf } = state.data

  return (
    <div className="arco-admin-dashboard" data-testid="analytics-dashboard">
      <section className="arco-admin-dashboard__intro">
        <Space size={10} direction="vertical">
          <Tag color="arcoblue" bordered>
            数据看板
          </Tag>
          <Title heading={2}>业务日报</Title>
          <Text type="secondary">
            数据截至 <span data-testid="analytics-as-of">{formatAsOf(asOf)}</span>
          </Text>
        </Space>
        <div className="arco-admin-dashboard__actions">
          <Button icon={<IconRefresh />} onClick={refresh}>
            刷新
          </Button>
        </div>
      </section>

      <Row gutter={[16, 16]}>
        {cards.map((card) => (
          <Col key={card.code} xs={12} md={6}>
            <MetricCard card={card} />
          </Col>
        ))}
      </Row>

      {/*
        间距挂在外层容器上，不能写成 <Row style={{ marginTop }}>：
        Arco 的 Row 在 gutter 有纵向值时会给自己加 `margin: -gutterY/2` 抵消列内边距，
        并且**覆盖掉调用方传入的 marginTop**（实测：传 16，计算值仍是 -8）。
        结果是「块间距 8px 反而小于块内的 16px」，视觉层级整个反过来。
        用 paddingTop 而非 marginTop：外层若用 margin 会与 Row 的负 margin 折叠，
        又要多绕一圈。
      */}
      <div className="arco-admin-dashboard__section">
        <Row gutter={[16, 16]}>
          {[...trends, ...distributions].map((card) => (
            <Col key={card.code} xs={24} md={12}>
              <SeriesCard card={card} />
            </Col>
          ))}
        </Row>
      </div>

      {/* 流量块（OPT-066）。无 analytics:traffic 时它自己返回 null，
          Umami 不可达时它自己显示「暂不可用」——两种降级都不牵连上面的业务块。 */}
      <TrafficBlock />
    </div>
  )
}
