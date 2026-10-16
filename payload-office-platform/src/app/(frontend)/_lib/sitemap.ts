import type { MetadataRoute } from 'next'
import { siteConfig } from '@/lib/frontend/site-config'

/**
 * 全站级静态页。**不写 lastModified**：这些页面没有可靠的「最后修改」时间，
 * 此前统一填请求时刻，等于每次抓取都声称「刚更新过」，Google 会据此不再信任整个 sitemap 的 lastmod。
 * `/news` 不在这里：它只有在至少有一篇已发布资讯时才该进 sitemap，由 getStaticSitemap 按需追加。
 */
export function globalStaticUrls(): MetadataRoute.Sitemap {
  const base = siteConfig.siteOrigin
  return [
    { url: `${base}/pages/privacy`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/entrust`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/publish`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/city-partner`, changeFrequency: 'monthly', priority: 0.6 },
  ]
}
