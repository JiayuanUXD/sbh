import type { MetadataRoute } from 'next'

const base = 'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
    sitemap: `${base}/sitemap.xml`,
  }
}
