import { getSitemapManifest, sitemapIndexXml, sitemapShardUrl, sitemapUnavailable, xmlResponse } from '../_lib/sitemap-shards'
import { siteConfig } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cities = await getSitemapManifest()
    const urls = [`${siteConfig.siteOrigin}/sitemaps/static.xml`]
    for (const city of cities) {
      urls.push(...city.listingPages.map((page) => sitemapShardUrl(city.citySlug, 'listings', page)))
      urls.push(...city.buildingPages.map((page) => sitemapShardUrl(city.citySlug, 'buildings', page)))
    }
    return xmlResponse(sitemapIndexXml(urls))
  } catch {
    return sitemapUnavailable()
  }
}
