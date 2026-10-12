import type { MetadataRoute } from 'next'
import { siteConfig } from '@/lib/frontend/site-config'

export function globalStaticUrls(now: Date): MetadataRoute.Sitemap {
  const base = siteConfig.siteOrigin
  return [
    { url: `${base}/news`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${base}/pages/privacy`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/entrust`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/publish`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/city-partner`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
  ]
}
