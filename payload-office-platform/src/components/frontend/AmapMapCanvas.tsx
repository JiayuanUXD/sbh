/**
 * 高德地图 Canvas（浏览器侧）
 *
 * 演进：P1 时为「点击按钮懒加载」，现在改为「进入视口自动加载」。
 * 仍保留首屏性能优化：地图区块位于详情页靠后位置，IntersectionObserver
 * 会在容器首次进入视口（且坐标 + Key 都就绪）时才请求 webapi.amap.com，
 * 不在首屏 critical path 上加载第三方 JS。
 *
 * OPT-037 Task 5：图钉改为自建 DOM（createBuildingPinContent /
 * createPoiPinContent）而非 AMap 默认图标或 marker.label——默认图标是
 * 高德自带的蓝色水滴，marker.label 的默认外观是白底描边小票签，两者都需要
 * 覆盖未公开保证的内部类名才能改色。自建 DOM 由 detail.css 直接控制样式，
 * 不依赖 AMap 内部实现细节。
 *
 * 守护不变量：
 *   - 不调用 Geolocation（仅展示楼盘固定坐标）
 *   - 缺 Key / 加载失败 / 超时 -> 显示「地图暂时不可用」，不阻断静态地址与咨询
 *   - 点击 POI 高亮对应图钉——直接切换预建名称标签的 dataset.visible，
 *     不经过 AMap marker.setLabel，不重渲染地图、不重建 marker
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
import { POI_LETTERS } from '@/lib/frontend/location-pois'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

const BUILDING_MARKER_ID = '__building__'

/**
 * 本房源图钉：14px accent 圆点 + 6px 光环，旁附常驻深色标签（房源/楼盘名）。
 * 标签始终可见（不依赖高亮态），故直接烧进 content，不经过高亮 effect。
 */
function createBuildingPinContent(name: string): HTMLDivElement {
  const root = document.createElement('div')
  root.className = 'amap-map-canvas__pin amap-map-canvas__pin--building'
  const dot = document.createElement('span')
  dot.className = 'amap-map-canvas__pin-dot'
  const label = document.createElement('span')
  label.className = 'amap-map-canvas__pin-label'
  label.textContent = name
  root.append(dot, label)
  return root
}

/**
 * 周边点位图钉：26px 深色圆 + 字母。名称标签默认隐藏（data-visible=false），
 * 点击清单对应项后由高亮 effect 切换可见并写入文本。
 */
function createPoiPinContent(letter: string): {
  root: HTMLDivElement
  nameLabel: HTMLSpanElement
} {
  const root = document.createElement('div')
  root.className = 'amap-map-canvas__pin amap-map-canvas__pin--poi'
  const marker = document.createElement('span')
  marker.className = 'amap-map-canvas__pin-marker'
  marker.textContent = letter
  const nameLabel = document.createElement('span')
  nameLabel.className = 'amap-map-canvas__pin-name'
  nameLabel.dataset.visible = 'false'
  root.append(marker, nameLabel)
  return { root, nameLabel }
}

export default function AmapMapCanvas({
  coordinates,
  pois,
  mapEnabled,
  highlightedPoiId,
  buildingName,
}: Readonly<{
  coordinates?: CoordinatesViewModel
  pois: readonly NearbyPoi[]
  mapEnabled: boolean
  highlightedPoiId: string | null
  /** 本房源图钉常驻标签文案（楼盘名，见 LocationPanelBuilding.name） */
  buildingName: string
}>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<AMapMap | null>(null)
  const markersRef = useRef<Map<string, AMapMarker>>(new Map())
  // POI 名称标签 DOM 引用（与 markersRef 分开维护）：高亮态直接切换这个
  // span 的 dataset/文本，不经过 AMap marker.setLabel API。
  const poiNameLabelsRef = useRef<Map<string, HTMLSpanElement>>(new Map())
  const [state, setState] = useState<LoadState>('idle')

  // 高亮 POI：切换预建名称标签的可见性（ready 后生效）
  useEffect(() => {
    if (state !== 'ready') return
    for (const [id, nameLabel] of poiNameLabelsRef.current) {
      if (id === highlightedPoiId) {
        const poi = pois.find((p) => p.id === id)
        nameLabel.textContent = poi?.name ?? ''
        nameLabel.dataset.visible = 'true'
      } else {
        nameLabel.dataset.visible = 'false'
      }
    }
  }, [highlightedPoiId, state, pois])

  // 卸载时销毁地图。markers/poiNameLabels 在 effect 内先取一次 .current
  // （而非在 cleanup 里才读）——避免 react-hooks/exhaustive-deps 关于
  // "cleanup 里读 ref.current 可能已变化" 的告警，同时两个 Map 实例本身
  // 全程不重新赋值，取一次引用与在 cleanup 里读没有实际差别。
  useEffect(() => {
    const markers = markersRef.current
    const poiNameLabels = poiNameLabelsRef.current
    return () => {
      mapRef.current?.destroy()
      markers.clear()
      poiNameLabels.clear()
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
        // 楼盘中心 marker：自建 DOM（14px accent 圆点 + 6px 光环 + 常驻深色标签）
        const centerMarker = new AMap.Marker({
          position: [coordinates.longitude, coordinates.latitude],
          anchor: 'center',
          title: buildingName,
          content: createBuildingPinContent(buildingName),
          map,
        })
        markersRef.current.set(BUILDING_MARKER_ID, centerMarker)
        // POI markers：字母与 LocationPanel 清单面板共用 POI_LETTERS，
        // 按 pois 数组顺序编号（调用方已只传入「当前列表正在展示的」POI，
        // 见 LocationPanel 的 mapPois 取值说明）
        for (const [index, poi] of pois.entries()) {
          const { root, nameLabel } = createPoiPinContent(POI_LETTERS[index] ?? '')
          const marker = new AMap.Marker({
            position: [poi.coordinates.longitude, poi.coordinates.latitude],
            anchor: 'center',
            title: poi.name,
            content: root,
            map,
          })
          markersRef.current.set(poi.id, marker)
          poiNameLabelsRef.current.set(poi.id, nameLabel)
        }
        if (pois.length > 0) {
          map.setFitView()
        }
        setState('ready')
        requestAnimationFrame(() => {
          map.resize()
        })
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
    // startLoad 引用不稳定但仅执行一次：只有 mapEnabled/coordinates/state
    // 变化才会重新订阅 observer，而 observer 一旦触发即 disconnect，不会
    // 用到重新渲染后的新闭包；pois/buildingName 在此不入 deps 是有意为之。
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
        data-ready={state === 'ready' ? 'true' : 'false'}
      />
    </div>
  )
}
