import type { ListingQuery } from '../../domain/listing-query.js'

function asQuery(value: unknown): Partial<ListingQuery> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Partial<ListingQuery>
    : {}
}

function activeState(value: unknown) {
  const query = asQuery(value)
  return {
    locationActive: Array.isArray(query.district) && query.district.length > 0,
    priceActive: query.priceUnit !== undefined
      || query.priceMin !== undefined
      || query.priceMax !== undefined,
    areaActive: query.areaMin !== undefined || query.areaMax !== undefined,
  }
}

Component({
  properties: {
    query: {
      type: Object,
      value: null,
      observer(query: unknown) {
        this.setData(activeState(query))
      },
    },
    activeCount: {
      type: Number,
      value: 0,
      observer(activeCount: number) {
        this.setData({ allActive: activeCount > 0 })
      },
    },
  },
  data: {
    locationActive: false,
    priceActive: false,
    areaActive: false,
    allActive: false,
  },
  methods: {
    handleOpen(event: WechatMiniprogram.BaseEvent) {
      const section = event.currentTarget.dataset.section
      if (section !== 'location' && section !== 'price' && section !== 'area' && section !== 'all') {
        return
      }
      this.triggerEvent('open', { section })
    },
  },
})
