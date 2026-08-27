import { parseListingQuery, serializeListingQuery } from '../domain/listing-query.js'

const LISTINGS_TAB_PATH = '/pages/listings/index'

export type SwitchTabOptions = Readonly<{
  url: typeof LISTINGS_TAB_PATH
  success(): void
  fail(error: unknown): void
}>

export type SwitchTabTransport = (options: SwitchTabOptions) => void

export type ListingNavigation = Readonly<{
  open(query: string): Promise<void>
  consume(): string | null
}>

type PendingNavigation = Readonly<{
  owner: symbol
  query: string
}>

function defaultSwitchTab(options: SwitchTabOptions): void {
  wx.switchTab({
    url: options.url,
    success: () => options.success(),
    fail: (error) => options.fail(error),
  })
}

export function createListingNavigation(
  switchTab: SwitchTabTransport = defaultSwitchTab,
): ListingNavigation {
  let pending: PendingNavigation | null = null

  return {
    open(query) {
      const owner = Symbol('listing-navigation')
      pending = {
        owner,
        query: serializeListingQuery(parseListingQuery(query)),
      }

      return new Promise<void>((resolve, reject) => {
        let settled = false
        const fail = (error: unknown) => {
          if (settled) return
          settled = true
          if (pending?.owner === owner) pending = null
          reject(error)
        }

        try {
          switchTab({
            url: LISTINGS_TAB_PATH,
            success() {
              if (settled) return
              settled = true
              resolve()
            },
            fail,
          })
        } catch (error) {
          fail(error)
        }
      })
    },

    consume() {
      const query = pending?.query ?? null
      pending = null
      return query
    },
  }
}

export const listingNavigation = createListingNavigation()
