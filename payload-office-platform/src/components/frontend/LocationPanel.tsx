/**
 * 位置交通面板
 *
 * 守护不变量：
 *   - POI 四类别语义 Tab，每类最多 5 项；点击 POI 高亮地图 marker
 *   - 地图懒加载由 AmapMapCanvas 负责；缺坐标/Key 时仅展示 POI 列表
 */

'use client'

import { useState } from 'react'
import AmapMapCanvas from '@/components/frontend/AmapMapCanvas'
import type { CoordinatesViewModel } from '@/domain/public-catalog'
import type { NearbyPoi, PoiCategory, TransportSubCategory } from '@/domain/location-services'
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
  { key: 'transport', label: '交通', icon: 'transport' },
  { key: 'restaurant', label: '餐饮', icon: 'restaurant' },
  { key: 'bank', label: '银行', icon: 'bank' },
  { key: 'hotel', label: '酒店', icon: 'hotel' },
] as const

/**
 * 交通子 Tab 配置（仅 transport 类别下显示）。
 * 仅当对应子分类有 POI 时渲染对应 Tab，无 subCategory 的 POI 不进子 Tab。
 */
const TRANSPORT_SUB_TABS: ReadonlyArray<{
  key: TransportSubCategory
  label: string
}> = [
  { key: 'subway', label: '地铁' },
  { key: 'bus', label: '公交' },
]

/** POI 列表项左侧字母锚点（最多 5 项，对应 A-E） */
const POI_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const

type PoiIconKey = (typeof POI_CATEGORY_TABS)[number]['icon']

function PoiCategoryIcon({ name }: Readonly<{ name: PoiIconKey }>) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (name) {
    case 'transport':
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="14" rx="2" />
          <path d="M4 11h16M7 17v2M17 17v2M8 7h.01M16 7h.01" />
        </svg>
      )
    case 'restaurant':
      return (
        <svg {...common}>
          <path d="M6 3v8a2 2 0 002 2v8M6 3v5M9 3v5M18 3c-2 0-3 2-3 5s1 4 3 4v9" />
        </svg>
      )
    case 'bank':
      return (
        <svg {...common}>
          <path d="M4 9l8-5 8 5M5 9v8M19 9v8M5 17h14M9 17v-3M15 17v-3M4 21h16" />
        </svg>
      )
    case 'hotel':
      return (
        <svg {...common}>
          <path d="M3 21V8l9-5 9 5v13M3 21h18M9 21v-5h6v5M7 11h.01M17 11h.01" />
        </svg>
      )
  }
}

const DistanceIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z" />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
)

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
  const [activeSubCategory, setActiveSubCategory] = useState<TransportSubCategory>('subway')
  const [highlightedPoiId, setHighlightedPoiId] = useState<string | null>(null)

  const coordinates = building.coordinates
  const hasAnyPoi = POI_CATEGORY_TABS.some((tab) => pois[tab.key].length > 0)

  // 交通类按子分类（subway/bus）筛分；非交通类别整组透传
  const transportPois = pois.transport
  const transportSubPois = transportPois.filter(
    (poi) => poi.subCategory === activeSubCategory,
  )
  // 地图 markers：交通类始终显示全部 transport POI（地铁+公交），
  // 切换子 Tab 只筛选列表，不重建地图 markers。
  // 非交通类则只展示该类别 POI。
  const mapPois =
    activeCategory === 'transport' ? transportPois : pois[activeCategory]
  // 列表：交通类按子分类筛选，非交通类整组
  const activePois =
    activeCategory === 'transport' ? transportSubPois : pois[activeCategory]

  // 交通子 Tab 仅渲染有 POI 的子分类
  const visibleSubTabs = TRANSPORT_SUB_TABS.filter((tab) =>
    transportPois.some((poi) => poi.subCategory === tab.key),
  )
  const hasSubTabs = activeCategory === 'transport' && visibleSubTabs.length > 1

  return (
    <section id="location" className="location-panel detail__section" aria-labelledby="location-title">
      <h2 id="location-title">位置交通</h2>

      {/* 地图区 + POI 浮动面板：地图占满宽度，POI 面板绝对定位浮在右侧 */}
      <div className="location-panel__map-area">
        <AmapMapCanvas
          coordinates={coordinates}
          pois={mapPois}
          mapEnabled={mapEnabled}
          highlightedPoiId={highlightedPoiId}
        />

        {hasAnyPoi && (
          <div className="location-panel__poi-panel" aria-label="周边配套">
            <div className="location-panel__pois" role="tablist" aria-label="周边配套类别">
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
                    <span className="location-panel__poi-tab-icon" aria-hidden="true">
                      <PoiCategoryIcon name={tab.icon} />
                    </span>
                    {tab.label}（{count}）
                  </button>
                )
              })}
            </div>
            {/* 交通双层 Tab：仅当存在 ≥2 种子分类时显示 */}
            {hasSubTabs && (
              <div
                className="location-panel__poi-subtabs"
                role="tablist"
                aria-label="交通子分类"
              >
                {visibleSubTabs.map((tab) => {
                  const count = transportPois.filter(
                    (poi) => poi.subCategory === tab.key,
                  ).length
                  const isActive = activeSubCategory === tab.key
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls="location-panel-poi-list"
                      className="location-panel__poi-subtab"
                      data-active={isActive}
                      onClick={() => {
                        setActiveSubCategory(tab.key)
                        setHighlightedPoiId(null)
                      }}
                    >
                      {tab.label}（{count}）
                    </button>
                  )
                })}
              </div>
            )}
            {activePois.length > 0 && (
              <ul
                id="location-panel-poi-list"
                className="location-panel__poi-list"
                role="tabpanel"
              >
                {activePois.map((poi, index) => {
                  const letter = POI_LETTERS[index] ?? ''
                  return (
                    <li key={poi.id}>
                      <button
                        type="button"
                        className="location-panel__poi-item"
                        data-highlighted={highlightedPoiId === poi.id}
                        onClick={() => setHighlightedPoiId(poi.id)}
                      >
                        <span className="location-panel__poi-letter" aria-hidden="true">{letter}</span>
                        <span className="location-panel__poi-info">
                          <span className="location-panel__poi-name">{poi.name}</span>
                          <span className="location-panel__poi-meta">
                            {poi.metroLines.length > 0 && (
                              <span className="location-panel__poi-lines" aria-label="地铁线路">
                                {poi.metroLines.map((line) => (
                                  <span key={line} className="location-panel__poi-line-tag">{line}</span>
                                ))}
                              </span>
                            )}
                            <span className="location-panel__poi-distance">
                              <span className="location-panel__poi-distance-icon" aria-hidden="true">{DistanceIcon}</span>
                              {Math.round(poi.distanceMeters)} 米{poi.direction ? ` · ${poi.direction}` : ''}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
