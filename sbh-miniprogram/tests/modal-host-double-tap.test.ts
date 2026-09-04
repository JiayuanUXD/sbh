import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

type InquiryRegistration = Readonly<{
  handleOpenInquiry: (this: InquiryContext) => Promise<void>
  handleInquiryClose(this: InquiryContext): void
  onHide(this: InquiryContext): void
  onShow(this: InquiryContext): void
}>

type FilterRegistration = Readonly<{
  handleOpenFilter: (
    this: FilterContext,
    event: Readonly<{ detail: Readonly<{ section: string }> }>,
  ) => Promise<void>
  onHide(this: FilterContext): void
  onShow(this: FilterContext): void
  handleFilterClose(this: FilterContext): void
}>

type InquiryContext = {
  data: { inquiryOpen: boolean }
  inquiryOpenPromise: Promise<void> | null
  inquirySheetController: InquiryController | null
  modalOpenGeneration: number
  pageActive: boolean
  showModalTabBarBoundary(): Promise<boolean>
  ensureInquirySheetController(): Readonly<{ open(context: unknown): Promise<void> }>
  restoreModalTabBarBoundary(): Promise<boolean>
  closeInquiryForLifecycle(): void
}

type InquiryController = Readonly<{
  open(context: unknown): Promise<void>
  close(): void
  snapshot(): Readonly<{ state: string }>
}>

type FilterContext = {
  data: { sheetOpen: boolean; totalDocs: number }
  filterOpenPromise: Promise<void> | null
  modalOpenGeneration: number
  pageActive: boolean
  hasLoaded: boolean
  listingsController: Readonly<{ cancelEstimate(): void }> | null
  showModalTabBarBoundary(): Promise<boolean>
  restoreModalTabBarBoundary(): Promise<boolean>
  ensureListingsController(): Readonly<{ load(query: unknown): Promise<void> }>
  setData(data: Readonly<Record<string, unknown>>): void
}

