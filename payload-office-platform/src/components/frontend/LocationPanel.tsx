/**
 * 周边与交通面板
 *
 * 守护不变量：
 *   - 无坐标时整段不渲染（不留空地图容器/空清单面板）——这是硬约束，
 *     不是「缺省态展示占位」，与项目「不展示空货架」的既定立场一致
 *   - 无坐标 ≠ 地图加载失败：前者是我们没有这份数据（整段不出现）；
 *     后者是数据都在、只是高德脚本没起来（AmapMapCanvas 内部降级为
 *     「地图暂时不可用」文案），此时清单面板（周边 POI 列表，含交通类别
 *     下的地铁/公交站点）不依赖地图加载状态，仍要正常展示——本组件本身
 *     不渲染独立的地址/地铁摘要行，那些信息由页面其它区块负责
 *     （BuildingSummaryCard / HeroSummaryPanel / DetailGallery 无图替代构图）
 *   - POI 四类别语义 Tab，每类最多 5 项；点击 POI 高亮地图图钉
 *   - 地图与清单面板并排两列（并排布局见 detail.css .location-panel__grid），
 *     不用「清单浮层覆盖地图」的旧写法——mapEnabled=false 时地图区域没有
 *     内容，若靠浮层绝对定位，清单会因地图区域高度塌陷而错位；两列网格
 *     天然规避（两列各自按自身内容定高）
 *   - 地图图钉只画「当前列表正在展示的」POI（mapPois = activePois），
 *     字母与清单一一对应；不再是交通类地图恒画全量 subway+bus 而清单只筛
 *     子分类的旧写法——旧写法在两者字母对不上时会让「点清单第 A 项」与
 *     「地图上的 A 图钉」变成两个不同的点位，本次统一为同一份数据的两种呈现
 */

'use client'

import { useState } from 'react'
import AmapMapCanvas from '@/components/frontend/AmapMapCanvas'
import type { CoordinatesViewModel } from '@/domain/public-catalog'
import type { NearbyPoi, PoiCategory, TransportSubCategory } from '@/domain/location-services'
import { POI_LETTERS, type PoiByCategory } from '@/lib/frontend/location-pois'

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

  // 无坐标：整段不渲染，不留空地图容器或空清单面板。这是硬约束（见文件头
  // 「无坐标 ≠ 地图加载失败」），不是可选的缺省态——调用方（CityListingDetailView /
  // BuildingDetailLayout）都已经 `{building && <LocationPanel .../>}` 式接线，
  // 这里再兜底一层，避免坐标缺失时渲染出只有标题没有内容的空区块。
  if (!coordinates) return null

  const hasAnyPoi = POI_CATEGORY_TABS.some((tab) => pois[tab.key].length > 0)

  // 交通类按子分类（subway/bus）筛分；非交通类别整组透传
  const transportPois = pois.transport

  // 交通子 Tab 仅渲染有 POI 的子分类
  const visibleSubTabs = TRANSPORT_SUB_TABS.filter((tab) =>
    transportPois.some((poi) => poi.subCategory === tab.key),
  )

  /**
   * 实际生效的交通子分类。
   *
   * `activeSubCategory` 的 state 初值写死 `'subway'`，但「有交通 POI」不等于
   * 「有地铁 POI」：只有公交站没有地铁站的楼盘，交通 tab 显示「交通（5）」并
   * 选中，按 subway 一过滤却是空——而子 tab 需要 `> 1` 种子分类才渲染，用户
   * 连切过去的入口都没有，清单整块不渲染（计数说 5、列表空白）。Task 5 把
   * `mapPois` 从「交通类恒画全量 subway+bus」改成 `mapPois = activePois` 之后，
   * 地图图钉也跟着归零——改造前至少还画着那 5 个公交图钉。
   * 用派生值而不是改 useState 初值：`pois` 是 prop，可能在组件存活期间变化
   * （切换楼盘 / POI 迟到），初值只在首次渲染求一次，救不了后来的变化。
   */
  const effectiveSubCategory: TransportSubCategory =
    visibleSubTabs.some((tab) => tab.key === activeSubCategory)
      ? activeSubCategory
      : visibleSubTabs[0]?.key ?? activeSubCategory

  const transportSubPois = transportPois.filter(
    (poi) => poi.subCategory === effectiveSubCategory,
  )
  // 列表：交通类按子分类筛选，非交通类整组
  const activePois =
    activeCategory === 'transport' ? transportSubPois : pois[activeCategory]
  // 地图图钉 = 清单当前正在展示的同一份数据（见文件头说明）：地图上的字母
  // 图钉与清单行的字母锚点一一对应，不再是交通类地图恒画全量 subway+bus。
  const mapPois = activePois

  const hasSubTabs = activeCategory === 'transport' && visibleSubTabs.length > 1

  return (
    <section id="location" className="location-panel detail__section" aria-labelledby="location-title">
      <h2 id="location-title">周边与交通</h2>

      <div
        className={
          hasAnyPoi
            ? 'location-panel__grid'
            : 'location-panel__grid location-panel__grid--map-only'
        }
      >
        <div className="location-panel__map">
          <AmapMapCanvas
            coordinates={coordinates}
            pois={mapPois}
            mapEnabled={mapEnabled}
            highlightedPoiId={highlightedPoiId}
            buildingName={building.name}
          />
        </div>

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
                  const isActive = effectiveSubCategory === tab.key
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
