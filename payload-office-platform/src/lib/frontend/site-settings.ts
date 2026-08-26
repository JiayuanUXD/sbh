import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'

import config from '@/payload.config'
import {
  SITE_SETTINGS_REVALIDATE_SECONDS,
  SITE_SETTINGS_TAG,
} from '@/domain/public-catalog'
import type { Media, SiteSetting } from '@/payload-types'
import { SITE_SETTINGS_FALLBACK, type SiteSettingsView } from './site-settings-view'

// 客户端组件只能从 './site-settings-view' 取（本文件 import 了 payload，
// 被 'use client' 组件引用会把 sharp 拉进浏览器包 → next build 失败）。
// 这里 re-export 只是让服务端消费方仍然认一个模块。
export { SITE_SETTINGS_FALLBACK, renderCityPlaceholder } from './site-settings-view'
export type { SiteSettingsView } from './site-settings-view'

/**
 * OPT-053：站点设置的公开读取层。
 *
 * ## 为什么是「共享读取器」而不是「layout 传 props」
 *
 * 设计初稿写的是「在 `(frontend)/layout.tsx` 读一次，经 props 下发」。**那是错的。**
 * layout 只能给它**直接渲染**的组件传 props（SiteHeader / SiteFooter）——页面组件
 * 是以不透明的 `{children}` 传进来的，注入不了任何东西。而消费方大半在 children 里：
 * HomeHero、HomeValueProps、HomeTypeCards、详情页的合规声明。
 *
 * 按 props 方案实施的结果是「页头页脚生效、首页与详情页不生效」——**正好是本工作项
 * 要修的那个病再来一次**。所以边界定成：任何消费方都能调这个函数，不依赖谁是谁的
 * 父组件。同一请求内多次调用由 `unstable_cache` 去重，不产生额外 DB 往返。
 *
 * ## 三层兜底
 *
 *   Global 存值 → 字段 defaultValue → `site-settings-view.ts` 的 SITE_SETTINGS_FALLBACK
 *
 * 第三层不能省：`site_settings` 表在迁移执行前不存在，构建期与迁移前的渲染会直接
 * 抛错。有了它，本工作项才能分两次发布（先让运营把内容填进去，再接线）。
 *
 * ## 已知约束（OPT-042）
 *
 * CloudRun 多实例下 `revalidateTag` 只作用于当前实例，其余实例要等 TTL。
 * 因此 TTL 压到 60 秒，后台编辑页也明写了「保存后最长 60 秒全站生效」。
 * 不写那句话，运营又会得到一次「配了不生效」。
 */



/** 空字符串按「没填」处理：运营清空一个字段的意思是恢复默认，不是让页面出现空白。 */
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

function mapLogo(value: SiteSetting['logo']): SiteSettingsView['logo'] {
  if (!value || typeof value !== 'object') return null
  const media = value as Media
  return typeof media.url === 'string' && media.url.length > 0
    ? { src: media.url, alt: typeof media.alt === 'string' ? media.alt : '' }
    : null
}

function mapValueProps(value: SiteSetting['valueProps']): SiteSettingsView['valueProps'] {
  if (!Array.isArray(value) || value.length === 0) return SITE_SETTINGS_FALLBACK.valueProps
  const rows = value
    .filter((row) => typeof row?.name === 'string' && row.name.trim().length > 0)
    .map((row) => ({ name: row.name as string, body: text(row.body, '') }))
  return rows.length > 0 ? rows : SITE_SETTINGS_FALLBACK.valueProps
}

function mapTypeCards(value: SiteSetting['typeCards']): SiteSettingsView['typeCards'] {
  if (!Array.isArray(value) || value.length === 0) return SITE_SETTINGS_FALLBACK.typeCards
  const rows = value
    // `visible` 未设时按显示处理（字段 defaultValue 是 true，存量行也回填了 true）
    .filter((row) => row?.visible !== false && typeof row?.slot === 'string')
    .map((row) => ({
      slot: row.slot as string,
      label: text(row.label, row.slot as string),
      sublabel: text(row.sublabel, '') || null,
    }))
  return rows.length > 0 ? rows : SITE_SETTINGS_FALLBACK.typeCards
}

function toView(doc: SiteSetting | null): SiteSettingsView {
  if (!doc) return SITE_SETTINGS_FALLBACK
  return {
    siteName: text(doc.siteName, SITE_SETTINGS_FALLBACK.siteName),
    logo: mapLogo(doc.logo),
    heroHeading: text(doc.heroHeading, SITE_SETTINGS_FALLBACK.heroHeading),
    slogan: text(doc.slogan, SITE_SETTINGS_FALLBACK.slogan),
    priceDisclaimer: text(doc.priceDisclaimer, SITE_SETTINGS_FALLBACK.priceDisclaimer),
    imageDisclaimer: text(doc.imageDisclaimer, SITE_SETTINGS_FALLBACK.imageDisclaimer),
    footerBrandBlurb: text(doc.footerBrandBlurb, SITE_SETTINGS_FALLBACK.footerBrandBlurb),
    copyrightHolder: text(doc.copyrightHolder, SITE_SETTINGS_FALLBACK.copyrightHolder),
    footerTaglineSuffix: text(doc.footerTaglineSuffix, SITE_SETTINGS_FALLBACK.footerTaglineSuffix),
    valueProps: mapValueProps(doc.valueProps),
    typeCards: mapTypeCards(doc.typeCards),
  }
}

async function readSiteSettings(): Promise<SiteSettingsView> {
  try {
    const payload = await getPayload({ config })
    const doc = (await payload.findGlobal({
      slug: 'site-settings',
      // depth 1 展开 logo 关联；再深没有意义
      depth: 1,
      overrideAccess: true,
    })) as SiteSetting | null
    return toView(doc)
  } catch (error) {
    // 迁移执行前该表不存在；构建期预渲染也走这条路。不能让整站因此崩掉。
    console.error('[site-settings] read failed, falling back to defaults', error)
    return SITE_SETTINGS_FALLBACK
  }
}

const cachedSiteSettings = unstable_cache(readSiteSettings, ['site-settings'], {
  tags: [SITE_SETTINGS_TAG],
  revalidate: SITE_SETTINGS_REVALIDATE_SECONDS,
})

/**
 * 取站点设置。**任何服务端消费方都可以直接调**——layout、页面、被页面渲染的
 * server component 一律如此，不需要谁把它当 props 传下来。
 *
 * `unstable_cache` 在没有 Next 增量缓存上下文时会抛
 * `Invariant: incrementalCache missing`（单测直接渲染 layout、脚本里调用等都会撞上）。
 * 那是「这条链路没有缓存可用」，不是「读取失败」，所以降级为不走缓存的直读，
 * 而不是让整个页面炸掉。同型处理见 `public-cache-revalidation.ts` 对
 * `static generation store missing` 的判断。
 */
export async function getCachedSiteSettings(): Promise<SiteSettingsView> {
  try {
    return await cachedSiteSettings()
  } catch (error) {
    if (error instanceof Error && error.message.includes('incrementalCache missing')) {
      return readSiteSettings()
    }
    throw error
  }
}

