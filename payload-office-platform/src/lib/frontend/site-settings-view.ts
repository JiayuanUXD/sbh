/**
 * 站点设置的**客户端安全**部分：视图类型、兜底常量与纯函数。
 *
 * ## 为什么要单独一个文件
 *
 * `site-settings.ts` 里有 `getPayload` 与 `@/payload.config` 的 import。
 * `SiteHeader` / `SiteFooter` 是 `'use client'`，只要它们从那个模块里取哪怕一个
 * 类型或纯函数，Turbopack 就会把整条依赖链拉进浏览器包，最终撞上
 * `sharp` 的 `non-ecmascript placeable asset` —— 生产构建直接失败（57 个错误），
 * 而 typecheck 与单测**全绿**，只有 `next build` 才会暴露。
 *
 * 所以边界画在这里：**任何客户端组件要用的东西，都必须落在这个文件里**，
 * `site-settings.ts` 只放需要服务端能力的读取逻辑，并从这里 re-export，
 * 让服务端消费方仍然只需要认一个模块。
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
  /**
   * 主导航（OPT-054）。**已解析成可直接渲染的 href**——运营配的是目标 id，
   * 由服务端查 NAV_TARGETS 解析；查不到的项在这里就已经被剔除，
   * 渲染层拿到的每一条都指向真实路由。
   */
  mainNav: ReadonlyArray<Readonly<{ href: string; label: string }>>
  /** 页脚分组（OPT-054）。同上，href 已解析。空分组不会出现在这里。 */
  footerColumns: ReadonlyArray<Readonly<{ title: string; links: ReadonlyArray<Readonly<{ href: string; label: string }>> }>>
}>

/**
 * 三层兜底的第三层：逐字取自接线前各消费点的硬编码字面量。
 * 改这里之前先想清楚——它同时是「Global 尚未创建」和「字段被清空」两种情形的出口。
 */
export const SITE_SETTINGS_FALLBACK: SiteSettingsView = {
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
  // 与 public-nav.ts 的 MAIN_NAV_ITEMS / FOOTER_COLUMNS 逐条对应。
  // 那两个常量**保留不删**：它们既是这里的默认值来源，也是迁移执行前的兜底。
  mainNav: [
    { href: '/', label: '首页' },
    { href: '/listings', label: '找办公室' },
    { href: '/buildings', label: '找楼盘' },
    { href: '/listings?type=coworking', label: '共享办公' },
    { href: '/entrust', label: '委托找房' },
    { href: '/publish', label: '投放房源' },
    { href: '/news', label: '资讯' },
  ],
  footerColumns: [
    {
      title: '浏览',
      links: [
        { href: '/listings', label: '在租房源' },
        { href: '/buildings', label: '找写字楼' },
        { href: '/news', label: '资讯中心' },
      ],
    },
    {
      title: '按类型',
      links: [
        { href: '/listings?type=traditional-office', label: '传统办公' },
        { href: '/listings?type=coworking', label: '联合办公' },
        { href: '/listings?type=full-floor', label: '整层办公' },
      ],
    },
    {
      title: '服务',
      links: [
        { href: '/entrust', label: '委托找房' },
        { href: '/publish', label: '投放房源' },
      ],
    },
  ],
}

/** 把 `{城市}` 占位符替换成当前城市名。运营手写城市名正是本工作项修掉的那个 bug。 */
export function renderCityPlaceholder(template: string, cityName: string): string {
  return template.replace(/\{城市\}/g, cityName)
}
