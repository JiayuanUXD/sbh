import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  parseListingQuery,
  type ListingQuery,
} from '../miniprogram/domain/listing-query.js'

type ApplyFilters = (query: ListingQuery) => Promise<void>

type ListingsPageContext = Readonly<{
  data: Readonly<{ query: ListingQuery }>
  ensureListingsController(): Readonly<{ applyFilters: ApplyFilters }>
}>

type ListingsPageRegistration = Readonly<{
  handleSearchSubmit: (
    this: ListingsPageContext,
    event: Readonly<{ detail: Readonly<{ value: string }> }>,
  ) => void
  handleToggleSort: (this: ListingsPageContext) => void
}>

let pageRegistration: ListingsPageRegistration | null = null
const showToast = vi.fn()

function registeredPage(): ListingsPageRegistration {
  if (pageRegistration === null) throw new Error('列表页未注册')
  return pageRegistration
}

function createContext(query: ListingQuery): Readonly<{
  context: ListingsPageContext
  applyFilters: ReturnType<typeof vi.fn<ApplyFilters>>
}> {
  const applyFilters = vi.fn<ApplyFilters>(() => Promise.resolve())
  return {
    context: {
      data: { query },
      ensureListingsController: () => ({ applyFilters }),
    },
    applyFilters,
  }
}

beforeAll(async () => {
  vi.stubGlobal('Page', (registration: ListingsPageRegistration) => {
    pageRegistration = registration
  })
  vi.stubGlobal('wx', {
    showToast,
  })
  await import('../miniprogram/pages/listings/index.js')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('房源列表真实页面行为', () => {
  it('搜索提交用 q 替换旧搜索并把页码归一到第一页', () => {
    const { context, applyFilters } = createContext(parseListingQuery('q=旧词&page=3'))

    registeredPage().handleSearchSubmit.call(context, { detail: { value: ' 南京西路 ' } })

    expect(applyFilters).toHaveBeenCalledOnce()
    expect(applyFilters).toHaveBeenCalledWith(expect.objectContaining({
      q: '南京西路',
      page: 1,
    }))
    expect(applyFilters.mock.calls[0]?.[0]).not.toHaveProperty('keyword')
  })

  it('未选择计价单位时价格排序保持 recommended 并提示先选单位', () => {
    const { context, applyFilters } = createContext(parseListingQuery('sort=price-desc'))

    registeredPage().handleToggleSort.call(context)

    expect(context.data.query.sort).toBe('recommended')
    expect(applyFilters).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
      title: '请先选择计价单位',
      icon: 'none',
    }))
  })

  it.each([
    ['recommended', 'price-asc'],
    ['price-asc', 'price-desc'],
    ['price-desc', 'price-asc'],
  ] as const)('已选单位时把 %s 切换为 %s', (currentSort, expectedSort) => {
    const { context, applyFilters } = createContext(parseListingQuery(
      `priceUnit=rmb-month${currentSort === 'recommended' ? '' : `&sort=${currentSort}`}`,
    ))

    registeredPage().handleToggleSort.call(context)

    expect(applyFilters).toHaveBeenCalledOnce()
    expect(applyFilters).toHaveBeenCalledWith(expect.objectContaining({
      priceUnit: 'rmb-month',
      sort: expectedSort,
      page: 1,
    }))
  })
})
