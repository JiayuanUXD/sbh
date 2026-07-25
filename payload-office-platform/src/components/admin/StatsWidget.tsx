import type { WidgetServerProps } from 'payload'

import DashboardOverview from './DashboardOverview'

export default async function StatsWidget({ req }: WidgetServerProps) {
  const [
    listings,
    availableListings,
    featuredListings,
    listingsWithoutCover,
    buildings,
    leads,
    newLeads,
    activeLeads,
  ] = await Promise.all([
    req.payload.count({ collection: 'listings', overrideAccess: false, req }),
    req.payload.count({
      collection: 'listings',
      overrideAccess: false,
      req,
      where: { status: { equals: 'available' } },
    }),
    req.payload.count({
      collection: 'listings',
      overrideAccess: false,
      req,
      where: { isFeatured: { equals: true } },
    }),
    req.payload.count({
      collection: 'listings',
      overrideAccess: false,
      req,
      where: { coverImage: { exists: false } },
    }),
    req.payload.count({ collection: 'buildings', overrideAccess: false, req }),
    req.payload.count({ collection: 'leads', overrideAccess: false, req }),
    req.payload.count({
      collection: 'leads',
      overrideAccess: false,
      req,
      where: { status: { equals: 'new' } },
    }),
    req.payload.count({
      collection: 'leads',
      overrideAccess: false,
      req,
      where: { status: { in: ['contacted', 'visited'] } },
    }),
  ])

  return (
    <DashboardOverview
      availableListings={availableListings.totalDocs}
      buildings={buildings.totalDocs}
      activeLeads={activeLeads.totalDocs}
      featuredListings={featuredListings.totalDocs}
      leads={leads.totalDocs}
      listings={listings.totalDocs}
      listingsWithoutCover={listingsWithoutCover.totalDocs}
      newLeads={newLeads.totalDocs}
    />
  )
}
