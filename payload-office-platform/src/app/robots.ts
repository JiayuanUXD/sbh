import type { MetadataRoute } from 'next'
import { siteConfig } from '@/lib/frontend/site-config'

// 站点 URL 由类型化环境配置提供，禁止硬编码生产域名。
// F0.5：见 specs/frontend-mvp/tasks.md 与 design.md §11。
// 生产构建缺失 NEXT_PUBLIC_SITE_URL 时，site-config 模块会在启动时抛错。
const base = siteConfig.siteOrigin

export default function robots(): MetadataRoute.Robots {
  return {
    // /dev-story 仅开发环境可用（见 (frontend)/dev-story/page.tsx），
    // 即便路由被绕过也显式 disallow，避免任何抓取。
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/dev-story'] },
    sitemap: `${base}/sitemap.xml`,
  }
}
