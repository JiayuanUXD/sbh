import {
  presentListingDetail,
  type ListingDetailPresentation,
} from '../../domain/listing-detail-presentation.js'
import type {
  MiniListingCard,
  MiniListingDetailData,
} from '../../services/catalog-contracts.js'
import { MiniApiError } from '../../services/mini-api-error.js'

export type ListingDetailState =
  | 'loading'
  | 'ready'
  | 'refreshing'
  | 'stale'
  | 'error'
  | 'not-found'

export type ListingDetailSnapshot = Readonly<{
  state: ListingDetailState
  slug: string
  content: ListingDetailPresentation | null
  fallbackListings: readonly MiniListingCard[]
  loadingFallback: boolean
}>

export type ListingDetailControllerDependencies = Readonly<{
  getListingDetail(slug: string): Promise<MiniListingDetailData>
  getFallbackListings(): Promise<readonly MiniListingCard[]>
  onChange?(snapshot: ListingDetailSnapshot): void
  stopPullDownRefresh?(): void
}>

export type ListingDetailController = Readonly<{
  load(slug: string): Promise<void>
  refresh(): Promise<void>
  snapshot(): ListingDetailSnapshot
  dispose(): void
}>

function isListingNotFound(error: unknown): boolean {
  return error instanceof MiniApiError && error.code === 'listing_not_found'
}

function selectFallbackListings(
  listings: readonly MiniListingCard[],
  excludedSlug: string,
): readonly MiniListingCard[] {
  const selected: MiniListingCard[] = []
  const seenSlugs = new Set<string>()

  for (const listing of listings) {
    if (listing.slug === excludedSlug || seenSlugs.has(listing.slug)) continue
    seenSlugs.add(listing.slug)
    selected.push(listing)
    if (selected.length === 3) break
  }

  return selected
}

export function createListingDetailController(
  dependencies: ListingDetailControllerDependencies,
): ListingDetailController {
  let requestVersion = 0
  let current: ListingDetailSnapshot = {
    state: 'loading',
    slug: '',
    content: null,
    fallbackListings: [],
    loadingFallback: false,
  }

  function publish(snapshot: ListingDetailSnapshot): void {
    current = snapshot
    dependencies.onChange?.(snapshot)
  }

  async function performLoad(slug: string, refresh: boolean): Promise<void> {
    const owner = requestVersion + 1
    requestVersion = owner
    const retainedContent = refresh && current.slug === slug ? current.content : null

    publish({
      state: retainedContent === null ? 'loading' : 'refreshing',
      slug,
      content: retainedContent,
      fallbackListings: [],
      loadingFallback: false,
    })

    try {
      const detail = await dependencies.getListingDetail(slug)
      if (owner !== requestVersion) return
      publish({
        state: 'ready',
        slug,
        content: presentListingDetail(detail),
        fallbackListings: [],
        loadingFallback: false,
      })
    } catch (error) {
      if (owner !== requestVersion) return

      if (isListingNotFound(error)) {
        publish({
          state: 'not-found',
          slug,
          content: null,
          fallbackListings: [],
          loadingFallback: true,
        })
        try {
          const fallbackListings = await dependencies.getFallbackListings()
          if (owner !== requestVersion) return
          publish({
            state: 'not-found',
            slug,
            content: null,
            fallbackListings: selectFallbackListings(fallbackListings, slug),
            loadingFallback: false,
          })
        } catch {
          if (owner !== requestVersion) return
          publish({
            state: 'not-found',
            slug,
            content: null,
            fallbackListings: [],
            loadingFallback: false,
          })
        }
      } else if (retainedContent !== null) {
        publish({
          state: 'stale',
          slug,
          content: retainedContent,
          fallbackListings: [],
          loadingFallback: false,
        })
      } else {
        publish({
          state: 'error',
          slug,
          content: null,
          fallbackListings: [],
          loadingFallback: false,
        })
      }
    } finally {
      if (refresh && owner === requestVersion) {
        dependencies.stopPullDownRefresh?.()
      }
    }
  }

  return {
    load(slug) {
      return performLoad(slug, false)
    },

    refresh() {
      if (current.content === null || current.state === 'refreshing') {
        dependencies.stopPullDownRefresh?.()
        return Promise.resolve()
      }
      return performLoad(current.slug, true)
    },

    snapshot() {
      return current
    },

    dispose() {
      requestVersion += 1
    },
  }
}
