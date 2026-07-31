/**
 * P1 Task 3：高德地图 Canvas（浏览器侧）
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 3
 *
 * 守护不变量：
 *   - 只在用户点击"查看地图"后加载 JS API（SSR / 初始 / 进入视口前不请求 webapi.amap.com）
 *   - 不调用 Geolocation（P1 只展示楼盘固定坐标）
 *   - 缺 Key / 加载失败 / 超时 -> 显示"地图暂时不可用"，不阻断静态地址与咨询
 *   - 点击 POI 高亮对应 marker（setLabel），不重渲染地图
 *   - 卸载时销毁地图实例，避免泄漏
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

  // 缺坐标或未启用：不渲染地图区（静态地址由 LocationPanel 提供）
  if (!mapEnabled || !coordinates) {
    return null
  }

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

  return (
    <div className="amap-map-canvas" data-load-state={state}>
      {state === 'idle' && (
        <button
          type="button"
          className="amap-map-canvas__trigger"
          onClick={startLoad}
        >
          查看地图
        </button>
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
