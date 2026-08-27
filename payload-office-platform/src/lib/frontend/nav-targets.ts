import { LISTING_TYPES } from '@/domain/review/listing-fields'

/**
 * OPT-054：导航可选目标池。
 *
 * ## 为什么导航目标必须由代码决定
 *
 * 导航项的 `href` 指向真实路由。做成后台自由文本框，运营填错的后果是：
 *
 *   - Next.js 对不存在的路由渲染 404，**不抛异常、不进日志告警**；
 *   - 页脚死链尤其隐蔽——没人天天点页脚，可能几个月无人察觉；
 *   - 带参路由（`/listings?type=coworking`）的参数值绑定 `listingType` 枚举，
 *     填一个不存在的枚举值**不会 404，会返回空结果页**，比 404 更难发现。
 *
 * 所以运营能改的是：**顺序、标签、显隐、分组归属**。不能改：目标 URL 本身。
 * 与 `HomeTypeCards` 的 `SLOT_TARGETS` 是同一判断（OPT-053 §4.4）——
 * 枚举与路由归代码，展示归运营。
 *
 * ## 新增目标需要发版，**而且需要一条迁移**
 *
 * 这是有意的：新增一个目标意味着有一个新页面，而新页面本来就要发版。
 *
 * 但代价比「改个数组」大——本池子会生成后台 `select` 的 options，Payload 据此
 * 建了 PG 枚举（`enum_site_settings_main_nav_target` /
 * `..._footer_columns_links_target`）。**往这里加一项就要配一条
 * `ALTER TYPE ... ADD VALUE` 迁移**，不能只改代码。
 *
 * 删一项更麻烦：PG 不支持从枚举里删值，且已有配置行可能仍引用它。
 * 真要下线某个目标，优先让对应页面下线并把该项留在池子里，
 * 由渲染层跳过（`navTargetById` 返回 undefined 时不渲染）。
 */

export type NavTarget = Readonly<{
  /** 稳定标识。存进配置行的就是它，**不是 href**——href 改了配置不用跟着改。 */
  id: string
  href: string
  /** 后台下拉里显示的名字，同时是新建导航项时的默认标签。 */
  defaultLabel: string
}>

/** 静态路由目标。与 `src/app/(frontend)/` 下的顶层公开路由一一对应。 */
const STATIC_TARGETS: readonly NavTarget[] = [
  // 首页。多城市前缀不用在这里处理——`cityAwareHref` 认识 `home` 这个 pageType
  // （CitySwitcher.tsx），会把 `/` 自动变成 `/{city}`。
  { id: 'home', href: '/', defaultLabel: '首页' },
  { id: 'listings', href: '/listings', defaultLabel: '找办公室' },
  { id: 'buildings', href: '/buildings', defaultLabel: '找楼盘' },
  { id: 'entrust', href: '/entrust', defaultLabel: '委托找房' },
  { id: 'publish', href: '/publish', defaultLabel: '投放房源' },
  { id: 'news', href: '/news', defaultLabel: '资讯' },
  { id: 'city-partner', href: '/city-partner', defaultLabel: '城市合伙人' },
  { id: 'sale', href: '/sale', defaultLabel: '找出售房源' },
]

/**
 * 房源类型目标。**由枚举生成，不手写**。
 *
 * 手写的代价在 OPT-053 已经兑现过一次：`stable-sort` 里那张只列了 3 个取值的
 * 映射表，与 12 个取值的 `PriceDisplayUnit` 长期不同步，最终表现为整页清空。
 * 同名同义的东西各写一份，多出来的那份迟早只覆盖一部分。
 */
const LISTING_TYPE_LABELS: Readonly<Record<(typeof LISTING_TYPES)[number], string>> = {
  'traditional-office': '传统办公',
  'coworking': '联合办公',
  'full-floor': '整层办公',
  'serviced-office': '独栋办公',
}

const TYPE_TARGETS: readonly NavTarget[] = LISTING_TYPES.map((type) => ({
  id: `listings-type-${type}`,
  href: `/listings?type=${type}`,
  defaultLabel: LISTING_TYPE_LABELS[type],
}))

export const NAV_TARGETS: readonly NavTarget[] = [...STATIC_TARGETS, ...TYPE_TARGETS]

const BY_ID = new Map(NAV_TARGETS.map((t) => [t.id, t]))

/** 按 id 取目标。配置里出现代码不认识的 id 时返回 undefined，渲染层据此跳过该项。 */
export function navTargetById(id: string): NavTarget | undefined {
  return BY_ID.get(id)
}

/** 后台 select 的 options。 */
export const NAV_TARGET_OPTIONS = NAV_TARGETS.map((t) => ({
  value: t.id,
  label: `${t.defaultLabel}（${t.href}）`,
}))
