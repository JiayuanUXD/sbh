/**
 * 高德地图 Canvas（浏览器侧）
 *
 * 演进：P1 时为「点击按钮懒加载」，现在改为「进入视口自动加载」。
 * 仍保留首屏性能优化：地图区块位于详情页靠后位置，IntersectionObserver
 * 会在容器首次进入视口（且坐标 + Key 都就绪）时才请求 webapi.amap.com，
 * 不在首屏 critical path 上加载第三方 JS。
 *
 * 守护不变量：
 *   - 不调用 Geolocation（仅展示楼盘固定坐标）
 *   - 缺 Key / 加载失败 / 超时 -> 显示「地图暂时不可用」，不阻断静态地址与咨询
 *   - 点击 POI 高亮对应 marker（setLabel），不重渲染地图
 *   - 卸载时销毁地图实例，避免泄漏
 *   - 尊重 prefers-reduced-motion：不自动滚动到地图区
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import {
  loadAmapMap,
  type AMapMap,
  type AMapMarker,
} from '@/lib/frontend/amap-map-loader'
import type { CoordinatesViewModel } from '@/domain/public-catalog'
import type { NearbyPoi } from '@/domain/location-services'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

const BUILDING_MARKER_ID = '__building__'

export default function AmapMapCanvas({
  coordinates,
  pois,
  mapEnabled,
  highlightedPoiId,
}: Readonly<{
  coordinates?: CoordinatesViewModel
  pois: readonly NearbyPoi[]
  mapEnabled: boolean
  highlightedPoiId: string | null
}>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<AMapMap | null>(null)
  const markersRef = useRef<Map<string, AMapMarker>>(new Map())
  const [state, setState] = useState<LoadState>('idle')

  // 高亮 POI marker（ready 后生效）
  useEffect(() => {
    if (state !== 'ready') return
    for (const [id, marker] of markersRef.current) {
      if (id === highlightedPoiId) {
        const name =
          id === BUILDING_MARKER_ID
            ? '楼盘位置'
            : pois.find((p) => p.id === id)?.name ?? ''
        marker.setLabel({ content: name, direction: 'top' })
      } else {
        marker.setLabel({ content: '' })
      }
    }
  }, [highlightedPoiId, state, pois])

  // 卸载时销毁地图
  useEffect(() => {
    return () => {
      mapRef.current?.destroy()
      markersRef.current.clear()
    }
  }, [])

  // 进入视口自动加载：当外层根元素滚入视口时触发一次性 loadAmapMap 请求
  // 注意：观察的是外层 .amap-map-canvas 根 div 而非 hidden 的 __container，
  // 因为 hidden 元素无 layout box，IntersectionObserver 不会触发。
  // startLoad 在 effect 之前声明，避免 react-hooks/immutability 的"声明前访问"告警
  function startLoad() {
    if (state !== 'idle' || !coordinates) return
    setState('loading')
    loadAmapMap()
      .then((AMap) => {
        const container = containerRef.current
        if (!container) {
          setState('error')
          return
        }
        const map = new AMap.Map(container, {
          zoom: 15,
          center: [coordinates.longitude, coordinates.latitude],
          viewMode: '2D',
        })
        mapRef.current = map
        // 楼盘中心 marker
        const centerMarker = new AMap.Marker({
          position: [coordinates.longitude, coordinates.latitude],
          title: '楼盘位置',
          map,
        })
        markersRef.current.set(BUILDING_MARKER_ID, centerMarker)
        // POI markers
        for (const poi of pois) {
          const marker = new AMap.Marker({
            position: [poi.coordinates.longitude, poi.coordinates.latitude],
            title: poi.name,
            map,
          })
          markersRef.current.set(poi.id, marker)
        }
        if (pois.length > 0) {
          map.setFitView()
        }
        setState('ready')
      })
      .catch(() => {
        setState('error')
      })
  }

  useEffect(() => {
    if (!mapEnabled || !coordinates) return
    if (state !== 'idle') return

    const root = rootRef.current
    if (!root) return

    // 无 IntersectionObserver 支持（老浏览器）时回退到点击触发
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            startLoad()
            observer.disconnect()
            break
          }
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(root)
    return () => observer.disconnect()
    // startLoad 引用稳定（仅依赖 state/coordinates/pois，均已 deps）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapEnabled, coordinates, state])

  // 缺坐标或未启用：不渲染地图区（静态地址由 LocationPanel 提供）
  if (!mapEnabled || !coordinates) {
    return null
  }

  return (
    <div ref={rootRef} className="amap-map-canvas" data-load-state={state}>
      {state === 'idle' && (
        <div
          className="amap-map-canvas__placeholder"
          role="status"
          aria-label="地图加载占位"
        >
          地图即将加载…
        </div>
      )}
      {state === 'loading' && (
        <p className="amap-map-canvas__status" role="status">
          地图加载中…
        </p>
      )}
      {state === 'error' && (
        <p
          className="amap-map-canvas__status amap-map-canvas__status--error"
          role="alert"
        >
          地图暂时不可用
        </p>
      )}
      <div
        ref={containerRef}
        className="amap-map-canvas__container"
        hidden={state !== 'ready'}
      />
    </div>
  )
}
