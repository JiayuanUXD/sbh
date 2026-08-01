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
import RoutePlanner from '@/components/frontend/RoutePlanner'
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
  { key: 'transport', label: '交通', icon: 'transport' },
  { key: 'restaurant', label: '餐饮', icon: 'restaurant' },
  { key: 'bank', label: '银行', icon: 'bank' },
  { key: 'hotel', label: '酒店', icon: 'hotel' },
] as const

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
        {/* P2：用户主动触发的路线建议（点击后才一次性定位），拒绝/失败保留外链 */}
        {coordinates && (
          <RoutePlanner
            destination={coordinates}
            destinationName={building.name}
            amapLinkUrl={buildAmapPlaceUrl(building.name, coordinates)}
          />
        )}
      </div>

      {/* 地图区 + POI 浮动面板：地图占满宽度，POI 面板绝对定位浮在右侧 */}
      <div className="location-panel__map-area">
        <AmapMapCanvas
          coordinates={coordinates}
          pois={activePois}
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
                          <span className="location-panel__poi-distance">
                            <span className="location-panel__poi-distance-icon" aria-hidden="true">{DistanceIcon}</span>
                            {Math.round(poi.distanceMeters)} 米{poi.direction ? ` · ${poi.direction}` : ''}
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
