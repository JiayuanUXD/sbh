'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type {
  BuildingSupplyGroup,
  BuildingSupplyGroupViewModel,
  BuildingSupplySnapshot,
  ListingCardViewModel,
} from '@/domain/public-catalog'
import ListingCard from '@/components/frontend/ListingCard'
import { DECORATION_STATUS_LABELS } from '@/domain/review/listing-fields'
import { formatAvailableDate } from '@/lib/frontend/format'
import { buildHref, cloneSearchParams } from '@/lib/frontend/listing-url'
import { DISPLAY_UNIT_LABELS, estimateRowTotal, formatGroupTotal } from '@/components/frontend/building-detail/supply-summary'

/**
 * 楼盘详情供给密度表（OPT-037 Task 7，方案 A：分组切换 + 密度表）。
 *
 * 改造而非重写——这是唯一承载真实供给浏览行为的组件，行为丢失比版式偏差贵：
 *   - 移动端沿用既有 `ListingCard variant="building-supply"` 卡片（真实图片/
 *     亮点标签/点击埋点），comp 稿对应「移动供给行」是无图两行卡，但那是
 *     未经验证的新样式；`.building-supply-browser__table` 是否渲染与
 *     `[data-listing-card-variant="building-supply"]` 是否渲染已被
 *     `tests/e2e/detail-pages.spec.ts`「窄屏楼盘供给始终使用卡片」锁定为
 *     真实产品行为，本次不因为一份静态 comp 就推翻它；
 *   - `data-supply-as-of` / `data-detail-analytics-*` 埋点属性原样保留；
 *   - 「查看更多」的**原地展开**交互保留（而非改成导航到另一个页面）。
 *
 * 这次真正的改造，是把「组切换 / 筛选 / 排序」从纯客户端 state（旧版
 * `AREA_BUCKETS` / `PRICE_BUCKETS` 是 `useState`，刷新即丢、无法分享）纠正为
 * URL 驱动：`domain/public-catalog/building-supply.ts` 的 `buildBuildingSupplySnapshot`
 * 早就支持 `group` / `areaMin` / `areaMax` / `decorationStatus` / `availableBefore`
 * / `priceUnit` / `sort`，页面层 `parseBuildingSupplySearchParams` 也早就在解析
 * 这些 query（连 e2e 都已经在用 `?group=lease` 跑无横向溢出测试），只是这个
 * 组件此前完全没读它们、自己另起一套内存态重新实现了一遍面积/价格分桶
 * ——两套判断逻辑并存但只有一套真正接到 URL。本次收敛为只用 URL 那一套，
 * 删掉客户端重复实现。
 *
 * URL 参数与 `search-params.ts` 的 `parseBuildingSupplySearchParams` /
 * `buildBuildingSupplyCanonicalSearchParams` 同名，不新造第三套命名。
 * `currentSearch` 由页面层用 canonical 参数序列化后传入（而非反射原始
 * searchParams）——非法/过期参数不会被带着走一遍；`URLSearchParams` 实例本身
 * 不作为 prop 跨 Server→Client 边界传递（Next.js 只保证少数内置类型可安全
 * 序列化，自定义/内置的非 POJO 类不在保证范围内），改传字符串，组件内部
 * 自己 `new URLSearchParams(currentSearch)`。
 */

type BuildingSupplyBrowserProps = Readonly<{
  snapshot: BuildingSupplySnapshot
  /** Immutable public DTO ID used for anonymous analytics only. */
  buildingId?: number
  citySlug?: string
  /** 楼盘详情页自身路径（含 citySlug 段），组切换/筛选/排序 href 的落点。 */
  basePath: string
  /** canonical query string（不含 `?`），见文件头注释。 */
  currentSearch: string
}>

const GROUP_ORDER: readonly BuildingSupplyGroup[] = ['lease', 'sale', 'coworking']

function isBuildingSupplyGroup(value: string | null): value is BuildingSupplyGroup {
  return value === 'lease' || value === 'sale' || value === 'coworking'
}

const GROUP_TAB_LABEL: Record<BuildingSupplyGroup, string> = {
  lease: '租赁',
  sale: '出售',
  coworking: '联合办公',
}

/** 组聚合区文案口径：三组的「面积/工位」维度与「可入驻」量词各不相同。 */
const AGG_LABELS: Record<
  BuildingSupplyGroup,
  { price: string; metric: string; metricUnit: string; immediate: string; immediateUnit: string }
