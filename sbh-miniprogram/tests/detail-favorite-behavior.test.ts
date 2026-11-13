import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Assets = { favorited: boolean }
const assets = vi.hoisted(() => ({
  loadUserAssets: vi.fn<() => Promise<Assets>>(),
  setFavorite: vi.fn<(target: { targetSlug: string }, value: boolean) => Promise<Assets>>(),
  isFavorite: (value: Assets) => value.favorited,
  refreshUserAssets: vi.fn(),
}))
vi.mock('../miniprogram/services/favorites.js', () => assets)

type PageInstance = {
  data: { slug: string; state: string; building: { slug: string }; isFavorited: boolean; favoriteBusy: boolean }
  setData(update: Partial<PageInstance['data']>): void
  loadFavoriteState(slug: string): Promise<void>
  onShow(): void
  onUnload(): void
  handleFav(): Promise<void>
  handleToggleFavorite(): Promise<void>
}
const pages: PageInstance[] = []
const slug = 'tower-a'

beforeAll(async () => {
  vi.stubGlobal('wx', { showToast: vi.fn() })
  vi.stubGlobal('Page', (page: PageInstance) => { pages.push(page) })
  await import('../miniprogram/pages/building-detail/index.js')
  await import('../miniprogram/pages/listing-detail/index.js')
})
beforeEach(() => {
  assets.loadUserAssets.mockReset()
  assets.setFavorite.mockReset()
})
afterAll(() => vi.unstubAllGlobals())

describe.each(['building', 'listing'] as const)('%s 详情收藏', (type) => {
  function createPage() {
    const registration = pages[type === 'building' ? 0 : 1]!
    const page: PageInstance = {
      ...registration,
      data: { ...structuredClone(registration.data), slug, state: 'ready', building: { slug } },
      setData(update) { Object.assign(this.data, update) },
    }
    return { page, tap: () => type === 'building' ? page.handleFav() : page.handleToggleFavorite() }
  }

  it('读取失败后点击只重读，确认后才可写', async () => {
    const { page, tap } = createPage()
    assets.loadUserAssets.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ favorited: true })
    assets.setFavorite.mockResolvedValue({ favorited: false })
    await page.loadFavoriteState(slug)
    await tap()
    expect(assets.setFavorite).not.toHaveBeenCalled()
    expect(page.data.isFavorited).toBe(true)
    await tap()
    expect(assets.setFavorite).toHaveBeenCalledWith({ targetType: type, targetSlug: slug }, false)
  })

  it('写入过程中返回前台不会发起可能覆盖写入的读请求', async () => {
    const { page, tap } = createPage()
    assets.loadUserAssets.mockResolvedValue({ favorited: false })
    await page.loadFavoriteState(slug)
    let finish!: (value: Assets) => void
    assets.setFavorite.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const write = tap()
    page.onShow()
    finish({ favorited: true })
    await write
    expect(assets.loadUserAssets).toHaveBeenCalledTimes(1)
    expect(page.data.isFavorited).toBe(true)
  })

  it('离场后忽略迟到的读取结果', async () => {
    const { page } = createPage()
    let finish!: (value: Assets) => void
    assets.loadUserAssets.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const read = page.loadFavoriteState(slug)
    page.onUnload()
    finish({ favorited: true })
    await read
    expect(page.data.isFavorited).toBe(false)
  })
})
