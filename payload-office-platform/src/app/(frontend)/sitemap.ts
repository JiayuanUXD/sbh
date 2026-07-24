import type { MetadataRoute } from 'next'
import { getPayload } from 'payload'
import config from '@/payload.config'

// sitemap 查库（listings/buildings），构建期无 DB。与 (frontend) 各页面一致，
// 强制运行时动态生成，禁止构建期预渲染，否则 builder 阶段报 no such table。
export const dynamic = 'force-dynamic'

const base = 'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const payload = await getPayload({ config })
  const [listings, buildings] = await Promise.all([
    payload.find({
      collection: 'listings',
      where: { status: { equals: 'available' } },
      limit: 500,
      depth: 0,
    }),
    payload.find({
      collection: 'buildings',
      where: { status: { equals: 'published' } },
      limit: 200,
      depth: 0,
    }),
  ])

  const lUrls = listings.docs.map((d: any) => ({
    url: `${base}/listings/${d.slug}`,
    lastModified: new Date(d.updatedAt),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))
  const bUrls = buildings.docs.map((d: any) => ({
    url: `${base}/buildings/${d.slug}`,
    lastModified: new Date(d.updatedAt),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))

  return [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${base}/listings`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    ...lUrls,
    ...bUrls,
  ]
}
