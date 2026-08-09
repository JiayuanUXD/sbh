import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'
import { readBuildCommit } from './src/lib/build-info'
import { buildSecurityHeaders, toNextHeaderEntries } from './src/lib/security-headers'

const isProduction = process.env.NODE_ENV === 'production'

const nextConfig: NextConfig = {
  // 构建期内联：产物里是字面量，运行时不依赖任何环境变量或文件。
  // build-info.json 由 CI 注入发布包（见 .github/workflows/deploy.yml 与 src/lib/build-info.ts）；
  // 本地与 CI 质量门没有该文件，值为 'unknown'。
  env: {
    BUILD_COMMIT: readBuildCommit(import.meta.dirname),
  },
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
