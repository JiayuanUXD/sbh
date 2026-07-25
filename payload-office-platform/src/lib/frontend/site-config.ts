/**
 * 前台类型化环境配置
 *
 * 设计依据：FRONTEND_AGENT.md §11.1、specs/frontend-mvp/design.md §11、§12
 *
 * 守护不变量：
 *   - sitemap、canonical、OG 不再硬编码生产域名；
 *   - 生产构建（NODE_ENV=production）启动/构建时缺失必需配置 → 抛错；
 *   - 开发/预览环境缺失时使用合理 fallback，并在日志中告警；
 *   - 默认城市、隐私政策版本和分析开关均为类型化常量，禁止散落字符串。
 *
 * 使用方式：
 *   import { siteConfig } from '@/lib/frontend/site-config'
 *   siteConfig.siteUrl  // URL 实例
 *   siteConfig.siteOrigin  // 'https://example.com'
 *   siteConfig.defaultCity  // 'shanghai'
 *   siteConfig.privacyPolicyVersion  // 'MVP-R1'
 */

/** 隐私政策版本：变更时必须同步 Lead 隐私同意字段和文档 */
export const PRIVACY_POLICY_VERSION = 'MVP-R1'

/** 默认运营城市（MVP 单城市） */
export const DEFAULT_CITY = 'shanghai' as const

/** 受支持的城市代码白名单 */
export const SUPPORTED_CITIES = ['shanghai'] as const
export type SupportedCity = (typeof SUPPORTED_CITIES)[number]

/**
 * 站点配置：以只读对象暴露，禁止运行时修改。
 *
 * 解析规则：
 *   1. NEXT_PUBLIC_SITE_URL 必须是合法的 http(s) URL（无尾斜杠）；
 *   2. 生产环境（NODE_ENV=production）缺失 → 抛错；
 *   3. 开发环境缺失 → 使用 http://localhost:3717 并 warn；
 *   4. NEXT_PUBLIC_ANALYTICS_ENABLED 接受 'true' / '1'（区分大小写）；
 *   5. 默认城市仅在 SUPPORTED_CITIES 白名单内。
 */
export type SiteConfig = Readonly<{
  /** 站点根 URL（不含尾斜杠），如 'https://example.com' */
  siteOrigin: string
  /** URL 实例，便于拼接 path */
  siteUrl: URL
  /** 是否启用分析埋点（仅生产推荐启用） */
  analyticsEnabled: boolean
  /** 默认运营城市代码 */
  defaultCity: SupportedCity
  /** 隐私政策版本 */
  privacyPolicyVersion: string
  /** 当前环境标识 */
  env: 'development' | 'production' | 'test'
}>

/** 仅用于开发环境的 fallback URL（localhost:3717 与 pnpm dev 端口一致） */
const DEV_FALLBACK_ORIGIN = 'http://localhost:3717'

/**
 * 解析 NEXT_PUBLIC_ANALYTICS_ENABLED：
 *   - 'true' / '1'（区分大小写）→ true
 *   - 其他值或缺失 → false
 */
function parseAnalyticsFlag(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1'
}

/**
 * 校验 origin 字符串：
 *   - 必须是合法的 http(s) URL；
 *   - 不能包含尾斜杠；
 *   - 不能包含 path / query / fragment。
 */
function validateOrigin(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      `[site-config] NEXT_PUBLIC_SITE_URL 不是合法 URL：${raw}`,
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `[site-config] NEXT_PUBLIC_SITE_URL 必须是 http(s) 协议，得到 ${url.protocol}`,
    )
  }
  if (raw.endsWith('/')) {
    throw new Error(
      `[site-config] NEXT_PUBLIC_SITE_URL 不能以尾斜杠结尾：${raw}`,
    )
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(
      `[site-config] NEXT_PUBLIC_SITE_URL 不能包含 path/query/fragment：${raw}`,
    )
  }
  return url
}

/**
 * 解析当前 Node.js 环境标识。
 * Next.js 在 `next dev` 时设置 NODE_ENV=development；`next build` / `next start` 时为 production；
 * 测试运行器（vitest）通常为 test。未识别时回退为 development，保守不抛错。
 */
function detectEnv(): SiteConfig['env'] {
  const v = process.env.NODE_ENV
  if (v === 'production') return 'production'
  if (v === 'test') return 'test'
  return 'development'
}

/**
 * 解析并校验 NEXT_PUBLIC_SITE_URL。
 *
 * 不变量：
 *   - 生产环境缺失 → 抛错（启动/构建时失败，确保 SEO/canonical 正确）
 *   - 开发/测试环境缺失 → 使用 DEV_FALLBACK_ORIGIN 并 console.warn
 *   - 任何环境配置了非法值 → 抛错（不静默回退）
 */
function resolveSiteOrigin(env: SiteConfig['env']): { origin: string; url: URL } {
  const raw = process.env.NEXT_PUBLIC_SITE_URL
  if (!raw || raw.trim() === '') {
    if (env === 'production') {
      throw new Error(
        '[site-config] 生产环境缺失 NEXT_PUBLIC_SITE_URL：' +
          '请设置环境变量为公开站点 URL（如 https://example.com），' +
          'sitemap/canonical/OG 均依赖此值。',
      )
    }
    // 仅在非生产环境使用 fallback，避免日志噪声
    if (env !== 'test') {
      console.warn(
        `[site-config] NEXT_PUBLIC_SITE_URL 缺失，开发环境使用 fallback：${DEV_FALLBACK_ORIGIN}`,
      )
    }
    return { origin: DEV_FALLBACK_ORIGIN, url: new URL(DEV_FALLBACK_ORIGIN) }
  }
  const url = validateOrigin(raw.trim())
  return { origin: raw.trim(), url }
}

/** 解析默认城市（必须在白名单内） */
function resolveDefaultCity(): SupportedCity {
  const raw = process.env.NEXT_PUBLIC_DEFAULT_CITY
  if (!raw || raw.trim() === '') return DEFAULT_CITY
  const trimmed = raw.trim()
  if (!SUPPORTED_CITIES.includes(trimmed as SupportedCity)) {
    throw new Error(
      `[site-config] NEXT_PUBLIC_DEFAULT_CITY 不在受支持城市白名单内：${trimmed}（受支持：${SUPPORTED_CITIES.join(', ')}）`,
    )
  }
  return trimmed as SupportedCity
}

/** 构建站点配置（懒加载缓存） */
let cachedConfig: SiteConfig | null = null

/** 获取站点配置：单例懒加载 */
export function getSiteConfig(): SiteConfig {
  if (cachedConfig) return cachedConfig
  const env = detectEnv()
  const { origin, url } = resolveSiteOrigin(env)
  cachedConfig = {
    siteOrigin: origin,
    siteUrl: url,
    analyticsEnabled: parseAnalyticsFlag(process.env.NEXT_PUBLIC_ANALYTICS_ENABLED),
    defaultCity: resolveDefaultCity(),
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    env,
  }
  return cachedConfig
}

/**
 * 重置缓存：仅供测试使用。
 * 业务代码禁止调用。
 */
export function __resetSiteConfigCacheForTests(): void {
  cachedConfig = null
}

/**
 * 单例配置对象：首次访问时构建。
 * 直接调用 getSiteConfig() 构建并缓存，避免 Proxy 带来的额外复杂度。
 *
 * 注意：在 vitest 等需要切换 env 的测试中，请直接调用 getSiteConfig()
 * 并在变更 env 后调用 __resetSiteConfigCacheForTests()。
 */
export const siteConfig: SiteConfig = getSiteConfig()
