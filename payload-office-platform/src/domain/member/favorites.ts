/** 收藏（OPT-088 §6.5 / §9）。纯规则在上半部分，Local API 在下半部分。 */
import type { Payload } from 'payload'
import type { MemberFavorite } from '@/payload-types'
import { MemberHttpError } from './http'

export type FavoriteType = 'listing' | 'building'
export type FavoriteItem = Readonly<{ type: FavoriteType; id: number; slug: string; title: string; savedAt: string }>
export const FAVORITES_LIMIT = 200

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/

function isType(v: unknown): v is FavoriteType {
  return v === 'listing' || v === 'building'
}

export function isFavoriteInput(value: unknown): value is { type: FavoriteType; id: number; slug: string } {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return isType(v.type) && typeof v.id === 'number' && Number.isInteger(v.id) && v.id > 0 && typeof v.slug === 'string' && SLUG_RE.test(v.slug)
}

export function isFavoriteMergeItem(value: unknown): value is { type: FavoriteType; id: number; slug: string; savedAt: string } {
  if (!isFavoriteInput(value)) return false
  const savedAt = (value as Record<string, unknown>).savedAt
  return typeof savedAt === 'string' && !Number.isNaN(Date.parse(savedAt))
}

const keyOf = (f: { type: FavoriteType; id: number }): string => `${f.type}:${f.id}`

export function mergeFavorites(
  server: readonly FavoriteItem[],
  incoming: readonly { type: FavoriteType; id: number; slug: string; savedAt: string; title: string }[],
): FavoriteItem[] {
  const map = new Map<string, FavoriteItem>()
  for (const f of [...server, ...incoming]) {
    const k = keyOf(f)
    const prev = map.get(k)
    if (!prev || Date.parse(f.savedAt) > Date.parse(prev.savedAt)) map.set(k, { type: f.type, id: f.id, slug: f.slug, title: f.title, savedAt: f.savedAt })
  }
  return [...map.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)).slice(0, FAVORITES_LIMIT)
}

function toItem(doc: MemberFavorite): FavoriteItem {
  return { type: doc.targetType, id: doc.targetId, slug: doc.targetSlug, title: doc.titleSnapshot, savedAt: doc.savedAt }
}

async function docsOf(payload: Payload, memberId: number): Promise<MemberFavorite[]> {
  const result = await payload.find({
    collection: 'member-favorites', where: { member: { equals: memberId } }, sort: '-savedAt', limit: FAVORITES_LIMIT + 1, depth: 0, overrideAccess: true,
  })
  return result.docs
}

export async function listFavorites(payload: Payload, memberId: number): Promise<FavoriteItem[]> {
  return (await docsOf(payload, memberId)).map(toItem)
}

async function titleOf(payload: Payload, type: FavoriteType, id: number): Promise<string | null> {
  const collection = type === 'listing' ? 'listings' : 'buildings'
  const doc = await payload.findByID({ collection, id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!doc) return null
  const title = (doc as { title?: unknown; name?: unknown }).title ?? (doc as { name?: unknown }).name
  return typeof title === 'string' && title.length > 0 ? title : '未命名'
}

export async function addFavorite(payload: Payload, memberId: number, input: { type: FavoriteType; id: number; slug: string }, savedAt = new Date().toISOString()): Promise<FavoriteItem[]> {
  const existing = await docsOf(payload, memberId)
  if (existing.some((d) => d.targetType === input.type && d.targetId === input.id)) return existing.map(toItem)
  if (existing.length >= FAVORITES_LIMIT) throw new MemberHttpError('FAVORITE_LIMIT')
  const title = await titleOf(payload, input.type, input.id)
  if (title === null) throw new MemberHttpError('BAD_REQUEST')
  await payload.create({
    collection: 'member-favorites',
    data: { member: memberId, targetType: input.type, targetId: input.id, targetSlug: input.slug, titleSnapshot: title, savedAt, targetKey: `${memberId}:${input.type}:${input.id}` },
    overrideAccess: true,
  })
  return listFavorites(payload, memberId)
}

export async function removeFavorite(payload: Payload, memberId: number, input: { type: FavoriteType; id: number }): Promise<FavoriteItem[]> {
  await payload.delete({
    collection: 'member-favorites',
    where: { and: [{ member: { equals: memberId } }, { targetType: { equals: input.type } }, { targetId: { equals: input.id } }] },
    overrideAccess: true,
  })
  return listFavorites(payload, memberId)
}

export async function mergeLocalFavorites(payload: Payload, memberId: number, items: readonly { type: FavoriteType; id: number; slug: string; savedAt: string }[]): Promise<FavoriteItem[]> {
  const server = await listFavorites(payload, memberId)
  const known = new Set(server.map(keyOf))
  const resolved: { type: FavoriteType; id: number; slug: string; savedAt: string; title: string }[] = []
  for (const it of items.slice(0, 100)) {
    if (known.has(keyOf(it))) continue
    const title = await titleOf(payload, it.type, it.id)
    if (title === null) continue
    resolved.push({ ...it, title })
  }
  const merged = mergeFavorites(server, resolved)
  const keep = new Set(merged.map(keyOf))
  for (const f of merged) {
    if (!known.has(keyOf(f))) {
      await payload.create({
        collection: 'member-favorites',
        data: { member: memberId, targetType: f.type, targetId: f.id, targetSlug: f.slug, titleSnapshot: f.title, savedAt: f.savedAt, targetKey: `${memberId}:${f.type}:${f.id}` },
        overrideAccess: true,
      })
    }
  }
  for (const s of server) {
    if (!keep.has(keyOf(s))) await removeFavorite(payload, memberId, s)
  }
  return listFavorites(payload, memberId)
}
