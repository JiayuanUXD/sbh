import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@/payload.config'
import FavoriteRemoveButton from '@/components/frontend/member/FavoriteRemoveButton'
import { cityAwareHref } from '@/lib/frontend/city-routes'
import { getCurrentMember } from '@/domain/member/current-member'
import { listFavorites, type FavoriteItem } from '@/domain/member/favorites'
import {
  assertEffectiveBuilding,
  assertEffectiveListing,
  resolveBuildingRouteIdentity,
  resolveListingRouteIdentity,
} from '@/domain/public-catalog'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({ title: '我的收藏', canonicalPath: '/account/favorites', robots: 'noindex' })
}

type Row = { item: FavoriteItem; href: string | null }

/** 仍在有效供给内才给链接；判据复用统一供给服务（母文档 §9）。 */
async function resolveRow(item: FavoriteItem, multiCity: boolean): Promise<Row> {
  const ctx = { asOf: new Date().toISOString(), timezone: 'Asia/Shanghai' as const, channel: 'public-web' as const, city: '' }
  if (item.type === 'listing') {
    const identity = await resolveListingRouteIdentity(item.slug)
    if (!identity) return { item, href: null }
    const effective = await assertEffectiveListing(item.slug, { ...ctx, city: identity.citySlug })
    return { item, href: effective ? cityAwareHref(`/listings/${item.slug}`, identity.citySlug, multiCity) : null }
  }
  const identity = await resolveBuildingRouteIdentity(item.slug)
  if (!identity) return { item, href: null }
  const effective = await assertEffectiveBuilding(item.slug, { ...ctx, city: identity.citySlug })
  return { item, href: effective ? cityAwareHref(`/buildings/${item.slug}`, identity.citySlug, multiCity) : null }
}

export default async function FavoritesPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/login?returnTo=%2Faccount%2Ffavorites')
  const payload = await getPayload({ config })
  const items = await listFavorites(payload, member.id)
  const multiCity = getMultiCityRoutingEnabled()
  const rows = await Promise.all(items.map((item) => resolveRow(item, multiCity)))

  return (
    <div className="mb-page">
      <div className="mb-card mb-card--wide">
        <h1 className="mb-title">我的收藏</h1>
        {rows.length === 0 ? (
          <p className="mb-empty">还没有收藏。去<Link href="/listings">找办公室</Link>看看吧</p>
        ) : (
          <ul className="mb-list">
            {rows.map(({ item, href }) => (
              <li key={`${item.type}:${item.id}`} className="sf-card mb-item">
                {href ? <Link href={href} className="mb-item__title">{item.title}</Link> : <span className="mb-item__title">{item.title}</span>}
                <span className="mb-item__meta">
                  {item.type === 'listing' ? '房源' : '楼盘'} · 收藏于 {new Date(item.savedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                  {href ? null : <> · <span className="mb-tag">已下架</span></>}
                </span>
                <FavoriteRemoveButton type={item.type} id={item.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
