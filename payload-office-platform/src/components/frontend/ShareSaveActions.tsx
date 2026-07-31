'use client'

/**
 * P1 Task 5：canonical 分享与本地收藏操作
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 5
 *
 * - 分享：优先 navigator.share({ url: canonical })，不支持时复制 canonical 到剪贴板
 *   canonical 经 canonicalShareUrl 净化（移除 query/hash，utm/锚点不外泄）
 * - 收藏：仅保存不可识别 ID（type/id/slug/savedAt），localStorage key 固定
 *   `sbh:saved-details:v1`，按 type:id 去重，最多 100 条
 * - 禁用 localStorage 时：收藏按钮禁用并显示非阻断提示，分享不受影响
 *
 * localStorage 读取通过 useSyncExternalStore 完成：避免在 useEffect 中同步 setState
 * （React 19 react-hooks/set-state-in-effect），同时保证 SSR 与客户端 hydration 一致。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  canonicalShareUrl,
  isLocalStorageAvailable,
  isSaved,
  removeDetail,
  saveDetail,
  SAVED_CHANGE_EVENT,
  type SavedDetail,
} from '@/lib/frontend/saved-details'

type ShareSaveActionsProps = Readonly<{
  canonicalUrl: string
  savedDetail: Pick<SavedDetail, 'type' | 'id' | 'slug'>
}>

const SHARE_FEEDBACK_TIMEOUT_MS = 2000

/**
 * 订阅 localStorage 可用性变化（隐私模式切换、其他标签页 storage 事件）。
 */
function subscribeLsAvailability(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('storage', callback)
  return () => window.removeEventListener('storage', callback)
}

/**
 * 订阅收藏状态变化：storage 事件（跨标签页）+ 自定义 SAVED_CHANGE_EVENT（本标签页写入）。
 */
function subscribeSaved(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('storage', callback)
  window.addEventListener(SAVED_CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(SAVED_CHANGE_EVENT, callback)
  }
}

export default function ShareSaveActions({ canonicalUrl, savedDetail }: ShareSaveActionsProps) {
  const lsAvailable = useSyncExternalStore(
    subscribeLsAvailability,
    isLocalStorageAvailable,
    () => false,
  )
  const saved = useSyncExternalStore(
    subscribeSaved,
    () => isSaved(savedDetail.type, savedDetail.id),
    () => false,
  )
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (shareFeedback === null) return
    const timer = window.setTimeout(() => setShareFeedback(null), SHARE_FEEDBACK_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [shareFeedback])

  const handleShare = async () => {
    const canonical = canonicalShareUrl(canonicalUrl)
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ url: canonical })
        return
      } catch {
        // 用户取消或分享失败，降级到剪贴板
      }
    }
    try {
      await navigator.clipboard.writeText(canonical)
      setShareFeedback('已复制链接')
    } catch {
      setShareFeedback('复制失败，请手动复制')
    }
  }

  const handleToggleSave = () => {
    if (!lsAvailable) return
    if (saved) {
      removeDetail(savedDetail.type, savedDetail.id)
    } else {
      saveDetail({
        type: savedDetail.type,
        id: savedDetail.id,
        slug: savedDetail.slug,
        savedAt: new Date().toISOString(),
      })
    }
  }

  return (
    <div className="share-save-actions" role="group" aria-label="分享与收藏">
      <button
        type="button"
        className="share-save-actions__btn"
        aria-label="分享"
        onClick={handleShare}
      >
        分享
      </button>
      <button
        type="button"
        className="share-save-actions__btn"
        aria-label={saved ? '取消收藏' : '收藏'}
        aria-pressed={saved}
        onClick={handleToggleSave}
        disabled={!lsAvailable}
      >
        {saved ? '已收藏' : '收藏'}
      </button>
      {shareFeedback !== null && (
        <span className="share-save-actions__feedback" role="status" aria-live="polite">
          {shareFeedback}
        </span>
      )}
      {!lsAvailable && (
        <span className="share-save-actions__hint" role="note">
          本地存储不可用，无法收藏
        </span>
      )}
    </div>
  )
}
