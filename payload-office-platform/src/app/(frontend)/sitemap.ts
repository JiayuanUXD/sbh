import type { MetadataRoute } from 'next'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { siteConfig } from '@/lib/frontend/site-config'
import {
  buildingOperationalWhere,
  listingBuildingOperationalWhere,
} from '@/domain/supply/building'
import {
  defaultSearchContext,
  listPublishedPages,
} from '@/domain/public-catalog'

// sitemap 查库（listings/buildings/pages），构建期无 DB。与 (frontend) 各页面一致，
// 强制运行时动态生成，禁止构建期预渲染，否则 builder 阶段报 no such table。
export const dynamic = 'force-dynamic'

// 站点 URL 由类型化环境配置提供，禁止硬编码生产域名。
// F0.5：见 specs/frontend-mvp/tasks.md 与 design.md §11。
// 生产构建缺失 NEXT_PUBLIC_SITE_URL 时，site-config 模块会在启动时抛错。
const base = siteConfig.siteOrigin

/**
 * 内容页 home slug 特殊处理（F6.4）
 *
 * Pages collection 中 slug='home' 的页面由 CMS 维护首页内容，
 * 但首页路由为 '/'（已由 sitemap 首条占位），不应再生成 /pages/home。
 * 见 facade.ts listPublishedPages 注释：home slug 由调用方转换。
 */
const HOME_SLUG = 'home'

// TODO(F1.6): 此处 `status=available` 是过渡性降级，待 M4.7 统一有效供给
// 服务接入后改为通过 Public Catalog Facade 查询。见 specs/frontend-mvp/tasks.md F1.6。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const payload = await getPayload({ config })
  const ctx = defaultSearchContext()
  const [listings, buildings, pages] = await Promise.all([
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
    // F6.4：内容页通过 Public Catalog Facade 查询，与 /pages/[slug] 路由可见性一致
    listPublishedPages(ctx, { limit: 500 }),
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
  // F6.4：内容页 URL 与优先级
  //   - home slug 跳过：首页 '/' 已由下方首条占位，不重复 /pages/home；
  //   - 内容页更新频率低于房源/楼盘，使用 monthly；
  //   - 优先级 0.6：与楼盘同级，低于房源详情（0.8）与列表（0.9）。
  const pUrls = pages
    .filter((p) => p.slug !== HOME_SLUG)
    .map((p) => ({
      url: `${base}/pages/${p.slug}`,
      lastModified: new Date(p.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }))

  return [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${base}/listings`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    ...lUrls,
    ...bUrls,
    ...pUrls,
  ]
}
