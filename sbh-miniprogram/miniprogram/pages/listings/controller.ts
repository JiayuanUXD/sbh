import {
  nextPageQuery,
  parseListingQuery,
  serializeListingQuery,
  type ListingQuery,
} from '../../domain/listing-query.js'
import {
  loadRelaxations,
  type RelaxationSuggestion,
} from '../../domain/relaxations.js'
import type {
  MiniListingCard,
  MiniListingsData,
  MiniQuickFilter,
} from '../../services/catalog-contracts.js'

export type ListingsLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export type ListingsLoadMode = 'replace' | 'append'

export type ListingsSnapshot = Readonly<{
  state: ListingsLoadState
  query: ListingQuery
  items: readonly MiniListingCard[]
  filters: readonly MiniQuickFilter[]
  pagination: MiniListingsData['pagination'] | null
  totalDocs: number
  refreshing: boolean
  refreshError: boolean
  loadingMore: boolean
  loadMoreError: boolean
  relaxations: readonly RelaxationSuggestion[]
  loadingRelaxations: boolean
  estimating: boolean
  estimateUnavailable: boolean
  estimatedCount: number
}>

export type ListingsControllerDependencies = Readonly<{
  getListings(query: string): Promise<MiniListingsData>
  onChange?(snapshot: ListingsSnapshot): void
  stopPullDownRefresh?(): void
}>

export type ListingsController = Readonly<{
  load(query: ListingQuery, mode?: ListingsLoadMode): Promise<void>
  refresh(): Promise<void>
  applyFilters(query: ListingQuery): Promise<void>
  estimateDraft(query: ListingQuery): void
  cancelEstimate(): void
  loadNextPage(): Promise<void>
  applyRelaxation(query: string): Promise<void>
  snapshot(): ListingsSnapshot
  dispose(): void
}>

function initialListingsSnapshot(): ListingsSnapshot {
  return {
    state: 'idle',
    query: parseListingQuery(''),
    items: [],
    filters: [],
    pagination: null,
    totalDocs: 0,
    refreshing: false,
    refreshError: false,
    loadingMore: false,
    loadMoreError: false,
    relaxations: [],
    loadingRelaxations: false,
    estimating: false,
    estimateUnavailable: false,
    estimatedCount: 0,
  }
}

function dedupeListings(
  current: readonly MiniListingCard[],
  incoming: readonly MiniListingCard[],
): readonly MiniListingCard[] {
  const seen = new Set(current.map((item) => item.id))
  const merged = [...current]
  for (const item of incoming) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }
  return merged
}

function preservedState(snapshot: ListingsSnapshot): ListingsLoadState {
  if (snapshot.items.length > 0) return 'ready'
  return snapshot.state === 'error' ? 'error' : 'empty'
}

