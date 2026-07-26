import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'
import { buildSecurityHeaders, toNextHeaderEntries } from './src/lib/security-headers'

const isProduction = process.env.NODE_ENV === 'production'

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  // OPT-019：不暴露 X-Powered-By（收敛公开调试面）
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  // OPT-019：生产安全响应头（单一事实源 src/lib/security-headers.ts）
  async headers() {
    return [
      {
        source: '/:path*',
        headers: toNextHeaderEntries(buildSecurityHeaders({ isProduction })),
      },
    ]
  },
}

export default withPayload(nextConfig)
