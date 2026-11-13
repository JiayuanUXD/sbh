import { isFavorite, loadUserAssets, setFavorite, type FavoriteTarget } from './favorites.js'

type FavoriteView = {
  isFavorited: boolean
  favoriteBusy: boolean
  favoriteUnavailable: boolean
}

export function createDetailFavoriteController(
  target: FavoriteTarget,
  render: (view: FavoriteView) => void,
) {
  let confirmed: boolean | undefined
  let busy = false
  let disposed = false

  function publish() {
    if (disposed) return
    render({
      isFavorited: confirmed === true,
      favoriteBusy: busy,
      favoriteUnavailable: confirmed === undefined && !busy,
    })
  }

  async function run(write: boolean | undefined) {
    if (busy || disposed) return
    busy = true
    publish()
    try {
      const assets = write === undefined
        ? await loadUserAssets()
        : await setFavorite(target, write)
      if (disposed) return
      confirmed = isFavorite(assets, target)
      if (write !== undefined) {
        const label = target.targetType === 'building' ? '楼盘' : '房源'
        wx.showToast({ title: confirmed ? `已收藏该${label}` : '已取消收藏', icon: 'success' })
      }
    } catch {
      if (disposed) return
      // 写请求失败时，服务端也可能已处理请求。重新读取后再决定下一次操作。
      confirmed = undefined
      wx.showToast({ title: '收藏状态暂不可用，请重试', icon: 'none' })
    } finally {
      busy = false
      publish()
    }
  }

  return {
    refresh: () => run(undefined),
    activate: () => run(confirmed === undefined ? undefined : !confirmed),
    dispose() { disposed = true },
  }
}

export type DetailFavoriteController = ReturnType<typeof createDetailFavoriteController>