export function createListingsController(
  dependencies: ListingsControllerDependencies,
): ListingsController {
  let requestVersion = 0
  let estimateVersion = 0
  let estimateTimer: ReturnType<typeof setTimeout> | null = null
  let estimateSessionActive = false
  let pullDownRefreshPending = false
  let current = initialListingsSnapshot()

  function publish(next: ListingsSnapshot): void {
    current = next
    dependencies.onChange?.(next)
  }

  function beginLoad(query: ListingQuery, mode: ListingsLoadMode | 'refresh'): void {
    if (mode === 'replace') {
      publish({
        ...current,
        state: 'loading',
        query,
        items: [],
        pagination: null,
        totalDocs: 0,
        refreshing: false,
        refreshError: false,
        loadingMore: false,
        loadMoreError: false,
        relaxations: [],
        loadingRelaxations: false,
      })
      return
    }

    if (mode === 'refresh') {
      publish({
        ...current,
        refreshing: true,
        refreshError: false,
        loadingMore: false,
        loadMoreError: false,
      })
      return
    }

    publish({
      ...current,
      loadingMore: true,
      loadMoreError: false,
    })
  }

  function receiveListings(
    result: MiniListingsData,
    mode: ListingsLoadMode | 'refresh',
  ): void {
    const items = mode === 'append'
      ? dedupeListings(current.items, result.items)
      : result.items
    const state: ListingsLoadState = items.length > 0 ? 'ready' : 'empty'
    const settledEstimate = estimateSessionActive
      ? {}
      : {
          estimating: false,
          estimateUnavailable: false,
          estimatedCount: result.pagination.totalDocs,
        }
    publish({
      ...current,
      state,
      query: parseListingQuery(result.canonicalQuery),
      items,
      filters: result.filters,
      pagination: result.pagination,
      totalDocs: result.pagination.totalDocs,
      refreshing: false,
      refreshError: false,
      loadingMore: false,
      loadMoreError: false,
      relaxations: [],
      loadingRelaxations: state === 'empty',
      ...settledEstimate,
    })
  }

  function receiveListingsError(mode: ListingsLoadMode | 'refresh'): void {
    if (mode === 'replace') {
      publish({
        ...current,
        state: 'error',
        items: [],
        pagination: null,
        totalDocs: 0,
        refreshing: false,
        loadingMore: false,
        loadingRelaxations: false,
      })
      return
    }

    if (mode === 'refresh') {
      publish({
        ...current,
        state: preservedState(current),
        refreshing: false,
        refreshError: true,
        loadingMore: false,
        loadingRelaxations: false,
      })
      return
    }

    publish({
      ...current,
      state: preservedState(current),
      loadingMore: false,
      loadMoreError: true,
    })
  }

  async function performLoad(
    query: ListingQuery,
    mode: ListingsLoadMode | 'refresh',
  ): Promise<void> {
    const owner = requestVersion + 1
    requestVersion = owner
    if (mode === 'refresh') pullDownRefreshPending = true
    beginLoad(query, mode)

    try {
      const result = await dependencies.getListings(serializeListingQuery(query))
      if (owner !== requestVersion) return
      receiveListings(result, mode)

      if (current.state === 'empty') {
        const canonicalQuery = current.query
        const suggestions = await loadRelaxations(canonicalQuery, dependencies.getListings)
        if (owner !== requestVersion) return
        publish({
          ...current,
          relaxations: suggestions,
          loadingRelaxations: false,
        })
      }
    } catch {
      if (owner !== requestVersion) return
      receiveListingsError(mode)
    } finally {
      if (owner === requestVersion && pullDownRefreshPending) {
        pullDownRefreshPending = false
        dependencies.stopPullDownRefresh?.()
      }
    }
  }

  function cancelEstimate(): void {
    const sessionWasActive = estimateSessionActive
    estimateSessionActive = false
    estimateVersion += 1
    if (estimateTimer !== null) {
      clearTimeout(estimateTimer)
      estimateTimer = null
    }
    if (
      sessionWasActive
      || current.estimating
      || current.estimateUnavailable
      || current.estimatedCount !== current.totalDocs
    ) {
      publish({
        ...current,
        estimating: false,
        estimateUnavailable: false,
        estimatedCount: current.totalDocs,
      })
    }
  }

  return {
    load(query, mode = 'replace') {
      if (mode === 'replace') cancelEstimate()
      return performLoad(query, mode)
    },

    refresh() {
      if (current.state === 'idle' || current.state === 'loading') {
        pullDownRefreshPending = false
        dependencies.stopPullDownRefresh?.()
        return Promise.resolve()
      }
      return performLoad(nextPageQuery(current.query, 1), 'refresh')
    },

    applyFilters(query) {
      cancelEstimate()
      return performLoad(nextPageQuery(query, 1), 'replace')
    },

    estimateDraft(query) {
      if (estimateTimer !== null) clearTimeout(estimateTimer)
      const owner = estimateVersion + 1
      estimateVersion = owner
      estimateSessionActive = true
      publish({
        ...current,
        estimating: true,
        estimateUnavailable: false,
        estimatedCount: 0,
      })
      estimateTimer = setTimeout(() => {
        estimateTimer = null
        void dependencies.getListings(serializeListingQuery(query)).then((result) => {
          if (owner !== estimateVersion || !estimateSessionActive) return
          publish({
            ...current,
            estimating: false,
            estimateUnavailable: false,
            estimatedCount: result.pagination.totalDocs,
          })
        }).catch(() => {
          if (owner !== estimateVersion || !estimateSessionActive) return
          publish({
            ...current,
            estimating: false,
            estimateUnavailable: true,
            estimatedCount: 0,
          })
        })
      }, 250)
    },

    cancelEstimate,

    loadNextPage() {
      if (
        current.state !== 'ready'
        || current.refreshing
        || current.loadingMore
        || current.pagination?.hasNextPage !== true
      ) {
        return Promise.resolve()
      }
      return performLoad(nextPageQuery(current.query, current.pagination.page + 1), 'append')
    },

    applyRelaxation(query) {
      cancelEstimate()
      return performLoad(nextPageQuery(parseListingQuery(query), 1), 'replace')
    },

    snapshot() {
      return current
    },

    dispose() {
      requestVersion += 1
      pullDownRefreshPending = false
      estimateVersion += 1
      estimateSessionActive = false
      if (estimateTimer !== null) {
        clearTimeout(estimateTimer)
        estimateTimer = null
      }
      current = {
        ...current,
        estimating: false,
        estimateUnavailable: false,
        estimatedCount: current.totalDocs,
      }
    },
  }
}