> = {
  lease: { price: '单价区间', metric: '面积区间', metricUnit: '㎡', immediate: '可即刻入驻', immediateUnit: '套' },
  sale: { price: '单价区间', metric: '面积区间', metricUnit: '㎡', immediate: '可即时过户', immediateUnit: '套' },
  coworking: {
    price: '工位单价区间',
    metric: '可选工位',
    metricUnit: '个',
    immediate: '可即刻入驻',
    immediateUnit: '个空间',
  },
}

/** 表头文案口径：租赁/出售按面积计，联合办公按工位计；月租与总价单位不同。 */
function columnLabels(group: BuildingSupplyGroup, unitLabel: string | null) {
  const priceLabel = unitLabel ? `单价 ${unitLabel}` : '单价'
  if (group === 'sale') {
    return { metric: '面积 ㎡', price: priceLabel, total: '总价 万元', status: '装修' }
  }
  if (group === 'coworking') {
    return { metric: '工位数', price: priceLabel, total: '月租 元/月', status: '可入驻' }
  }
  return { metric: '面积 ㎡', price: priceLabel, total: '月租 元/月', status: '可入驻' }
}

function formatRange(min: number, max: number): string {
  const fmt = (n: number) => n.toLocaleString('zh-CN')
  return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount)
    ? amount.toLocaleString('zh-CN')
    : amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 可选工位区间：domain 的 `areaRange` 只按 `card.area` 聚合，联合办公需要按
 * `card.seats` 单独算——两者聚合对象不同（面积 vs 工位数），不是同一份能收敛
 * 的判断逻辑，因此没有复用 `building-supply.ts` 里的 `buildAreaRange`。 */
function seatRange(listings: readonly ListingCardViewModel[]): { min: number; max: number } | null {
  const seats = listings
    .map((l) => l.seats)
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s) && s >= 0)
  if (seats.length === 0) return null
  return { min: Math.min(...seats), max: Math.max(...seats) }
}

type AggCell = { label: string; value: string; unit: string }

function buildAggregation(group: BuildingSupplyGroup, data: BuildingSupplyGroupViewModel): readonly AggCell[] {
  const labels = AGG_LABELS[group]
  const priceRanges = data.priceRanges
  const priceCell: AggCell =
    priceRanges.length === 0
      ? { label: labels.price, value: '—', unit: '' }
      : priceRanges.length === 1
        ? {
            label: labels.price,
            value: formatRange(priceRanges[0].min, priceRanges[0].max),
            unit: DISPLAY_UNIT_LABELS[priceRanges[0].displayUnit],
          }
        : { label: labels.price, value: '多种单位', unit: '' }
  const metricRange = group === 'coworking' ? seatRange(data.listings) : data.areaRange
  const metricCell: AggCell = metricRange
    ? { label: labels.metric, value: formatRange(metricRange.min, metricRange.max), unit: labels.metricUnit }
    : { label: labels.metric, value: '—', unit: '' }
  const immediateCell: AggCell = {
    label: labels.immediate,
    value: String(data.immediateAvailabilityCount),
    unit: labels.immediateUnit,
  }
  return [priceCell, metricCell, immediateCell]
}

/** 面积筛选桶——沿用改造前 `AREA_BUCKETS` 的边界值（已用过、不重新拍脑袋），
 * 只是把命中判据从客户端 state 换成 `areaMin`/`areaMax` query。 */
const AREA_BUCKETS = [
  { key: 'all', label: '全部', min: undefined, max: undefined },
  { key: '0-100', label: '0–100 ㎡', min: 0, max: 100 },
  { key: '100-300', label: '100–300 ㎡', min: 100, max: 300 },
  { key: '300-500', label: '300–500 ㎡', min: 300, max: 500 },
  { key: '500-1000', label: '500–1000 ㎡', min: 500, max: 1000 },
  { key: '1000+', label: '1000 ㎡ 以上', min: 1000, max: undefined },
] as const satisfies ReadonlyArray<{ key: string; label: string; min?: number; max?: number }>

const DEFAULT_VISIBLE_TABLE = 8
const DEFAULT_VISIBLE_CARDS = 5

/** 供给行「可入驻/装修」列：出售没有真实的产权/租约状态字段（`Listings`
 * collection 只有「产权年限」，与 comp 的「可过户/带租约」不是一回事），
 * 诚实降级为展示装修状态；租赁/联合办公按 availableFrom 判断可即刻/具体日期。
 * 集中在这一个函数里，避免可入驻判断在多处分别实现。 */
