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

/**
 * 内容页目标（2026-09-11）。
 *
 * 后台「页面内容」里新建的页面走 `/pages/[slug]`，slug 由内容决定，**进不了上面
 * 这个固定枚举**——OPT-054 时把 `pages` 路由列进了豁免名单。结果是运营建了
 * 「加入我们」却在页脚里选不到，只能拿「城市合伙人」顶替，线上就是一条错链。
 *
 * 做法：`target` 多一个值 `page`，同行再加一个 `page` 关联字段指定具体页面。
 * 护栏不变——仍然只能链到真实存在的页面，不开自由文本 URL。解析在服务端完成
 * （`resolveNavRow`），页面转草稿或删除后这一行自动不渲染，不会变成 404 死链。
 *
 * 这一项**同样要进 PG 枚举**，与上面「新增目标需要迁移」是同一条规则。
 */
export const PAGE_TARGET_ID = 'page'

/** 后台 select 的 options。 */
export const NAV_TARGET_OPTIONS = [
  ...NAV_TARGETS.map((t) => ({
    value: t.id,
    label: `${t.defaultLabel}（${t.href}）`,
  })),
  { value: PAGE_TARGET_ID, label: '内容页（/pages/…，在旁边的「内容页」里选具体页面）' },
]

export type NavLink = Readonly<{ href: string; label: string }>

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

/**
 * 把 `page` 关联解析成链接。返回 null 的三种情况都不渲染：
 *   - 关联没展开（读取 depth 不够，拿到的是数字 id）或为空；
 *   - 页面不是「已发布」；
 *   - 页面已进回收站（`deletedAt` 非空）。
 *
 * 判据与 C 端 `/pages/[slug]` 的可见条件一致（`findPublishedPageBySlug`）：
 * 导航里出现的链接，点进去必须是 200。
 */
function resolvePageLink(page: unknown): Readonly<{ href: string; defaultLabel: string }> | null {
  if (!page || typeof page !== 'object') return null
  const p = page as { slug?: unknown; status?: unknown; deletedAt?: unknown; title?: unknown }
  if (typeof p.slug !== 'string' || p.slug.length === 0) return null
  if (p.status !== 'published') return null
  if (p.deletedAt) return null
  return {
    href: `/pages/${encodeURIComponent(p.slug)}`,
    defaultLabel: text(p.title, p.slug),
  }
}

/**
 * 导航配置行 → 可渲染链接。**解析在服务端做完**，渲染层拿到的每一条都是真路由。
 *
 * 返回 null 表示这一行不渲染，都不报错：
 *   - `visible === false`：运营主动隐藏；
 *   - 目标 id 代码不认识：配置比代码新（回滚后可能出现），宁可少一个入口
 *     也不要渲染一个跳不对的链接；
 *   - `target = page` 但页面未发布 / 已删 / 没选：同上。
 */
export function resolveNavRow(row: unknown): NavLink | null {
  if (!row || typeof row !== 'object') return null
  const r = row as { target?: unknown; label?: unknown; visible?: unknown; page?: unknown }
  if (r.visible === false) return null
  if (typeof r.target !== 'string') return null

  if (r.target === PAGE_TARGET_ID) {
    const link = resolvePageLink(r.page)
    return link ? { href: link.href, label: text(r.label, link.defaultLabel) } : null
  }

  const target = navTargetById(r.target)
  if (!target) return null
  return { href: target.href, label: text(r.label, target.defaultLabel) }
}
