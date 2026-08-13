/**
 * 前台统一 Metadata 工具（F6.3）
 *
 * 设计依据：specs/frontend-mvp/tasks.md F6.3
 *           specs/frontend-mvp/design.md §11
 *           docs/prd/前台网站_MVP_页面PRD/06-内容页_PRD.md §6
 *
 * 职责：
 *   - 提供 buildPageMetadata 统一辅助函数，构造 Next.js Metadata 对象；
 *   - 统一 canonical / OG / robots 字段，避免散落字面量；
 *   - 不声明后台数据不能保证的字段（如 author / datePublished / price / inventory）。
 *
 * 不变量：
 *   - canonical 必须为相对路径（如 '/listings'、'/pages/<slug>'），由 metadataBase 拼接；
 *   - OG url 由 siteOrigin + canonicalPath 拼接，确保绝对 URL；
 *   - 默认 robots: index=true, follow=true；草稿/404 由调用方覆盖为 noindex；
 *   - 不设置 keywords（Google 已不使用，避免散落关键词）。
 */

import type { Metadata } from 'next'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import { siteConfig } from './site-config'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** buildPageMetadata 入参 */
export type BuildPageMetadataInput = Readonly<{
  /** 页面标题（已包含品牌后缀由 template 处理，调用方只传页面名） */
  title: string
  /** 页面描述，用于 <meta name="description"> 与 OG description */
  description?: string
  /** canonical 相对路径，如 '/listings'、'/pages/office-guide'；首页为 '/' */
  canonicalPath: string
  /** OG 类型，默认 'website'；文章型内容用 'article' */
  ogType?: 'website' | 'article' | 'profile'
  /** OG 图片绝对或相对 URL；缺省由 layout 默认 */
  ogImage?: string
  /**
   * robots 策略：
   *   - 'index'（默认）：index, follow
   *   - 'noindex'：noindex, follow（404 / 草稿 / 越界页）
   */
  robots?: 'index' | 'noindex'
}>

export type CityMetadataPageType = 'home' | 'listings' | 'buildings'

export type BuildCityPageMetadataInput = Readonly<{
  city: CityContext
  pageType: CityMetadataPageType
  multiCityRoutingEnabled: boolean
  routeMode?: 'legacy' | 'prefixed'
  canonicalQuery?: string
}>

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 构造统一的 Next.js Metadata 对象
 *
 * 使用方式：
 *   export async function generateMetadata(): Promise<Metadata> {
 *     return buildPageMetadata({
 *       title: '在租房源',
 *       description: '...',
 *       canonicalPath: '/listings',
 *     })
 *   }
 *
 * canonical 与 OG url 由 metadataBase（layout.tsx 已设置 siteConfig.siteUrl）
 * 与 canonicalPath 拼接。OG url 显式构造绝对 URL，确保分享卡片正确。
 */
export function buildPageMetadata(input: BuildPageMetadataInput): Metadata {
  const {
    title,
    description,
    canonicalPath,
    ogType = 'website',
    ogImage,
    robots = 'index',
  } = input

  // OG url 必须为绝对 URL；siteOrigin 不含尾斜杠
  const ogUrl = `${siteConfig.siteOrigin}${canonicalPath}`

  const robotsPolicy =
    robots === 'noindex'
      ? { index: false, follow: true }
      : { index: true, follow: true }

  const openGraph: NonNullable<Metadata['openGraph']> = {
    type: ogType,
    locale: 'zh_CN',
    siteName: siteConfig.siteUrl.hostname,
    title,
    url: ogUrl,
  }
  if (description) {
    openGraph.description = description
  }
  if (ogImage) {
    openGraph.images = [{ url: ogImage }]
  }

  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: canonicalPath },
    openGraph,
    robots: robotsPolicy,
  }
}

const CITY_PAGE_COPY: Readonly<Record<Exclude<CityMetadataPageType, 'home'>, Readonly<{
  title: (cityName: string) => string
  description: (cityName: string) => string
}>>> = {
  listings: {
    title: (cityName) => `${cityName}在租房源`,
    description: (cityName) => `${cityName}写字楼、服务式办公室与共享办公在租房源。`,
  },
  buildings: {
    title: (cityName) => `${cityName}写字楼`,
    description: (cityName) => `${cityName}写字楼与办公楼盘信息。`,
  },
}

/** Builds city SEO from the already-resolved public CityContext only. */
export function buildCityPageMetadata(input: BuildCityPageMetadataInput): Metadata {
  const { city, pageType, multiCityRoutingEnabled, routeMode = 'prefixed', canonicalQuery } = input
  const suffix = pageType === 'home' ? '' : `/${pageType}`
  const canonicalBase = multiCityRoutingEnabled ? `/${city.slug}${suffix}` : suffix || '/'
  const canonicalPath = canonicalQuery ? `${canonicalBase}?${canonicalQuery}` : canonicalBase
  const copy = pageType === 'home'
    ? { title: city.profile.seoTitle, description: city.profile.seoDescription }
    : {
        title: CITY_PAGE_COPY[pageType].title(city.name),
        description: CITY_PAGE_COPY[pageType].description(city.name),
      }
  const noindex = city.serviceStatus === 'coming-soon'
    || (!multiCityRoutingEnabled && routeMode === 'prefixed')

  return buildPageMetadata({
    ...copy,
    canonicalPath,
    robots: noindex ? 'noindex' : 'index',
  })
}

/** All city query variants are selection state for one global partner page. */
export function cityPartnerCanonical(_query?: unknown): '/city-partner' {
  return '/city-partner'
}

/**
 * 构造 404 / not found 页面的 metadata（noindex, follow）
 *
 * 用于页面不存在、草稿、已删除等场景，避免搜索引擎索引无效页面。
 */
export function buildNotFoundMetadata(title: string = '页面未找到'): Metadata {
  return {
    title,
    robots: { index: false, follow: false },
  }
}
