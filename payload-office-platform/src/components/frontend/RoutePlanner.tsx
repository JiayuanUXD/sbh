/**
 * P2 Task 2：用户主动触发的路线建议
 *
 * 守护不变量：
 *   - 页面加载/进入视口前不请求定位；仅在点击"查看到这里的路线"后读取一次
 *   - getCurrentPosition 只保存坐标在组件内存，卸载后释放；不写 localStorage/日志
 *   - 拒绝/超时/不支持 -> 显示"无法获取当前位置" + 保留外部导航降级
 *   - 只展示时长/距离/换乘/来源，不绘制精确起点 marker
 *   - 埋点只记 route_mode / permission_result / duration_bucket（由后端记录成功）
 */

'use client'

import { useState } from 'react'
import type { CoordinatesViewModel } from '@/domain/public-catalog'
import type { RouteMode, RouteSummary } from '@/domain/location-services'

const ROUTE_MODE_LABELS: Readonly<Record<RouteMode, string>> = {
  transit: '公交/地铁',
  driving: '驾车',
  walking: '步行',
}

type PlannerState =
  | { phase: 'idle' }
  | { phase: 'locating' }
  | { phase: 'routing' }
  | { phase: 'ready'; summary: RouteSummary }
  | { phase: 'error'; reason: 'location_denied' | 'route_failed' }

function randomRequestId(): string {
  // 幂等/追踪用，非机密；crypto 优先，降级到时间+随机
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `route-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

/** 一次性定位（仅点击后调用），Promise 化 getCurrentPosition */
function getCurrentPositionOnce(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('unsupported'))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 5000,
      maximumAge: 60_000,
    })
  })
}

export default function RoutePlanner({
  destination,
  destinationName,
  amapLinkUrl,
}: Readonly<{
  destination: CoordinatesViewModel
  destinationName: string
  amapLinkUrl: string
}>) {
  const [mode, setMode] = useState<RouteMode>('transit')
  const [state, setState] = useState<PlannerState>({ phase: 'idle' })

  async function planRoute() {
    setState({ phase: 'locating' })
    let position: GeolocationPosition
    try {
      position = await getCurrentPositionOnce()
    } catch {
      // 拒绝/超时/不支持：降级，保留外部导航
      setState({ phase: 'error', reason: 'location_denied' })
      return
    }
    // 起点坐标仅在本函数作用域内存在，请求后不保留
    const origin = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    }
    setState({ phase: 'routing' })
    try {
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin, destination, mode, requestId: randomRequestId() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setState({ phase: 'error', reason: 'route_failed' })
        return
      }
      setState({ phase: 'ready', summary: data.summary as RouteSummary })
    } catch {
      setState({ phase: 'error', reason: 'route_failed' })
    }
  }

  return (
    <div className="route-planner">
      <div className="route-planner__modes" role="group" aria-label="出行方式">
        {(Object.keys(ROUTE_MODE_LABELS) as RouteMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className="route-planner__mode"
            data-active={mode === m}
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
          >
            {ROUTE_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn--ghost route-planner__trigger"
        onClick={planRoute}
        disabled={state.phase === 'locating' || state.phase === 'routing'}
      >
        {state.phase === 'locating'
          ? '正在获取当前位置…'
          : state.phase === 'routing'
            ? '正在规划路线…'
            : '查看到这里的路线'}
      </button>

      {state.phase === 'ready' && (
        <dl className="route-planner__summary" aria-live="polite">
          <div>
            <dt>方式</dt>
            <dd>{ROUTE_MODE_LABELS[state.summary.mode]}</dd>
          </div>
          <div>
            <dt>预计时长</dt>
            <dd>{state.summary.durationMinutes} 分钟</dd>
          </div>
          <div>
            <dt>距离</dt>
            <dd>{(state.summary.distanceMeters / 1000).toFixed(1)} 公里</dd>
          </div>
          {state.summary.transfers !== null && (
            <div>
              <dt>换乘</dt>
              <dd>{state.summary.transfers} 次</dd>
            </div>
          )}
        </dl>
      )}

      {state.phase === 'error' && (
        <p className="route-planner__fallback" role="alert">
          {state.reason === 'location_denied' ? '无法获取当前位置' : '暂时无法规划路线'}
          ，可
          <a href={amapLinkUrl} target="_blank" rel="noopener noreferrer">
            打开高德地图
          </a>
          查看 {destinationName} 的导航。
        </p>
      )}
    </div>
  )
}
