import React from 'react'

export type StatItem = Readonly<{ value: string; unit: string; caption: string }>

export default function StatHighlights({ items }: { items: readonly StatItem[] }) {
  return (
    <dl className="stat-highlights">
      {items.map((item) => (
        <div key={item.caption} className="stat-highlights__item">
          <dt className="stat-highlights__caption">{item.caption}</dt>
          <dd className="stat-highlights__value">
            {item.value}<span className="stat-highlights__unit">{item.unit}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}