function buildStatusCell(
  group: BuildingSupplyGroup,
  listing: ListingCardViewModel,
  asOf: string,
): { text: string; emphasized: boolean } {
  if (group === 'sale') {
    const label = listing.decorationStatus ? DECORATION_STATUS_LABELS[listing.decorationStatus] : null
    return { text: label ?? '—', emphasized: false }
  }
  if (!listing.availableFrom) return { text: '可即刻', emphasized: true }
  const availableAt = Date.parse(listing.availableFrom)
  const snapshotAt = Date.parse(asOf)
  const immediate = Number.isFinite(availableAt) && Number.isFinite(snapshotAt) && availableAt <= snapshotAt
  return immediate ? { text: '可即刻', emphasized: true } : { text: formatAvailableDate(listing.availableFrom), emphasized: false }
}

export default function BuildingSupplyBrowser({
  snapshot,
  buildingId,
  citySlug,
  basePath,
  currentSearch,
}: BuildingSupplyBrowserProps) {
  const [isMobile, setIsMobile] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // 组切换/筛选/排序任一变化都应该重新展示默认条数——旧的「展开」态属于上一次
  // 结果集，带到新结果集里没有意义（甚至可能超出新结果集长度）。用 render 期间
  // 调整状态（React 官方推荐的「根据 prop 变化调整 state」写法），而不是在
  // effect 里调用 setState 触发二次渲染。
  const [prevSearch, setPrevSearch] = useState(currentSearch)
  if (currentSearch !== prevSearch) {
    setPrevSearch(currentSearch)
    setExpanded(false)
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const syncViewport = () => setIsMobile(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  const currentParams = useMemo(() => new URLSearchParams(currentSearch), [currentSearch])

  const availableGroups = snapshot.availableGroups.filter((g) => g.totalEffectiveListings > 0)

  if (availableGroups.length === 0) {
    return (
      <section className="building-supply-browser" aria-label="楼盘房源" data-supply-as-of={snapshot.asOf}>
        <p className="building-supply-browser__empty">当前暂无公开可选空间</p>
      </section>
    )
  }

  const requestedGroup = currentParams.get('group')
  const defaultGroupKey = availableGroups[0]!.key
  const activeGroupKey: BuildingSupplyGroup =
    isBuildingSupplyGroup(requestedGroup) && availableGroups.some((g) => g.key === requestedGroup)
      ? requestedGroup
      : defaultGroupKey

  function hrefForGroup(key: BuildingSupplyGroup): string {
    const sp = new URLSearchParams()
    if (key !== defaultGroupKey) sp.set('group', key)
    return buildHref(basePath, sp)
  }

  function hrefWithParam(key: string, value: string | null): string {
    const sp = cloneSearchParams(currentParams)
    if (value == null) sp.delete(key)
    else sp.set(key, value)
    return buildHref(basePath, sp)
  }

  const activeAvailability = availableGroups.find((g) => g.key === activeGroupKey)!
  const activeGroupData = snapshot.groups.find((g) => g.key === activeGroupKey) ?? null

  const asOfDate = snapshot.asOf.slice(0, 10)
  const immediateActive = currentParams.get('availableBefore') === asOfDate
  const activeAreaMin = currentParams.get('areaMin')
  const activeAreaMax = currentParams.get('areaMax')
  const activeAreaBucketKey = AREA_BUCKETS.find((b) => {
    const wantMin = b.min != null ? String(b.min) : null
    const wantMax = b.max != null ? String(b.max) : null
    return wantMin === activeAreaMin && wantMax === activeAreaMax
  })?.key ?? 'all'

  const activeSort = currentParams.get('sort') ?? 'recommended'
  const priceUnits = Array.from(new Set(activeAvailability.priceRanges.map((r) => r.displayUnit)))
  const singleUnitLabel = priceUnits.length === 1 ? DISPLAY_UNIT_LABELS[priceUnits[0]!] : null
  const canSortByPrice = priceUnits.length === 1

  const sortOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'recommended', label: '推荐排序' },
    { value: 'area-asc', label: '面积从小到大' },
    { value: 'area-desc', label: '面积从大到小' },
    ...(canSortByPrice
      ? [
          { value: 'price-asc', label: '单价从低到高' },
          { value: 'price-desc', label: '单价从高到低' },
        ]
      : []),
  ]

  return (
    <section className="building-supply-browser" aria-label="楼盘房源" data-supply-as-of={snapshot.asOf}>
      <div className="building-supply-browser__tabs" role="group" aria-label="按业务组切换">
        {availableGroups.map((g) => {
          const isActive = g.key === activeGroupKey
          return (
            <Link
              key={g.key}
              href={hrefForGroup(g.key)}
              aria-current={isActive ? 'true' : undefined}
              className="building-supply-browser__tab"
              data-active={isActive || undefined}
              prefetch={false}
            >
              <span>{GROUP_TAB_LABEL[g.key]}</span>
              <span className="building-supply-browser__tab-count">{g.totalEffectiveListings}</span>
            </Link>
          )
        })}
      </div>

      {activeGroupData === null ? (
        <p className="building-supply-browser__empty">当前筛选下暂无匹配空间</p>
      ) : (
        <div className="building-supply-browser__panel">
          <div className="building-supply-browser__agg">
            {buildAggregation(activeGroupKey, activeGroupData).map((cell) => (
              <div key={cell.label} className="building-supply-browser__agg-item">
                <span className="building-supply-browser__agg-label">{cell.label}</span>
                <span className="building-supply-browser__agg-value-row">
                  <span className="building-supply-browser__agg-value tabular">{cell.value}</span>
                  {cell.unit && <span className="building-supply-browser__agg-unit">{cell.unit}</span>}
                </span>
              </div>
            ))}
          </div>

          <div className="building-supply-browser__controls">
            <div className="building-supply-browser__filter-group" role="group" aria-label="按面积筛选">
              <span className="building-supply-browser__filter-label">面积</span>
              {AREA_BUCKETS.map((bucket) => {
                const isActive = bucket.key === activeAreaBucketKey
                const sp = cloneSearchParams(currentParams)
                sp.delete('areaMin')
                sp.delete('areaMax')
                if (bucket.min != null) sp.set('areaMin', String(bucket.min))
                if (bucket.max != null) sp.set('areaMax', String(bucket.max))
                return (
                  <Link
                    key={bucket.key}
                    href={buildHref(basePath, sp)}
                    className="building-supply-browser__filter"
                    data-active={isActive || undefined}
                    aria-current={isActive ? 'true' : undefined}
                    prefetch={false}
                  >
                    {bucket.label}
                  </Link>
                )
              })}
            </div>
            {activeAvailability.immediateAvailabilityCount > 0 && (
              <Link
                href={hrefWithParam('availableBefore', immediateActive ? null : asOfDate)}
                className="building-supply-browser__filter"
                data-active={immediateActive || undefined}
                aria-current={immediateActive ? 'true' : undefined}
                prefetch={false}
              >
                可即刻入驻
              </Link>
            )}
            <div className="building-supply-browser__sort" role="group" aria-label="排序">
              <span className="building-supply-browser__filter-label">排序</span>
              {sortOptions.map((option) => {
                const isActive = option.value === activeSort
                return (
                  <Link
                    key={option.value}
                    href={hrefWithParam('sort', option.value === 'recommended' ? null : option.value)}
                    className="building-supply-browser__sort-option"
                    aria-current={isActive ? 'true' : undefined}
                    data-active={isActive || undefined}
                    prefetch={false}
                  >
                    {option.label}
                  </Link>
                )
              })}
            </div>
          </div>
          {snapshot.validationErrors.includes('price_unit_required') && (
            <p className="building-supply-browser__notice">该组内房源计价单位不唯一，暂按推荐顺序排列</p>
          )}

          {(() => {
            const listings = activeGroupData.listings
            if (listings.length === 0) {
              return <p className="building-supply-browser__empty">当前筛选下暂无匹配空间</p>
            }
            const cols = columnLabels(activeGroupKey, singleUnitLabel)
            const defaultVisible = isMobile ? DEFAULT_VISIBLE_CARDS : DEFAULT_VISIBLE_TABLE
            const visibleListings = expanded ? listings : listings.slice(0, defaultVisible)
            const hiddenCount = listings.length - visibleListings.length

            return (
              <>
                {isMobile ? (
                  <div className="building-supply-browser__cards">
                    {visibleListings.map((listing, index) => (
                      <ListingCard
                        key={`${activeGroupKey}:${listing.id}`}
                        listing={listing}
                        citySlug={citySlug}
                        variant="building-supply"
                        detailAnalytics={
                          buildingId
                            ? {
                                event: 'building_listing_click',
                                parentId: buildingId,
                                rank: index + 1,
                                section: 'supply',
                                supplyGroup: activeGroupKey,
                              }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="building-supply-browser__table-wrap">
                    <table className="building-supply-browser__table">
                      <caption className="visually-hidden">{GROUP_TAB_LABEL[activeGroupKey]}房源列表</caption>
                      {/* 百分比而非 px：comp 的 1fr/130/150/176/120/44 是 1180 容器
                          （面板内可用宽 1116）下的字面量，换算成同比例的百分比列宽
                          （styles.css .building-supply-browser__table 头部注释解释了
                          为什么不能用 px min-width/width 兜底窄容器）。 */}
                      <colgroup>
                        <col />
                        <col style={{ width: '11.65%' }} />
                        <col style={{ width: '13.44%' }} />
                        <col style={{ width: '15.77%' }} />
                        <col style={{ width: '10.75%' }} />
                        <col style={{ width: '3.94%' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th scope="col">房源</th>
                          <th scope="col" className="building-supply-browser__table-num-head">{cols.metric}</th>
                          <th scope="col" className="building-supply-browser__table-num-head">{cols.price}</th>
                          <th scope="col" className="building-supply-browser__table-num-head">{cols.total}</th>
                          <th scope="col">{cols.status}</th>
                          <th scope="col"><span className="visually-hidden">详情</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleListings.map((listing, index) => {
                          const metricValue =
                            activeGroupKey === 'coworking'
                              ? listing.seats != null
                                ? listing.seats.toLocaleString('zh-CN')
                                : '—'
                              : listing.area != null
                                ? listing.area.toLocaleString('zh-CN')
                                : '—'
                          const singleUnit = singleUnitLabel != null
                          const priceCell = listing.price
                            ? singleUnit
                              ? formatAmount(listing.price.amount)
                              : listing.price.text
                            : '—'
                          const total = estimateRowTotal(listing.price, { area: listing.area, seats: listing.seats })
                          const totalCell = total != null ? formatGroupTotal(total, activeGroupKey) : '—'
                          const status = buildStatusCell(activeGroupKey, listing, snapshot.asOf)
                          const sub = [
                            listing.floor ? `${listing.floor} 层` : null,
                            listing.decorationStatus ? DECORATION_STATUS_LABELS[listing.decorationStatus] : null,
                          ]
                            .filter((part): part is string => Boolean(part))
                            .join(' · ')
                          const detailHref = `${citySlug ? `/${citySlug}` : ''}/listings/${encodeURIComponent(listing.slug)}`
                          return (
                            <tr key={`${activeGroupKey}:${listing.id}`}>
                              <td>
                                <span className="building-supply-browser__table-primary">{listing.title}</span>
                                {sub && <span className="building-supply-browser__table-sub">{sub}</span>}
                              </td>
                              <td className="tabular building-supply-browser__table-num">{metricValue}</td>
                              <td className="tabular building-supply-browser__table-num">{priceCell}</td>
                              <td className="tabular building-supply-browser__table-num building-supply-browser__table-total">
                                {totalCell}
                              </td>
                              <td>
                                <span
                                  className="building-supply-browser__table-status"
                                  data-emphasized={status.emphasized || undefined}
                                >
                                  {status.text}
                                </span>
                              </td>
                              <td>
                                <a
                                  href={detailHref}
                                  className="building-supply-browser__table-link"
                                  aria-label={`查看${listing.title}详情`}
                                  data-detail-analytics-event={buildingId ? 'building_listing_click' : undefined}
                                  data-analytics-parent-id={buildingId}
                                  data-analytics-listing-id={buildingId ? listing.id : undefined}
                                  data-analytics-supply-group={buildingId ? activeGroupKey : undefined}
                                  data-analytics-rank={buildingId ? index + 1 : undefined}
                                  data-analytics-section={buildingId ? 'supply' : undefined}
                                >
                                  <svg width="9" height="14" viewBox="0 0 10 16" aria-hidden="true">
                                    <path
                                      d="M2 1l6 7-6 7"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      fill="none"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </a>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="building-supply-browser__footer">
                  {hiddenCount > 0 && (
                    <button type="button" className="building-supply-browser__more" onClick={() => setExpanded(true)}>
                      展开其余 {hiddenCount} 套
                    </button>
                  )}
                  <span className="building-supply-browser__footnote">
                    本组 {listings.length} / 共 {activeAvailability.totalEffectiveListings} 套已按当前筛选与排序生成
                  </span>
                </div>
              </>
            )
          })()}
        </div>
      )}
    </section>
  )
}
