/**
 * P1 Task 5：canonical 分享 URL 与本地收藏
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 5
 *
 * 约束：
 *   - 分享只使用 canonical URL（移除 query 和 hash，utm/锚点不进入剪贴板/分享面板）
 *   - 收藏只保存不可识别 ID（type/id/slug/savedAt），不含标题、价格或 PII
 *   - localStorage key 固定 `sbh:saved-details:v1`，按 `type:id` 去重，最多 100 条
 *   - 禁用 localStorage 时静默降级，UI 层显示非阻断提示
 *
 * 仅在浏览器端读写 localStorage；SSR（typeof window === 'undefined'）返回空。
 */

export type SavedDetailType = 'listing' | 'building'

export type SavedDetail = Readonly<{
  type: SavedDetailType
  id: number
  slug: string
  savedAt: string
}>

const STORAGE_KEY = 'sbh:saved-details:v1'
const MAX_SAVED = 100

/**
 * 自定义事件：saveDetail/removeDetail 写入后派发，供 useSyncExternalStore 订阅者重读。
 */
export const SAVED_CHANGE_EVENT = 'sbh:saved-change'

/**
 * 将任意 URL 净化为 canonical 分享 URL：保留 origin + pathname，移除 query 和 hash。
 */
export function canonicalShareUrl(url: string): string {
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname}`
}

/**
 * 序列化收藏对象。只含 type/id/slug/savedAt，不含标题、价格或 PII。
 */
export function serializeSavedDetail(detail: SavedDetail): string {
  return JSON.stringify(detail)
}

export function savedDetailKey(detail: Pick<SavedDetail, 'type' | 'id'>): string {
  return `${detail.type}:${detail.id}`
}

function isValidSavedDetail(value: unknown): value is SavedDetail {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.type === 'listing' || v.type === 'building') &&
    typeof v.id === 'number' &&
    typeof v.slug === 'string' &&
    typeof v.savedAt === 'string'
  )
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * 读取本地收藏列表；不可用或损坏时返回空。
 */
export function loadSavedDetails(): SavedDetail[] {
  const storage = getStorage()
  if (storage === null) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidSavedDetail)
  } catch {
    return []
  }
}

function persist(details: readonly SavedDetail[]): void {
  const storage = getStorage()
  if (storage === null) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(details))
  } catch {
    // 禁用/隐私模式/超限：静默失败，UI 层通过 isLocalStorageAvailable 提示
  }
}

function notifySavedChange(): void {
  if (typeof window === 'undefined') return
  if (typeof window.dispatchEvent !== 'function') return
  if (typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(SAVED_CHANGE_EVENT))
}

/**
 * 收藏一条详情：按 `type:id` 去重并置顶，更新 savedAt；最多保留 100 条。
 */
export function saveDetail(detail: SavedDetail): SavedDetail[] {
  const key = savedDetailKey(detail)
  const existing = loadSavedDetails().filter((d) => savedDetailKey(d) !== key)
  const next = [detail, ...existing].slice(0, MAX_SAVED)
  persist(next)
  notifySavedChange()
  return next
}

/**
 * 移除一条收藏。
 */
export function removeDetail(type: SavedDetailType, id: number): SavedDetail[] {
  const key = `${type}:${id}`
  const next = loadSavedDetails().filter((d) => savedDetailKey(d) !== key)
  persist(next)
  notifySavedChange()
  return next
}

/**
 * 是否已收藏。
 */
export function isSaved(type: SavedDetailType, id: number): boolean {
  const key = `${type}:${id}`
  return loadSavedDetails().some((d) => savedDetailKey(d) === key)
}

/**
 * localStorage 是否可用（用于禁用/隐私模式下显示非阻断提示）。
 */
export function isLocalStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const testKey = '__sbh_ls_test__'
    window.localStorage.setItem(testKey, '1')
    window.localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}
