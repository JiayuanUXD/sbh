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
    // OPT-061：/_next/image 优化端点默认启用，remotePatterns 是它唯一的远程源白名单。
    // 通配 hostname 会把它变成任意 https 源的公开图片代理（刷出站带宽 + SSRF 探测面）。
    // 本站媒体一律走同源相对路径 /api/media/file/*，相对路径不受 remotePatterns 约束，
    // 因此白名单保持为空。将来接入 next/image 且需要远程图源时，按具体域名逐条加白，
    // 并同步更新 tests/next-image-config.test.ts。
    remotePatterns: [],
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
