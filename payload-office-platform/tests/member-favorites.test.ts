import { describe, expect, it } from 'vitest'
import { FAVORITES_LIMIT, isFavoriteInput, isFavoriteMergeItem, mergeFavorites, type FavoriteItem } from '@/domain/member/favorites'

const item = (id: number, savedAt: string, type: 'listing' | 'building' = 'listing'): FavoriteItem => ({ type, id, slug: `s${id}`, title: `t${id}`, savedAt })

describe('favorites 纯规则', () => {
  it('输入守卫', () => {
    expect(isFavoriteInput({ type: 'listing', id: 1, slug: 'a' })).toBe(true)
    expect(isFavoriteInput({ type: 'x', id: 1, slug: 'a' })).toBe(false)
    expect(isFavoriteInput({ type: 'listing', id: '1', slug: 'a' })).toBe(false)
    expect(isFavoriteMergeItem({ type: 'building', id: 2, slug: 'b', savedAt: '2026-01-01T00:00:00Z' })).toBe(true)
    expect(isFavoriteMergeItem({ type: 'building', id: 2, slug: 'b' })).toBe(false)
  })
  it('合并：同 type+id 保留较新 savedAt，倒序，裁到 200', () => {
    const server = [item(1, '2026-01-01T00:00:00Z'), item(2, '2026-01-03T00:00:00Z')]
    const incoming = [{ ...item(1, '2026-01-05T00:00:00Z'), title: 'new' }, { ...item(3, '2026-01-02T00:00:00Z') }]
    const merged = mergeFavorites(server, incoming)
    expect(merged.map((f) => f.id)).toEqual([1, 2, 3])
    expect(merged[0].savedAt).toBe('2026-01-05T00:00:00Z')
    const many = Array.from({ length: 250 }, (_, i) => item(i + 10, `2026-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`))
    expect(mergeFavorites([], many)).toHaveLength(FAVORITES_LIMIT)
  })
  it('listing 与 building 同 id 不冲突', () => {
    expect(mergeFavorites([item(1, '2026-01-01T00:00:00Z')], [item(1, '2026-01-01T00:00:00Z', 'building')])).toHaveLength(2)
  })
})
