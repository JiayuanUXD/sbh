import type {
  BuildingSupplyGroupViewModel,
  BuildingSupplySnapshot,
  ListingCardViewModel,
} from '@/domain/public-catalog'

type BuildingSupplyBrowserProps = Readonly<{
  snapshot: BuildingSupplySnapshot
}>

const GROUP_LABEL: Record<BuildingSupplyGroupViewModel['key'], string> = {
  lease: '出租',
  sale: '出售',
  coworking: '联合办公',
}

function SupplyCard({ listing }: Readonly<{ listing: ListingCardViewModel }>) {
  const price = listing.price?.text ?? '价格面议'
  const metadata = [
    listing.area != null ? `${listing.area} ㎡` : null,
    listing.building?.name ?? null,
  ].filter((item): item is string => item != null)

  return (
    <article className="building-supply-browser__card">
      <h3>
        <a href={`/listings/${listing.slug}`}>{listing.title}</a>
      </h3>
      <p className="building-supply-browser__price">{price}</p>
      {metadata.length > 0 && <p>{metadata.join(' · ')}</p>}
    </article>
  )
}

/**
 * A progressively enhanced supply browser. Native GET submission keeps the
 * URL as the filtering source of truth; this component never re-sorts cards.
 */
export default function BuildingSupplyBrowser({ snapshot }: BuildingSupplyBrowserProps) {
  const groups = snapshot.groups.filter((group) => group.listings.length > 0)
  if (groups.length === 0) {
    return <p className="building-supply-browser__empty">该楼盘暂无可展示房源。</p>
  }

  return (
    <section className="building-supply-browser" aria-label="楼盘房源">
      <form method="get" className="building-supply-browser__filters">
        <fieldset>
          <legend>筛选房源</legend>
          <label>
            面积下限
            <input name="areaMin" type="number" min="0" inputMode="numeric" />
          </label>
          <label>
            面积上限
            <input name="areaMax" type="number" min="0" inputMode="numeric" />
          </label>
          <label>
            排序
            <select name="sort" defaultValue="recommended">
              <option value="recommended">推荐排序</option>
              <option value="area-asc">面积从小到大</option>
              <option value="area-desc">面积从大到小</option>
              <option value="price-asc">价格从低到高</option>
              <option value="price-desc">价格从高到低</option>
            </select>
          </label>
          <button type="submit">应用筛选</button>
        </fieldset>

        <nav className="building-supply-browser__tabs" aria-label="供给类型">
          {groups.map((group) => (
            <button
              key={group.key}
              type="submit"
              name="group"
              value={group.key}
              data-supply-tab={group.key}
            >
              {GROUP_LABEL[group.key]}
            </button>
          ))}
        </nav>
      </form>

      {groups.map((group) => (
        <details key={group.key} className="building-supply-browser__group" open>
          <summary>{GROUP_LABEL[group.key]}</summary>
          <div className="building-supply-browser__cards" data-supply-group={group.key}>
            {group.listings.map((listing) => (
              <SupplyCard key={listing.id} listing={listing} />
            ))}
          </div>
        </details>
      ))}
    </section>
  )
}