function deferredBoolean(): Readonly<{ promise: Promise<boolean>; resolve(value: boolean): void }> {
  let resolve!: (value: boolean) => void
  const promise = new Promise<boolean>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const registrations: unknown[] = []
const showToast = vi.fn()

beforeAll(async () => {
  vi.stubGlobal('Page', (registration: unknown) => { registrations.push(registration) })
  vi.stubGlobal('wx', { showToast })
  await import('../miniprogram/pages/home/index.js')
  await import('../miniprogram/pages/buildings/index.js')
  await import('../miniprogram/pages/listings/index.js')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('抽屉宿主快速双击', () => {
  it.each([
    ['首页', 0],
    ['楼盘页', 1],
  ] as const)('%s 每次重新进入都尝试恢复原生 TabBar', (_label, index) => {
    const restoreModalTabBarBoundary = vi.fn(async () => false)
    const context: InquiryContext = {
      data: { inquiryOpen: false },
      inquiryOpenPromise: null,
      inquirySheetController: null,
      modalOpenGeneration: 0,
      pageActive: false,
      showModalTabBarBoundary: async () => true,
      ensureInquirySheetController: () => ({ open: async () => undefined }),
      restoreModalTabBarBoundary,
      closeInquiryForLifecycle: vi.fn(),
    }

    const registration = registrations[index] as InquiryRegistration
    registration.onShow.call(context)

    expect(context.pageActive).toBe(true)
    expect(restoreModalTabBarBoundary).toHaveBeenCalledOnce()
  })

  it('找房页每次重新进入都尝试恢复原生 TabBar', () => {
    const restoreModalTabBarBoundary = vi.fn(async () => false)
    const context: FilterContext = {
      data: { sheetOpen: false, totalDocs: 4 },
      filterOpenPromise: null,
      modalOpenGeneration: 0,
      pageActive: false,
      hasLoaded: true,
      listingsController: { cancelEstimate: vi.fn() },
      showModalTabBarBoundary: async () => true,
      restoreModalTabBarBoundary,
      ensureListingsController: () => ({ load: async () => undefined }),
      setData: vi.fn(),
    }

    const registration = registrations[2] as FilterRegistration
    registration.onShow.call(context)

    expect(context.pageActive).toBe(true)
    expect(restoreModalTabBarBoundary).toHaveBeenCalledOnce()
  })

  it.each([
    ['首页', 0],
    ['楼盘页', 1],
  ] as const)('%s 只隐藏一次 TabBar 并只打开一次咨询 controller', async (_label, index) => {
    const gate = deferredBoolean()
    const showModalTabBarBoundary = vi.fn(() => gate.promise)
    const open = vi.fn(async () => undefined)
    const context: InquiryContext = {
      data: { inquiryOpen: false },
      inquiryOpenPromise: null,
      inquirySheetController: null,
      modalOpenGeneration: 0,
      pageActive: true,
      showModalTabBarBoundary,
      ensureInquirySheetController: () => ({ open }),
      restoreModalTabBarBoundary: async () => true,
      closeInquiryForLifecycle: vi.fn(),
    }
    const registration = registrations[index] as InquiryRegistration

    const first = registration.handleOpenInquiry.call(context)
    const second = registration.handleOpenInquiry.call(context)
    gate.resolve(true)
    await Promise.all([first, second])

    expect(showModalTabBarBoundary).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledOnce()
    expect(context.inquiryOpenPromise).toBeNull()
  })

  it('找房页只隐藏一次 TabBar 并只打开一次同一筛选分区', async () => {
    const gate = deferredBoolean()
    const showModalTabBarBoundary = vi.fn(() => gate.promise)
    const setData = vi.fn((update: Readonly<Record<string, unknown>>) => {
      if (typeof update.sheetOpen === 'boolean') context.data.sheetOpen = update.sheetOpen
    })
    const context: FilterContext = {
      data: { sheetOpen: false, totalDocs: 4 },
      filterOpenPromise: null,
      modalOpenGeneration: 0,
      pageActive: true,
      hasLoaded: true,
      listingsController: { cancelEstimate: vi.fn() },
      showModalTabBarBoundary,
      restoreModalTabBarBoundary: async () => true,
      ensureListingsController: () => ({ load: async () => undefined }),
      setData,
    }
    const registration = registrations[2] as FilterRegistration
    const event = { detail: { section: 'price' } } as const

    const first = registration.handleOpenFilter.call(context, event)
    const second = registration.handleOpenFilter.call(context, event)
    gate.resolve(true)
    await Promise.all([first, second])

    expect(showModalTabBarBoundary).toHaveBeenCalledOnce()
    expect(setData).toHaveBeenCalledOnce()
    expect(context.data.sheetOpen).toBe(true)
    expect(context.filterOpenPromise).toBeNull()
  })

  it.each([
    ['首页', 0],
    ['楼盘页', 1],
  ] as const)('%s 的迟到 hide 不会在离场后弹 toast 或打开抽屉，返回后可立即重试', async (_label, index) => {
    showToast.mockClear()
    const firstGate = deferredBoolean()
    const secondGate = deferredBoolean()
    const showModalTabBarBoundary = vi.fn()
      .mockImplementationOnce(() => firstGate.promise)
      .mockImplementationOnce(() => secondGate.promise)
    const open = vi.fn(async () => undefined)
    const context: InquiryContext = {
      data: { inquiryOpen: false },
      inquiryOpenPromise: null,
      inquirySheetController: null,
      modalOpenGeneration: 0,
      pageActive: true,
      showModalTabBarBoundary,
      ensureInquirySheetController: () => ({ open }),
      restoreModalTabBarBoundary: async () => true,
      closeInquiryForLifecycle: vi.fn(),
    }
    const registration = registrations[index] as InquiryRegistration

    const staleOpening = registration.handleOpenInquiry.call(context)
    registration.onHide.call(context)
    registration.onShow.call(context)
    const currentOpening = registration.handleOpenInquiry.call(context)
    firstGate.resolve(true)
    await staleOpening
    expect(open).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
    secondGate.resolve(true)
    await currentOpening

    expect(showModalTabBarBoundary).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledOnce()
    expect(showToast).not.toHaveBeenCalled()
    expect(context.pageActive).toBe(true)
  })

  it.each([
    ['首页', 0],
    ['楼盘页', 1],
  ] as const)('%s 在 preparing 关闭后可立即创建新意图，旧完成不会清掉新抽屉', async (_label, index) => {
    const staleIntent = deferredBoolean()
    let controllerState = 'closed'
    const open = vi.fn(() => {
      controllerState = 'preparing'
      context.data.inquiryOpen = true
      return open.mock.calls.length === 1 ? staleIntent.promise.then(() => undefined) : Promise.resolve()
    })
    const controller: InquiryController = {
      open,
      close: () => {
        controllerState = 'closed'
        context.data.inquiryOpen = false
      },
      snapshot: () => ({ state: controllerState }),
    }
    const restoreModalTabBarBoundary = vi.fn(async () => true)
    const context: InquiryContext = {
      data: { inquiryOpen: false },
      inquiryOpenPromise: null,
      inquirySheetController: controller,
      modalOpenGeneration: 0,
      pageActive: true,
      showModalTabBarBoundary: async () => true,
      ensureInquirySheetController: () => controller,
      restoreModalTabBarBoundary,
      closeInquiryForLifecycle: vi.fn(),
    }
    const registration = registrations[index] as InquiryRegistration

    await registration.handleOpenInquiry.call(context)
    expect(controllerState).toBe('preparing')
    expect(context.inquiryOpenPromise).toBeNull()
    registration.handleInquiryClose.call(context)
    expect(restoreModalTabBarBoundary).toHaveBeenCalledOnce()
    await registration.handleOpenInquiry.call(context)
    expect(open).toHaveBeenCalledTimes(2)
    expect(context.data.inquiryOpen).toBe(true)

    staleIntent.resolve(true)
    await staleIntent.promise
    expect(context.data.inquiryOpen).toBe(true)
  })

  it('找房页关闭筛选时尝试恢复原生 TabBar', () => {
    const restoreModalTabBarBoundary = vi.fn(async () => false)
    const cancelEstimate = vi.fn()
    const context: FilterContext = {
      data: { sheetOpen: true, totalDocs: 4 },
      filterOpenPromise: null,
      modalOpenGeneration: 0,
      pageActive: true,
      hasLoaded: true,
      listingsController: { cancelEstimate },
      showModalTabBarBoundary: async () => true,
      restoreModalTabBarBoundary,
      ensureListingsController: () => ({ load: async () => undefined, cancelEstimate }),
      setData: (update) => {
        if (typeof update.sheetOpen === 'boolean') context.data.sheetOpen = update.sheetOpen
      },
    }

    const registration = registrations[2] as FilterRegistration
    registration.handleFilterClose.call(context)

    expect(context.data.sheetOpen).toBe(false)
    expect(cancelEstimate).toHaveBeenCalledOnce()
    expect(restoreModalTabBarBoundary).toHaveBeenCalledOnce()
  })

  it('找房页迟到 hide 不会离场后打开筛选，返回后可立即重试', async () => {
    showToast.mockClear()
    const firstGate = deferredBoolean()
    const secondGate = deferredBoolean()
    const showModalTabBarBoundary = vi.fn()
      .mockImplementationOnce(() => firstGate.promise)
      .mockImplementationOnce(() => secondGate.promise)
    const updates: Readonly<Record<string, unknown>>[] = []
    const context: FilterContext = {
      data: { sheetOpen: false, totalDocs: 4 },
      filterOpenPromise: null,
      modalOpenGeneration: 0,
      pageActive: true,
      hasLoaded: true,
      listingsController: { cancelEstimate: vi.fn() },
      showModalTabBarBoundary,
      restoreModalTabBarBoundary: async () => true,
      ensureListingsController: () => ({ load: async () => undefined }),
      setData: (update) => {
        updates.push(update)
        if (typeof update.sheetOpen === 'boolean') context.data.sheetOpen = update.sheetOpen
      },
    }
    const registration = registrations[2] as FilterRegistration
    const event = { detail: { section: 'price' } } as const

    const staleOpening = registration.handleOpenFilter.call(context, event)
    registration.onHide.call(context)
    registration.onShow.call(context)
    const currentOpening = registration.handleOpenFilter.call(context, event)
    firstGate.resolve(true)
    await staleOpening
    expect(updates.filter((update) => update.sheetOpen === true)).toHaveLength(0)
    expect(showToast).not.toHaveBeenCalled()
    secondGate.resolve(true)
    await currentOpening

    expect(showModalTabBarBoundary).toHaveBeenCalledTimes(2)
    expect(updates.filter((update) => update.sheetOpen === true)).toHaveLength(1)
    expect(showToast).not.toHaveBeenCalled()
    expect(context.pageActive).toBe(true)
  })
})
