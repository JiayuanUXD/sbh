import type { MetadataRoute } from 'next'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { siteConfig } from '@/lib/frontend/site-config'
import {
  buildingOperationalWhere,
  listingBuildingOperationalWhere,
} from '@/domain/supply/building'

// sitemap 查库（listings/buildings），构建期无 DB。与 (frontend) 各页面一致，
// 强制运行时动态生成，禁止构建期预渲染，否则 builder 阶段报 no such table。
export const dynamic = 'force-dynamic'

// 站点 URL 由类型化环境配置提供，禁止硬编码生产域名。
// F0.5：见 specs/frontend-mvp/tasks.md 与 design.md §11。
// 生产构建缺失 NEXT_PUBLIC_SITE_URL 时，site-config 模块会在启动时抛错。
const base = siteConfig.siteOrigin

// TODO(F1.6): 此处 `status=available` 是过渡性降级，待 M4.7 统一有效供给
// 服务接入后改为通过 Public Catalog Facade 查询。见 specs/frontend-mvp/tasks.md F1.6。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const payload = await getPayload({ config })
  const [listings, buildings] = await Promise.all([
    payload.find({
      collection: 'listings',
      // 停用楼盘的房源不进 sitemap（M3.5，与 C 端可见性一致）
      where: { status: { equals: 'available' }, ...listingBuildingOperationalWhere() },
      limit: 500,
      depth: 0,
    }),
    payload.find({
      collection: 'buildings',
      // 停用楼盘不进 sitemap（M3.5）
      where: { status: { equals: 'published' }, ...buildingOperationalWhere() },
      limit: 200,
      depth: 0,
    }),
  ])

  const lUrls = listings.docs.map((d) => ({
    url: `${base}/listings/${d.slug}`,
    lastModified: new Date(d.updatedAt),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))
  const bUrls = buildings.docs.map((d) => ({
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
