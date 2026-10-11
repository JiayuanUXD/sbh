import { getStaticSitemap, sitemapUnavailable, sitemapXml, xmlResponse } from '../../_lib/sitemap-shards'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return xmlResponse(sitemapXml(await getStaticSitemap()))
  } catch {
    return sitemapUnavailable()
  }
}
