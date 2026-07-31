'use client'

import { useEffect, useState } from 'react'
import type {
  BuildingSupplyInput,
  BuildingSupplyGroupViewModel,
  BuildingSupplySnapshot,
} from '@/domain/public-catalog'
import ListingCard from '@/components/frontend/ListingCard'
import { track } from '@/lib/frontend/analytics'

type BuildingSupplyBrowserProps = Readonly<{
  snapshot: BuildingSupplySnapshot
  /** Immutable public DTO ID used for anonymous analytics only. */
  buildingId?: number
  /** Parsed URL inputs; values stay in the native GET form rather than client state. */
  input?: BuildingSupplyInput
}>

const GROUP_LABEL: Record<BuildingSupplyGroupViewModel['key'], string> = {
  lease: '出租',
  sale: '出售',
  coworking: '联合办公',
}

const SUPPLY_GROUP_VALUES = ['lease', 'sale', 'coworking'] as const
const SORT_VALUES = ['recommended', 'area-asc', 'area-desc', 'price-asc', 'price-desc'] as const
const PRICE_UNIT_VALUES = ['rmb-sqm-day', 'rmb-month', 'rmb-seat-month', 'rmb-total'] as const
const DECORATION_VALUES = ['rough', 'simple', 'furnished', 'fully_fitted'] as const

type SupplyFormSubmitter = Readonly<{
  isCurrentFormButton: boolean
  name: string
  value: string
}>

function safeEnumValue<const T extends readonly string[]>(formData: FormData, name: string, values: T): T[number] | undefined {
  const value = formData.get(name)
  return typeof value === 'string' && values.includes(value) ? value as T[number] : undefined
}

function hasSubmittedValue(formData: FormData, name: string): boolean {
  const value = formData.get(name)
  return typeof value === 'string' && value.trim() !== ''
}

function safeGroupSubmitter(submitter: SupplyFormSubmitter | undefined): BuildingSupplyGroupViewModel['key'] | undefined {
  if (!submitter?.isCurrentFormButton || submitter.name !== 'group') return undefined
  return SUPPLY_GROUP_VALUES.includes(submitter.value as BuildingSupplyGroupViewModel['key'])
    ? submitter.value as BuildingSupplyGroupViewModel['key']
    : undefined
}

function hasNativeSubmitter(event: Event): event is SubmitEvent {
  return 'submitter' in event
}

function currentFormButtonSubmitter(form: HTMLFormElement, nativeEvent: Event): SupplyFormSubmitter | undefined {
  if (!hasNativeSubmitter(nativeEvent)) return undefined
  const submitter = nativeEvent.submitter
  if (!(submitter instanceof HTMLButtonElement) || submitter.form !== form) return undefined
  return { isCurrentFormButton: true, name: submitter.name, value: submitter.value }
}

/** Returns only aggregate/filter-enum analytics props; never raw filter values. */
export function getSupplyFilterAnalyticsProps(
  buildingId: number,
  snapshot: BuildingSupplySnapshot,
  formData: FormData,
  submitter?: SupplyFormSubmitter,
): Record<string, string | number> {
  const group = safeGroupSubmitter(submitter) ?? safeEnumValue(formData, 'group', SUPPLY_GROUP_VALUES)
  const sort = safeEnumValue(formData, 'sort', SORT_VALUES) ?? 'recommended'
  const priceUnit = safeEnumValue(formData, 'priceUnit', PRICE_UNIT_VALUES)
  const decorationStatus = safeEnumValue(formData, 'decorationStatus', DECORATION_VALUES)
  const filterCompleteness = Number(hasSubmittedValue(formData, 'areaMin') || hasSubmittedValue(formData, 'areaMax')) +
    Number(hasSubmittedValue(formData, 'availableBefore'))

  return {
    building_id: buildingId,
    ...(group ? { supply_group: group } : {}),
    sort,
    ...(priceUnit ? { price_unit: priceUnit } : {}),
    ...(decorationStatus ? { decoration_status: decorationStatus } : {}),
    result_count: snapshot.resultCount,
    as_of: snapshot.asOf,
    filter_completeness: filterCompleteness,
  }
}

/**
 * A progressively enhanced supply browser. Native GET submission keeps the
 * URL as the filtering source of truth; this component never re-sorts cards.
 */
