import type {
  BuildingSupplyInput,
  BuildingSupplyGroupViewModel,
  BuildingSupplySnapshot,
} from '@/domain/public-catalog'
import ListingCard from '@/components/frontend/ListingCard'

type BuildingSupplyBrowserProps = Readonly<{
  snapshot: BuildingSupplySnapshot
  /** Parsed URL inputs; values stay in the native GET form rather than client state. */
  input?: BuildingSupplyInput
}>

const GROUP_LABEL: Record<BuildingSupplyGroupViewModel['key'], string> = {
  lease: '出租',
  sale: '出售',
  coworking: '联合办公',
}

/**
 * A progressively enhanced supply browser. Native GET submission keeps the
 * URL as the filtering source of truth; this component never re-sorts cards.
 */
export default function BuildingSupplyBrowser({ snapshot, input = {} }: BuildingSupplyBrowserProps) {
  const groups = snapshot.groups.filter((group) => group.listings.length > 0)
  const hasPriceUnitRequired = snapshot.validationErrors.includes('price_unit_required')

  return (
    <section
      className="building-supply-browser"
      aria-label="楼盘房源"
      data-supply-as-of={snapshot.asOf}
    >
      <form method="get" className="building-supply-browser__filters">
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
          {groups.map((group) => {
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

      {groups.length === 0 ? <p className="building-supply-browser__empty">当前暂无公开可选空间</p> : (
        groups.map((group) => (
          <details key={group.key} className="building-supply-browser__group" open>
            <summary>{GROUP_LABEL[group.key]}</summary>
            <div className="building-supply-browser__cards" data-supply-group={group.key}>
              {group.listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} variant="building-supply" />
              ))}
            </div>
          </details>
        ))
      )}
    </section>
  )
}
