import type { MiniListingCard } from '../services/catalog-contracts.js'

export type ListingCardPresentation = Readonly<{
  id: string
  slug: string
  title: string
  imageUrl: string
  imageAlt: string
  primaryPrice: string
  secondaryPrice: string
  facts: string
  location: string
  tags: readonly string[]
}>

const integerFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
})

function formatInteger(value: number): string {
  return integerFormatter.format(Math.round(value))
}

function compactFacts(card: MiniListingCard): string {
  return [
    card.area === null ? '' : `${formatInteger(card.area)} ㎡`,
    card.seats === null ? '' : `${formatInteger(card.seats)} 席`,
    card.listingType.label,
  ].filter(Boolean).join(' · ')
}

function compactLocation(card: MiniListingCard): string {
  const district = card.building?.district ?? ''
  const building = card.building?.name ?? ''
  return [district, building].filter(Boolean).join(' · ') || card.cityName
}

export function presentListingCard(card: MiniListingCard): ListingCardPresentation {
  const monthly = card.price?.monthlyEstimate

  return {
    id: card.id,
    slug: card.slug,
    title: card.title,
    imageUrl: card.coverImage?.src ?? '',
    imageAlt: card.coverImage?.alt || card.title,
    primaryPrice: monthly === null || monthly === undefined
      ? card.price?.text ?? '价格面议'
      : `约 ¥${formatInteger(monthly)}/月`,
    secondaryPrice: monthly === null || monthly === undefined ? '' : card.price?.text ?? '',
    facts: compactFacts(card),
    location: compactLocation(card),
    tags: card.highlights.slice(0, 3),
  }
}
