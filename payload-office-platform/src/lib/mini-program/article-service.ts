import { getPayload, type Where } from 'payload'
import config from '@/payload.config'
import type {
  MiniArticleDetailData,
  MiniArticleDetailResolution,
  MiniArticleItem,
  MiniArticlesData,
  MiniImage,
  MiniRelatedBuilding,
  MiniSnapshot,
} from '@/domain/mini-program/contracts'
import { serializeLexicalToHtml } from '@/domain/mini-program/lexical-to-html'
import { getSiteConfig } from '@/lib/frontend/site-config'

export const SAFE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const MINI_ARTICLE_CATEGORY_LABELS: Record<string, string> = {
  market: '市场洞察',
  guide: '选址指南',
  building: '楼盘解读',
  industry: '行业资讯',
}

export function formatDateFormatted(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
  } catch {
    return ''
  }
}

export function toMiniImage(
  raw: unknown,
  mediaOrigin: string,
  altFallback: string,
): MiniImage | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as { url?: string; alt?: string; width?: number; height?: number }
  if (typeof m.url !== 'string' || !m.url) return null
  const src = m.url.startsWith('/') ? new URL(m.url, mediaOrigin).toString() : m.url
  return {
    src,
    alt: typeof m.alt === 'string' && m.alt.trim() ? m.alt.trim() : altFallback,
    width: typeof m.width === 'number' ? m.width : undefined,
    height: typeof m.height === 'number' ? m.height : undefined,
  }
}

export async function getMiniArticles(
  url: URL,
): Promise<MiniSnapshot<MiniArticlesData>> {
  const pageParam = url.searchParams.get('page')
  const pageSizeParam = url.searchParams.get('pageSize')
  const categoryParam = url.searchParams.get('category')?.trim()

  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1)
  const pageSize = Math.min(Math.max(1, parseInt(pageSizeParam || '10', 10) || 10), 20)

  const payload = await getPayload({ config })
  const siteConfig = getSiteConfig()

  const where: Where = {
    status: { equals: 'published' },
    deletedAt: { exists: false },
    ...(categoryParam && ['market', 'guide', 'building', 'industry'].includes(categoryParam)
      ? { category: { equals: categoryParam } }
      : {}),
  }

  const result = await payload.find({
    collection: 'articles',
    where,
    page,
    limit: pageSize,
    sort: ['featuredOrder', '-publishedAt'],
    depth: 2,
  })

  const items: MiniArticleItem[] = (result.docs || []).map((doc: any) => ({
    id: String(doc.id),
    slug: String(doc.slug || ''),
    title: String(doc.title || ''),
    category: doc.category || '',
    categoryLabel: MINI_ARTICLE_CATEGORY_LABELS[doc.category] || doc.category || '',
    publishedAt: doc.publishedAt ? new Date(doc.publishedAt).toISOString() : '',
    publishedDateFormatted: formatDateFormatted(doc.publishedAt),
    coverImage: toMiniImage(doc.coverImage, siteConfig.siteOrigin, doc.title || ''),
    excerpt: String(doc.excerpt || ''),
  }))

  return {
    asOf: new Date().toISOString(),
    data: {
      items,
      pagination: {
        page: result.page ?? page,
        pageSize: result.limit ?? pageSize,
        totalDocs: result.totalDocs ?? 0,
        totalPages: result.totalPages ?? 0,
        hasNextPage: Boolean(result.hasNextPage),
      },
    },
  }
}

export async function getMiniArticleDetail(
  slug: string,
): Promise<MiniArticleDetailResolution> {
  if (!SAFE_SLUG_PATTERN.test(slug)) {
    return { status: 'article_not_found' }
  }

  const payload = await getPayload({ config })
  const siteConfig = getSiteConfig()

  const result = await payload.find({
    collection: 'articles',
    where: {
      slug: { equals: slug },
      status: { equals: 'published' },
      deletedAt: { exists: false },
    },
    limit: 1,
    depth: 3,
  })

  const doc = result.docs?.[0] as any
  if (!doc) {
    return { status: 'article_not_found' }
  }

  const contentHtml = serializeLexicalToHtml(doc.content)

  const relatedBuildings: MiniRelatedBuilding[] = []
  if (Array.isArray(doc.relatedBuildings)) {
    for (const b of doc.relatedBuildings) {
      if (b && typeof b === 'object') {
        const districtName =
          typeof b.district === 'object' && b.district !== null
            ? (b.district.name ?? null)
            : null

        const priceText =
          typeof b.priceRange === 'object' && b.priceRange !== null
            ? (b.priceRange.text ?? null)
            : null

        relatedBuildings.push({
          id: String(b.id),
          name: String(b.name || ''),
          slug: String(b.slug || ''),
          district: districtName,
          priceText,
          coverImage: toMiniImage(b.coverImage, siteConfig.siteOrigin, b.name || ''),
        })
      }
    }
  }

  return {
    status: 'ok',
    snapshot: {
      asOf: new Date().toISOString(),
      data: {
        id: String(doc.id),
        slug: String(doc.slug || ''),
        title: String(doc.title || ''),
        category: doc.category || '',
        categoryLabel: MINI_ARTICLE_CATEGORY_LABELS[doc.category] || doc.category || '',
        publishedAt: doc.publishedAt ? new Date(doc.publishedAt).toISOString() : '',
        publishedDateFormatted: formatDateFormatted(doc.publishedAt),
        coverImage: toMiniImage(doc.coverImage, siteConfig.siteOrigin, doc.title || ''),
        excerpt: String(doc.excerpt || ''),
        contentHtml,
        relatedBuildings,
      },
    },
  }
}
