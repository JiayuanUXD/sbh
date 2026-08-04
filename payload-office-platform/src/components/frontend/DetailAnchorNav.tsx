'use client'

import { useEffect, useMemo, useState } from 'react'

type AnchorItem = Readonly<{
  id: string
  label: string
  visible: boolean
}>

type DetailAnchorNavProps = Readonly<{
  items: readonly AnchorItem[]
}>

/** Sticky in-page navigation with active-section highlighting. */
export default function DetailAnchorNav({ items }: DetailAnchorNavProps) {
  const visibleItems = useMemo(() => items.filter((item) => item.visible), [items])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (visibleItems.length === 0) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const observer = new IntersectionObserver(
      (entries) => {
        // Find the visible entry with the highest intersection ratio
        let best: IntersectionObserverEntry | null = null
        for (const entry of entries) {
          if (entry.isIntersecting && (!best || entry.intersectionRatio > best.intersectionRatio)) {
            best = entry
          }
        }
        if (best) {
          setActiveId(best.target.id)
        }
      },
      {
        rootMargin: '-96px 0px -60% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    )

    for (const item of visibleItems) {
      const element = document.getElementById(item.id)
      if (element) observer.observe(element)
    }

    return () => observer.disconnect()
  }, [visibleItems])

  if (visibleItems.length === 0) return null

  return (
    <nav className="detail-anchor-nav detail-anchor-nav--sticky" aria-label="详情导航">
      <ul>
        {visibleItems.map((item) => {
          const isActive = activeId === item.id
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={isActive ? 'true' : undefined}
                data-active={isActive || undefined}
                onClick={(event) => {
                  event.preventDefault()
                  const target = document.getElementById(item.id)
                  if (!target) return
                  const prefersReducedMotion = window.matchMedia(
                    '(prefers-reduced-motion: reduce)',
                  ).matches
                  target.scrollIntoView({
                    behavior: prefersReducedMotion ? 'auto' : 'smooth',
                    block: 'start',
                  })
                  // Update URL hash without jumping
                  window.history.replaceState(null, '', `#${item.id}`)
                  setActiveId(item.id)
                }}
              >
                {item.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
