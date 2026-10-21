import { toAbsoluteMediaUrl } from './detail-metadata'

/**
 * 站点级结构化数据：Organization + WebSite，放在城市首页（OPT-123）。
 *
 * 作用是告诉搜索引擎「这个域名对应哪个品牌」，品牌名搜索与站点名展示都靠它。
 * 刻意不写：
 * - `SearchAction`：Google 已停用站内搜索框富媒体结果，写了没有收益；
 * - 地址、电话、社交账号、`sameAs`：站内没有一份经确认的权威资料，不虚构。
 */
export type SiteJsonLd = Readonly<{
  '@context': 'https://schema.org'
  '@graph': ReadonlyArray<Readonly<Record<string, unknown>>>
}>

export function buildSiteJsonLd(
  origin: string,
  siteName: string,
  logoSrc: string | null | undefined,
): SiteJsonLd {
  const rootUrl = `${origin}/`
  const logo = toAbsoluteMediaUrl(origin, logoSrc ?? undefined)
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: siteName,
        url: rootUrl,
        ...(logo ? { logo } : {}),
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: siteName,
        url: rootUrl,
        inLanguage: 'zh-CN',
        publisher: { '@id': `${origin}/#organization` },
      },
    ],
  }
}
