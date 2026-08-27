import {
  applyListingPatch,
  LISTING_TYPES,
  PRICE_DISPLAY_UNITS,
} from '../../domain/listing-query.js'
import type {
  ListingQuery,
  ListingQueryPatch,
  ListingType,
  PriceDisplayUnit,
} from '../../domain/listing-query.js'
import type { MiniQuickFilter } from '../../services/catalog-contracts.js'

type FilterSection = 'location' | 'price' | 'area' | 'all'

type DisplayOption = Readonly<{
  value: string
  label: string
  count: number
  active: boolean
}>

const EMPTY_QUERY: ListingQuery = {
  sort: 'recommended',
  page: 1,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneListingQuery(value: unknown): ListingQuery {
  if (!isRecord(value)) return { ...EMPTY_QUERY }
  const query = value as unknown as ListingQuery
  return {
    ...query,
    ...(Array.isArray(query.district) ? { district: [...query.district] } : {}),
    ...(Array.isArray(query.type) ? { type: [...query.type] } : {}),
  }
}

function isQuickFilter(value: unknown): value is MiniQuickFilter {
  if (
    !isRecord(value)
    || typeof value.label !== 'string'
    || value.label.trim() === ''
    || !Array.isArray(value.options)
  ) return false
  return value.id === 'district' || value.id === 'listingType' || value.id === 'priceUnit'
}

function isQuickFilterOption(
  value: unknown,
): value is MiniQuickFilter['options'][number] {
  return isRecord(value)
    && typeof value.value === 'string'
    && value.value.trim() !== ''
    && typeof value.label === 'string'
    && value.label.trim() !== ''
    && typeof value.count === 'number'
    && Number.isSafeInteger(value.count)
    && value.count >= 0
}

function quickFilters(value: unknown): readonly MiniQuickFilter[] {
  return Array.isArray(value) ? value.filter(isQuickFilter) : []
}

function displayOptions(
  filters: unknown,
  id: MiniQuickFilter['id'],
  selected: readonly string[],
): DisplayOption[] {
  const filter = quickFilters(filters).find((candidate) => candidate.id === id)
  if (!filter) return []
  return filter.options
    .filter(isQuickFilterOption)
    .map((option) => ({
      value: option.value,
      label: option.label,
      count: option.count,
      active: selected.includes(option.value),
    }))
}

function optionProjection(filters: unknown, draft: ListingQuery) {
  return {
    districtOptions: displayOptions(filters, 'district', draft.district ?? []),
    typeOptions: displayOptions(filters, 'listingType', draft.type ?? []),
    unitOptions: displayOptions(filters, 'priceUnit', draft.priceUnit ? [draft.priceUnit] : []),
  }
}

function isValidListingType(value: unknown): value is ListingType {
  return typeof value === 'string' && (LISTING_TYPES as readonly string[]).includes(value)
}

function isValidPriceDisplayUnit(value: unknown): value is PriceDisplayUnit {
  return typeof value === 'string' && (PRICE_DISPLAY_UNITS as readonly string[]).includes(value)
}

function hasProjectedOption(options: readonly DisplayOption[], value: unknown): value is string {
  return typeof value === 'string' && options.some((option) => option.value === value)
}

function inputNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function toggled(values: readonly string[] | undefined, value: string): readonly string[] | undefined {
  const current = values ?? []
  if (current.includes(value)) {
    const next = current.filter((candidate) => candidate !== value)
    return next.length > 0 ? next : undefined
  }
  return [...current, value]
}

Component({
  properties: {
    open: {
      type: Boolean,
      value: false,
    },
    section: {
      type: String,
      value: 'all',
      observer(value: string) {
        const resolvedSection: FilterSection = value === 'location'
          || value === 'price'
          || value === 'area'
          ? value
          : 'all'
        this.setData({ resolvedSection })
      },
    },
    query: {
      type: Object,
      value: null,
    },
    filters: {
      type: Array,
      value: [],
    },
    resultCount: {
      type: Number,
      value: 0,
    },
    estimating: {
      type: Boolean,
      value: false,
    },
    estimateUnavailable: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    resolvedSection: 'all' as FilterSection,
    observedOpen: false,
    draft: { ...EMPTY_QUERY } as ListingQuery,
    districtOptions: [] as DisplayOption[],
    typeOptions: [] as DisplayOption[],
    unitOptions: [] as DisplayOption[],
  },
  observers: {
    'open, query'(open: boolean, query: unknown) {
      if (!open) {
        if (this.data.observedOpen) this.setData({ observedOpen: false })
        return
      }
      if (this.data.observedOpen) return
      const draft = cloneListingQuery(query)
      this.setData({
        observedOpen: true,
        draft,
        ...optionProjection(this.data.filters, draft),
      })
    },
    filters(filters: unknown) {
      this.setData(optionProjection(filters, cloneListingQuery(this.data.draft)))
    },
  },
  methods: {
    updateDraft(patch: ListingQueryPatch) {
      const draft = applyListingPatch(cloneListingQuery(this.data.draft), patch)
      this.setData({
        draft,
        ...optionProjection(this.data.filters, draft),
      })
      this.triggerEvent('estimate', { query: cloneListingQuery(draft) })
    },
    handlePriceUnit(event: WechatMiniprogram.BaseEvent) {
      const value = event.currentTarget.dataset.value
      if (
        !hasProjectedOption(this.data.unitOptions, value)
        || !isValidPriceDisplayUnit(value)
        || value === this.data.draft.priceUnit
      ) return
      this.updateDraft({
        priceUnit: value,
        priceMin: undefined,
        priceMax: undefined,
      })
    },
    handleDistrict(event: WechatMiniprogram.BaseEvent) {
      const value = event.currentTarget.dataset.value
      if (!hasProjectedOption(this.data.districtOptions, value)) return
      this.updateDraft({ district: toggled(this.data.draft.district, value) })
    },
    handleType(event: WechatMiniprogram.BaseEvent) {
      const value = event.currentTarget.dataset.value
      if (!hasProjectedOption(this.data.typeOptions, value) || !isValidListingType(value)) return
      this.updateDraft({
        type: toggled(this.data.draft.type, value)?.filter(isValidListingType),
      })
    },
    handlePriceInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const value = inputNumber(event.detail.value)
      const field = event.currentTarget.dataset.field
      if (field === 'priceMin') this.updateDraft({ priceMin: value })
      if (field === 'priceMax') this.updateDraft({ priceMax: value })
    },
    handleAreaInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const value = inputNumber(event.detail.value)
      const field = event.currentTarget.dataset.field
      if (field === 'areaMin') this.updateDraft({ areaMin: value })
      if (field === 'areaMax') this.updateDraft({ areaMax: value })
    },
    handleAvailableBefore(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      this.updateDraft({ availableBefore: event.detail.value || undefined })
    },
    handleClear() {
      const current = cloneListingQuery(this.data.draft)
      const draft: ListingQuery = {
        ...EMPTY_QUERY,
        ...(current.priceUnit ? { priceUnit: current.priceUnit } : {}),
      }
      this.setData({
        draft,
        ...optionProjection(this.data.filters, draft),
      })
      this.triggerEvent('clear', { query: cloneListingQuery(draft) })
      this.triggerEvent('estimate', { query: cloneListingQuery(draft) })
    },
    handleApply() {
      if (this.data.estimating || this.data.estimateUnavailable) return
      this.triggerEvent('apply', { query: cloneListingQuery(this.data.draft) })
    },
    handleClose() {
      this.triggerEvent('close')
    },
    handlePanelTap() {
      // `catchtap` 只用于阻止面板内点击穿透到遮罩。
    },
    handleBackdropTouchMove() {
      // `catchtouchmove` 阻止遮罩上的拖动滚动底层列表。
    },
  },
})
