/**
 * P1 Task 3：位置交通面板
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 3
 *
 * 守护不变量：
 *   - 静态区始终保留：地址、最近地铁、复制地址、打开高德地图（canonical 外链）
 *   - POI 四类别语义 Tab，每类最多 5 项；点击 POI 高亮地图 marker
 *   - 地图懒加载由 AmapMapCanvas 负责；缺坐标/Key 时仅展示静态区
 *   - 打开高德地图使用 uri.amap.com/marker，P1 不实现路线规划
 *   - 复制地址失败非阻断（localStorage/clipboard 不可用时静默）
 */

'use client'

import { useState } from 'react'
import AmapMapCanvas from '@/components/frontend/AmapMapCanvas'
import type { CoordinatesViewModel } from '@/domain/public-catalog'
import type { NearbyPoi, PoiCategory } from '@/domain/location-services'
import type { PoiByCategory } from '@/lib/frontend/location-pois'

/** LocationPanel 需要的楼盘信息（从 BuildingDetail/SummaryViewModel 投影） */
export interface LocationPanelBuilding {
  id: number
  name: string
  address: string
  coordinates?: CoordinatesViewModel
  nearestMetro?: { name: string }
}

const POI_CATEGORY_TABS = [
  { key: 'transport', label: '交通' },
  { key: 'restaurant', label: '餐饮' },
  { key: 'bank', label: '银行' },
  { key: 'hotel', label: '酒店' },
] as const

const COPY_FEEDBACK_MS = 2000

/**
 * 构建高德地图外链 marker URL（P1 只提供打开第三方地图，不做路线规划）。
 * position=经度,纬度（高德规范）。
 */
export function buildAmapPlaceUrl(
  name: string,
  coordinates: CoordinatesViewModel,
): string {
  return `https://uri.amap.com/marker?position=${coordinates.longitude},${coordinates.latitude}&name=${encodeURIComponent(name)}`
}

export default function LocationPanel({
  building,
  pois,
  mapEnabled,
}: Readonly<{
  building: LocationPanelBuilding
  pois: PoiByCategory
  mapEnabled: boolean
}>) {
  const [activeCategory, setActiveCategory] = useState<PoiCategory>('transport')
  const [highlightedPoiId, setHighlightedPoiId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const coordinates = building.coordinates
  const activePois = pois[activeCategory]
  const hasAnyPoi = POI_CATEGORY_TABS.some((tab) => pois[tab.key].length > 0)

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(building.address)
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    } catch {
      // 剪贴板不可用（无权限/无 HTTPS）：非阻断，静默失败
      setCopied(false)
    }
  }

  return (
    <section id="location" className="location-panel detail__section" aria-labelledby="location-title">
      <h2 id="location-title">位置交通</h2>

      {/* 静态区：始终保留，地图/POI 失效不影响 */}
      <div className="location-panel__static">
        <dl className="location-panel__facts">
          <div className="location-panel__fact">
            <dt>地址</dt>
            <dd>{building.address || '地址待补充'}</dd>
          </div>
          {building.nearestMetro && (
            <div className="location-panel__fact">
              <dt>最近地铁</dt>
              <dd>{building.nearestMetro.name}</dd>
            </div>
          )}
        </dl>
        <div className="location-panel__actions">
          <button
            type="button"
            className="btn btn--ghost location-panel__copy"
            onClick={copyAddress}
            aria-label="复制地址"
          >
            {copied ? '已复制' : '复制地址'}
          </button>
          {coordinates && (
            <a
              href={buildAmapPlaceUrl(building.name, coordinates)}
              className="btn btn--ghost location-panel__amap-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              打开高德地图
            </a>
          )}
        </div>
      </div>

      {/* 地图区：懒加载，缺坐标/Key 时 AmapMapCanvas 返回 null */}
      <AmapMapCanvas
        coordinates={coordinates}
        pois={activePois}
        mapEnabled={mapEnabled}
        highlightedPoiId={highlightedPoiId}
      />

      {/* POI 分类列表 */}
      {hasAnyPoi && (
        <div className="location-panel__pois" role="tablist" aria-label="周边配套">
          {POI_CATEGORY_TABS.map((tab) => {
            const count = pois[tab.key].length
            if (count === 0) return null
            const isActive = activeCategory === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="location-panel-poi-list"
                className="location-panel__poi-tab"
                data-active={isActive}
                onClick={() => {
                  setActiveCategory(tab.key)
                  setHighlightedPoiId(null)
                }}
              >
                {tab.label}（{count}）
              </button>
            )
          })}
        </div>
      )}
      {hasAnyPoi && activePois.length > 0 && (
        <ul
          id="location-panel-poi-list"
          className="location-panel__poi-list"
          role="tabpanel"
        >
          {activePois.map((poi) => (
            <li key={poi.id}>
              <button
                type="button"
                className="location-panel__poi-item"
                data-highlighted={highlightedPoiId === poi.id}
                onClick={() => setHighlightedPoiId(poi.id)}
              >
                <span className="location-panel__poi-name">{poi.name}</span>
                <span className="location-panel__poi-distance">
                  {Math.round(poi.distanceMeters)} 米{poi.direction ? ` · ${poi.direction}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
