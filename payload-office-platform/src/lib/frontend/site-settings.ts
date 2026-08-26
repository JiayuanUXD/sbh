import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'

import config from '@/payload.config'
import {
  SITE_SETTINGS_REVALIDATE_SECONDS,
  SITE_SETTINGS_TAG,
} from '@/domain/public-catalog'
import type { Media, SiteSetting } from '@/payload-types'

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
 *   Global 存值 → 字段 defaultValue → 这里的 FALLBACK
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

export type SiteSettingsView = Readonly<{
  siteName: string
  logo: Readonly<{ src: string; alt: string }> | null
  heroHeading: string
  slogan: string
  priceDisclaimer: string
  imageDisclaimer: string
  footerBrandBlurb: string
  copyrightHolder: string
  footerTaglineSuffix: string
  valueProps: ReadonlyArray<Readonly<{ name: string; body: string }>>
  typeCards: ReadonlyArray<Readonly<{ slot: string; label: string; sublabel: string | null }>>
}>

/**
 * 第三层兜底：逐字取自接线前各消费点的硬编码字面量。
 * 改这里之前先想清楚——它同时是「Global 尚未创建」和「字段被清空」两种情形的出口。
 */
const FALLBACK: SiteSettingsView = {
  siteName: '商办租赁',
  logo: null,
  heroHeading: '汇聚高端商务空间，赋能企业卓越成长',
  slogan: '覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策',
  priceDisclaimer: '页面价格为公开挂牌价，实际价格以顾问报价为准',
  imageDisclaimer: '示意图，以现场实际情况为准',
  footerBrandBlurb:
    '聚合{城市}甲级写字楼、独栋办公、共享办公与整层办公机会，免费帮成长型企业匹配更体面的办公室。',
  copyrightHolder: '商办租赁平台',
  footerTaglineSuffix: '商务办公租赁',
  valueProps: [
    { name: '真房源实地核验', body: '每套房源由本地顾问到场量房拍照，面积与层高逐条核过，下架即时同步。' },
    { name: '免费选址顾问', body: '按预算、通勤、注册要求给出可比清单，不收企业端服务费。' },
    { name: '全程租约护航', body: '合同条款、免租期、押付方式与交付标准全程跟进到入驻。' },
  ],
  typeCards: [
    { slot: 'traditional-office', label: '传统办公', sublabel: '独立空间 · 灵活面积' },
    { slot: 'coworking', label: '联合办公', sublabel: '工位起 · 共享配套' },
    { slot: 'full-floor', label: '整层办公', sublabel: '整层起租 · 定制形象' },
    { slot: 'serviced-office', label: '独栋办公', sublabel: '企业独栋 · 专属形象' },
    { slot: 'creative-park', label: '创意园区', sublabel: '园区生态 · 低密度' },
  ],
}

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
  if (!Array.isArray(value) || value.length === 0) return FALLBACK.valueProps
  const rows = value
    .filter((row) => typeof row?.name === 'string' && row.name.trim().length > 0)
    .map((row) => ({ name: row.name as string, body: text(row.body, '') }))
  return rows.length > 0 ? rows : FALLBACK.valueProps
}

function mapTypeCards(value: SiteSetting['typeCards']): SiteSettingsView['typeCards'] {
  if (!Array.isArray(value) || value.length === 0) return FALLBACK.typeCards
  const rows = value
    // `visible` 未设时按显示处理（字段 defaultValue 是 true，存量行也回填了 true）
    .filter((row) => row?.visible !== false && typeof row?.slot === 'string')
    .map((row) => ({
      slot: row.slot as string,
      label: text(row.label, row.slot as string),
      sublabel: text(row.sublabel, '') || null,
    }))
  return rows.length > 0 ? rows : FALLBACK.typeCards
}

function toView(doc: SiteSetting | null): SiteSettingsView {
  if (!doc) return FALLBACK
  return {
    siteName: text(doc.siteName, FALLBACK.siteName),
    logo: mapLogo(doc.logo),
    heroHeading: text(doc.heroHeading, FALLBACK.heroHeading),
    slogan: text(doc.slogan, FALLBACK.slogan),
    priceDisclaimer: text(doc.priceDisclaimer, FALLBACK.priceDisclaimer),
    imageDisclaimer: text(doc.imageDisclaimer, FALLBACK.imageDisclaimer),
    footerBrandBlurb: text(doc.footerBrandBlurb, FALLBACK.footerBrandBlurb),
    copyrightHolder: text(doc.copyrightHolder, FALLBACK.copyrightHolder),
    footerTaglineSuffix: text(doc.footerTaglineSuffix, FALLBACK.footerTaglineSuffix),
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
    return FALLBACK
  }
}

const cachedSiteSettings = unstable_cache(readSiteSettings, ['site-settings'], {
  tags: [SITE_SETTINGS_TAG],
  revalidate: SITE_SETTINGS_REVALIDATE_SECONDS,
})

/**
 * 取站点设置。**任何服务端消费方都可以直接调**——layout、页面、被页面渲染的
 * server component 一律如此，不需要谁把它当 props 传下来。
 */
export function getCachedSiteSettings(): Promise<SiteSettingsView> {
  return cachedSiteSettings()
}

/** 供测试与非缓存路径使用的默认值出口。 */
export const SITE_SETTINGS_FALLBACK = FALLBACK

/** 把 `{城市}` 占位符替换成当前城市名。运营手写城市名正是本工作项修掉的那个 bug。 */
export function renderCityPlaceholder(template: string, cityName: string): string {
  return template.replace(/\{城市\}/g, cityName)
}