export default function BuildingSupplyBrowser({ snapshot, buildingId, input = {} }: BuildingSupplyBrowserProps) {
  const groups = snapshot.groups.filter((group) => group.listings.length > 0)
  const availableGroups = snapshot.availableGroups.filter((group) => group.totalEffectiveListings > 0)
  const hasPriceUnitRequired = snapshot.validationErrors.includes('price_unit_required')
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('table')
  const [isMobile, setIsMobile] = useState(false)

  // The view selector is purely presentational. Supply/filter state remains
  // server-derived from the native GET URL, and narrow screens always render cards.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const syncViewport = () => {
      setIsMobile(mediaQuery.matches)
      if (mediaQuery.matches) setViewMode('cards')
    }
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  const isTableView = viewMode === 'table' && !isMobile

  return (
    <section
      className="building-supply-browser"
      aria-label="楼盘房源"
      data-supply-as-of={snapshot.asOf}
    >
      <form
        method="get"
        className="building-supply-browser__filters"
        onSubmit={(event) => {
          if (typeof buildingId !== 'number' || !Number.isSafeInteger(buildingId) || buildingId <= 0) return
          const form = event.currentTarget
          track('supply_filter', getSupplyFilterAnalyticsProps(
            buildingId,
            snapshot,
            new FormData(form),
            currentFormButtonSubmitter(form, event.nativeEvent),
          ))
        }}
      >
        <fieldset>
          <legend>筛选房源</legend>
          <label>
            面积下限
            <input name="areaMin" type="number" min="0" inputMode="numeric" defaultValue={input.areaMin} />
          </label>
          <label>
            面积上限
            <input name="areaMax" type="number" min="0" inputMode="numeric" defaultValue={input.areaMax} />
          </label>
          <label>
            装修状态
            <select name="decorationStatus" defaultValue={input.decorationStatus ?? ''}>
              <option value="">不限</option>
              <option value="rough">毛坯</option>
              <option value="simple">简装</option>
              <option value="furnished">精装</option>
              <option value="fully_fitted">拎包入住</option>
            </select>
          </label>
          <label>
            最晚可入驻日期
            <input name="availableBefore" type="date" defaultValue={input.availableBefore} />
          </label>
          <label>
            价格单位
            <select name="priceUnit" defaultValue={input.priceUnit ?? ''}>
              <option value="">不限</option>
              <option value="rmb-sqm-day">元/㎡/天</option>
              <option value="rmb-month">元/月</option>
              <option value="rmb-seat-month">元/工位/月</option>
              <option value="rmb-total">总价</option>
            </select>
          </label>
          <label>
            排序
            <select
              name="sort"
              defaultValue={input.sort ?? 'recommended'}
              aria-describedby={hasPriceUnitRequired ? 'building-supply-price-sort-hint' : undefined}
            >
              <option value="recommended">推荐排序</option>
              <option value="area-asc">面积从小到大</option>
              <option value="area-desc">面积从大到小</option>
              <option value="price-asc">价格从低到高</option>
              <option value="price-desc">价格从高到低</option>
            </select>
          </label>
          <button type="submit">应用筛选</button>
        </fieldset>

        {hasPriceUnitRequired && (
          <p id="building-supply-price-sort-hint" role="status" aria-live="polite">
            请选择价格单位后再按价格排序；当前按稳定默认顺序显示。
          </p>
        )}

        <nav
          className="building-supply-browser__tabs"
          aria-label={input.group ? '按供给类型筛选' : '按供给类型筛选，当前显示全部供给类型'}
        >
          {availableGroups.map((group) => {
            const isCurrent = input.group === group.key
            const label = GROUP_LABEL[group.key]
            return (
              <button
                key={group.key}
                data-supply-tab={group.key}
                type="submit"
                name="group"
                value={group.key}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={isCurrent ? `按${label}筛选（当前筛选）` : `按${label}筛选`}
              >
                {label}
              </button>
            )
          })}
        </nav>
      </form>

      {groups.length === 0 ? (
        <p className="building-supply-browser__empty">
          {availableGroups.length === 0 ? '当前暂无公开可选空间' : '当前筛选下暂无匹配空间'}
        </p>
      ) : (
        <>
          {!isMobile && (
            <div className="building-supply-browser__view-toggle" role="group" aria-label="供给展示方式">
              <button
                type="button"
                aria-pressed={!isTableView}
                onClick={() => setViewMode('cards')}
              >
                卡片视图
              </button>
              <button
                type="button"
                aria-pressed={isTableView}
                onClick={() => setViewMode('table')}
              >
                表格视图
              </button>
            </div>
          )}
          {groups.map((group) => (
            <details key={group.key} className="building-supply-browser__group" open>
              <summary>{GROUP_LABEL[group.key]}</summary>
              {isTableView ? (
                <div className="building-supply-browser__table-wrap" data-supply-group={group.key}>
                  <table className="building-supply-browser__table">
                    <caption>{GROUP_LABEL[group.key]}供给列表</caption>
                    <thead>
                      <tr>
                        <th scope="col">房源</th>
                        <th scope="col">面积</th>
                        <th scope="col">价格</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.listings.map((listing, index) => (
                        <tr key={`${group.key}:${listing.id}`}>
                          <td>
                            <a
                              href={`/listings/${listing.slug}`}
                              data-detail-analytics-event={buildingId ? 'building_listing_click' : undefined}
                              data-analytics-parent-id={buildingId}
                              data-analytics-listing-id={buildingId ? listing.id : undefined}
                              data-analytics-supply-group={buildingId ? group.key : undefined}
                              data-analytics-rank={buildingId ? index + 1 : undefined}
                              data-analytics-section={buildingId ? 'supply' : undefined}
                            >
                              {listing.title}
                            </a>
                          </td>
                          <td>{listing.area == null ? '—' : `${listing.area} ㎡`}</td>
                          <td>{listing.price?.text ?? '价格面议'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="building-supply-browser__cards" data-supply-group={group.key}>
                  {group.listings.map((listing, index) => (
                    <ListingCard
                      key={`${group.key}:${listing.id}`}
                      listing={listing}
                      variant="building-supply"
                      detailAnalytics={buildingId ? {
                        event: 'building_listing_click',
                        parentId: buildingId,
                        rank: index + 1,
                        section: 'supply',
                        supplyGroup: group.key,
                      } : undefined}
                    />
                  ))}
                </div>
              )}
            </details>
          ))}
        </>
      )}
    </section>
  )
}
