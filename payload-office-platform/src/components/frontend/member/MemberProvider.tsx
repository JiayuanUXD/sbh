'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { MemberDto } from '@/domain/member/member-dto'
import type { FavoriteItem, FavoriteType } from '@/domain/member/favorites'
import { loadSavedDetails, clearSavedDetails } from '@/lib/frontend/saved-details'
import { memberGet, memberPost } from './member-api'

export type MemberContextValue = Readonly<{
  member: MemberDto | null
  favorites: readonly FavoriteItem[]
  favoritesReady: boolean
  isFavorite: (type: FavoriteType, id: number) => boolean
  addFavorite: (input: { type: FavoriteType; id: number; slug: string }) => Promise<string | null>
  removeFavorite: (input: { type: FavoriteType; id: number }) => Promise<string | null>
  logout: () => Promise<void>
}>

const EMPTY: MemberContextValue = {
  member: null,
  favorites: [],
  favoritesReady: false,
  isFavorite: () => false,
  addFavorite: async () => '请先登录',
  removeFavorite: async () => '请先登录',
  logout: async () => undefined,
}

const MemberContext = createContext<MemberContextValue>(EMPTY)

type ItemsBody = { items: FavoriteItem[] }

/**
 * 会员上下文（OPT-088 §8.1 / §9）。
 * 登录态下收藏以服务端为准：挂载时拉一次；若 localStorage 里还有未登录时的收藏，先合并上传再清空本地。
 * 未登录时本 Provider 只提供 member=null，收藏按钮走原来的 localStorage 分支。
 */
export function MemberProvider({ initialMember, children }: { initialMember: MemberDto | null; children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<readonly FavoriteItem[]>([])
  const [favoritesReady, setFavoritesReady] = useState(false)
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (!initialMember || bootstrapped.current) return
    bootstrapped.current = true
    let cancelled = false
    const run = async () => {
      const local = loadSavedDetails()
      const result = local.length > 0
        ? await memberPost<ItemsBody>('/api/member/favorites/merge', { items: local })
        : await memberGet<ItemsBody>('/api/member/favorites')
      if (cancelled) return
      if (result.ok) {
        setFavorites(result.data.items)
        if (local.length > 0) clearSavedDetails()
      }
      setFavoritesReady(true)
    }
    void run()
    return () => { cancelled = true }
  }, [initialMember])

  const isFavorite = useCallback((type: FavoriteType, id: number) => favorites.some((f) => f.type === type && f.id === id), [favorites])

  const addFavorite = useCallback(async (input: { type: FavoriteType; id: number; slug: string }) => {
    const prev = favorites
    setFavorites([{ ...input, title: '', savedAt: new Date().toISOString() }, ...prev.filter((f) => !(f.type === input.type && f.id === input.id))])
    const result = await memberPost<ItemsBody>('/api/member/favorites', input)
    if (!result.ok) { setFavorites(prev); return result.message }
    setFavorites(result.data.items)
    return null
  }, [favorites])

  const removeFavorite = useCallback(async (input: { type: FavoriteType; id: number }) => {
    const prev = favorites
    setFavorites(prev.filter((f) => !(f.type === input.type && f.id === input.id)))
    const result = await memberPost<ItemsBody>('/api/member/favorites', input, 'DELETE')
    if (!result.ok) { setFavorites(prev); return result.message }
    setFavorites(result.data.items)
    return null
  }, [favorites])

  const logout = useCallback(async () => {
    await memberPost('/api/member/logout', {})
    window.location.assign('/')
  }, [])

  const value = useMemo<MemberContextValue>(() => ({
    member: initialMember, favorites, favoritesReady, isFavorite, addFavorite, removeFavorite, logout,
  }), [initialMember, favorites, favoritesReady, isFavorite, addFavorite, removeFavorite, logout])

  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>
}

export function useMember(): MemberContextValue {
  return useContext(MemberContext)
}
