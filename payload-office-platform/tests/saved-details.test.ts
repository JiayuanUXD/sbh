/**
 * P1 Task 5 单测：canonical 分享 URL 与本地收藏序列化
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 5
 *
 * 守护不变量：
 *   - 分享 URL 移除 query 和 hash（utm/锚点不进入剪贴板/分享面板）
 *   - 收藏对象只含 type/id/slug/savedAt，不允许标题、价格或 PII
 *   - saveDetail 按 type:id 去重并置顶，最多保留 100 条
 *   - removeDetail 移除指定项；isSaved 反映当前状态
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalShareUrl,
  isSaved,
  loadSavedDetails,
  removeDetail,
  saveDetail,
  savedDetailKey,
  serializeSavedDetail,
} from '@/lib/frontend/saved-details'

describe('canonicalShareUrl', () => {
  it('移除 query 和 hash', () => {
    expect(canonicalShareUrl('https://sbh.example/listings/a?utm_source=x#gallery'))
      .toBe('https://sbh.example/listings/a')
  })

  it('无 query/hash 时原样返回 origin+pathname', () => {
    expect(canonicalShareUrl('https://sbh.example/buildings/b'))
      .toBe('https://sbh.example/buildings/b')
  })
})

describe('serializeSavedDetail', () => {
  it('收藏对象不允许标题、价格或 PII', () => {
    const serialized = serializeSavedDetail({
      type: 'listing',
      id: 1,
      slug: 'a',
      savedAt: '2026-07-30T00:00:00.000Z',
    })
    expect(serialized).not.toContain('price')
    expect(serialized).not.toContain('title')
    expect(serialized).not.toContain('phone')
    expect(serialized).not.toContain('name')
  })

  it('savedDetailKey 按 type:id 拼接', () => {
    expect(savedDetailKey({ type: 'building', id: 7 })).toBe('building:7')
  })
})

describe('saved-detail localStorage', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v)
        },
        removeItem: (k: string) => {
          store.delete(k)
        },
        clear: () => store.clear(),
        key: (i: number) => Array.from(store.keys())[i] ?? null,
        length: 0,
      },
    } as unknown as Window & typeof globalThis)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saveDetail 按 type:id 去重并置顶更新 savedAt', () => {
    saveDetail({ type: 'listing', id: 1, slug: 'a', savedAt: 't1' })
    saveDetail({ type: 'listing', id: 2, slug: 'b', savedAt: 't2' })
    saveDetail({ type: 'listing', id: 1, slug: 'a', savedAt: 't3' })

    const all = loadSavedDetails()
    expect(all).toHaveLength(2)
    expect(all[0].savedAt).toBe('t3')
    expect(isSaved('listing', 1)).toBe(true)
    expect(isSaved('listing', 2)).toBe(true)
  })

  it('removeDetail 移除指定项', () => {
    saveDetail({ type: 'building', id: 5, slug: 'b', savedAt: 't' })
    expect(isSaved('building', 5)).toBe(true)

    removeDetail('building', 5)
    expect(isSaved('building', 5)).toBe(false)
    expect(loadSavedDetails()).toHaveLength(0)
  })

  it('最多保留 100 条，淘汰最旧', () => {
    for (let i = 0; i < 110; i += 1) {
      saveDetail({ type: 'listing', id: i, slug: `s${i}`, savedAt: `t${i}` })
    }
    const all = loadSavedDetails()
    expect(all).toHaveLength(100)
    expect(isSaved('listing', 109)).toBe(true)
    expect(isSaved('listing', 0)).toBe(false)
  })
})
