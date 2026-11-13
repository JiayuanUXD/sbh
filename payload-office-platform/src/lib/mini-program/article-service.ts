import { getPayload, type Where } from 'payload'
import config from '@/payload.config'
import type { Building, Location } from '@/payload-types'
import type {
  MiniArticleDetailResolution,
  MiniArticleItem,
  MiniArticlesData,
  MiniImage,
  MiniRelatedBuilding,
  MiniSnapshot,
} from '@/domain/mini-program/contracts'
import { serializeLexicalToHtml } from '@/domain/mini-program/lexical-to-html'
import { parseUtcIso, shanghaiDate } from '@/domain/shared/time'
import { getSiteConfig } from '@/lib/frontend/site-config'

export const SAFE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const MINI_ARTICLE_CATEGORY_LABELS: Record<string, string> = {
  market: '市场洞察',
  guide: '选址指南',
  building: '楼盘解读',
  industry: '行业资讯',
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPopulatedBuilding(value: number | Building): value is Building {
  return typeof value === 'object' && value !== null
}

function isPopulatedLocation(value: number | Location | null | undefined): value is Location {
  return typeof value === 'object' && value !== null
}

function extractBuildingPriceText(building: Building): string | null {
  const raw: unknown = building
  if (!isObject(raw) || !isObject(raw.priceRange)) return null
  return typeof raw.priceRange.text === 'string' ? raw.priceRange.text : null
}

export function formatDateFormatted(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = parseUtcIso(iso)
  if (!d) return ''
  return shanghaiDate(d)
}

export function toMiniImage(
  raw: unknown,
  mediaOrigin: string,
  altFallback: string,
): MiniImage | null {
  if (!isObject(raw)) return null
  if (typeof raw.url !== 'string' || !raw.url) return null
  const src = raw.url.startsWith('/') ? new URL(raw.url, mediaOrigin).toString() : raw.url
  return {
    src,
    alt: typeof raw.alt === 'string' && raw.alt.trim() ? raw.alt.trim() : altFallback,
    width: typeof raw.width === 'number' ? raw.width : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
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

  const items: MiniArticleItem[] = (result.docs || []).map((doc) => {
    const category = doc.category ?? ''
    return {
      id: String(doc.id),
      slug: String(doc.slug || ''),
      title: String(doc.title || ''),
      category,
      categoryLabel: category ? (MINI_ARTICLE_CATEGORY_LABELS[category] ?? category) : '',
      publishedAt: doc.publishedAt ? new Date(doc.publishedAt).toISOString() : '',
      publishedDateFormatted: formatDateFormatted(doc.publishedAt),
      coverImage: toMiniImage(doc.coverImage, siteConfig.siteOrigin, doc.title || ''),
      excerpt: String(doc.excerpt || ''),
    }
  })

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

  const doc = result.docs?.[0]
  if (!doc) {
    return { status: 'article_not_found' }
  }

  const contentHtml = serializeLexicalToHtml(doc.content)

  const relatedBuildings: MiniRelatedBuilding[] = []
  if (Array.isArray(doc.relatedBuildings)) {
    for (const b of doc.relatedBuildings) {
      if (isPopulatedBuilding(b)) {
        const districtName = isPopulatedLocation(b.district)
          ? (b.district.name ?? null)
          : null

        const priceText = extractBuildingPriceText(b)

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

  const category = doc.category ?? ''

  return {
    status: 'ok',
    snapshot: {
      asOf: new Date().toISOString(),
      data: {
        id: String(doc.id),
        slug: String(doc.slug || ''),
        title: String(doc.title || ''),
        category,
        categoryLabel: category ? (MINI_ARTICLE_CATEGORY_LABELS[category] ?? category) : '',
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
