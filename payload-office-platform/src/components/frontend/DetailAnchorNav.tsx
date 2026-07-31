type AnchorItem = Readonly<{
  id: string
  label: string
  visible: boolean
}>

type DetailAnchorNavProps = Readonly<{
  items: readonly AnchorItem[]
}>

/** In-page navigation deliberately omits sections that have no visible content. */
export default function DetailAnchorNav({ items }: DetailAnchorNavProps) {
  const visibleItems = items.filter((item) => item.visible)
  if (visibleItems.length === 0) return null

  return (
    <nav className="detail-anchor-nav" aria-label="详情导航">
      <ul>
        {visibleItems.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`}>{item.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
