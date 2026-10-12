import { getEntitySitemap, sitemapUnavailable, sitemapXml, xmlResponse } from '../../../../_lib/sitemap-shards'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ city: string; kind: string; page: string }> }) {
  const { city, kind, page } = await params
  if ((kind !== 'listings' && kind !== 'buildings') || !/^[1-9]\d*\.xml$/.test(page)) {
    return new Response('Not found', { status: 404 })
  }
  try {
    const entries = await getEntitySitemap(city, kind, Number(page.slice(0, -4)))
    return entries ? xmlResponse(sitemapXml(entries)) : new Response('Not found', { status: 404 })
  } catch {
    return sitemapUnavailable()
  }
}
