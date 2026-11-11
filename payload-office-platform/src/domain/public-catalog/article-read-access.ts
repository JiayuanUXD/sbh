import type { Access, AccessArgs, Where } from 'payload'

/**
 * 资讯的读侧准入：谁能读什么。
 *
 * ## 为什么要有这一层
 *
 * `Articles` 没有 `versions.drafts`，`status`（draft / published）只是个普通 select 字段，
 * Payload 不会替我们挡草稿——挡不挡完全取决于 `access.read`。它原先是 `() => true`，
 * 注释写「published 过滤由 facade 查询承担」。那句话只对 C 端成立：C 端走 Local API
 * （默认 overrideAccess: true），查询层自己带 `status = published`。而 Payload 自带的
 * REST / GraphQL 不经过 facade，于是匿名可以：
 *
 *   GET /api/articles?where[status][equals]=draft   枚举全部草稿，拿到完整正文
 *   GET /api/articles/<草稿 id>                      按 id 读
 *   GET /api/articles?trash=true                     读回收站里的文章（含已发布后又删掉的）
 *
 * 导入后默认存草稿、等人工上架的流程（`news:publish`、`import-articles`）让这个洞一直开着
 * 一批「还没准备好对外」的正文。同类问题 Listings / Buildings 已按同一手法收口（OPT-104）。
 *
 * ## 口径
 *
 * - 匿名、会员、没有资讯菜单码的后台账号：只读「已发布且没进回收站」。
 * - 持资讯菜单码的后台账号（与写侧 `canManageArticle` 同一道门：ADM、OPS，以及资讯日更专用账号）：
 *   全读，后台列表、编辑页、回收站、`news:publish` 的 slug 占用检查都靠它。
 *
 * 「没进回收站」必须写进 Where：Payload 对 `trash: true` 的集合在 `?trash=true` 时会撤掉
 * 自己默认加的 `deletedAt` 过滤，只有 access Where 里带着它，匿名才拿不到回收站。
 *
 * ## 边界（别以为它是完备的）
 *
 * - Local API 默认 overrideAccess: true，C 端、sitemap、首页资讯区、搜索都不经过这里，行为零变化；
 *   真正被收窄的只有 REST / GraphQL 与显式 `overrideAccess: false` 的调用。
 * - C 端各处查询（`supply-adapter.ts` 的 `findLatestArticles` 等）仍各自写着同样的两个条件，
 *   本文件没有改它们。改动它们是另一件事（热文件、多分支在改），这里只保证「API 侧」不比「页面侧」宽。
 */

/** 对外可见的资讯：已发布，且没有被移入回收站。每次返回新对象——Payload 会把它与请求的 where 合并。 */
export function getPublishedArticleWhere(): Where {
  return {
    status: { equals: 'published' },
    deletedAt: { exists: false },
  }
}

/**
 * @param canViewAll 能看全部状态（含草稿、回收站）的判据；Articles 里传写侧同一个 `canManageArticle`。
 */
export function createArticleReadAccess(canViewAll: (args: AccessArgs) => Promise<boolean>): Access {
  return async (args) => ((await canViewAll(args)) ? true : getPublishedArticleWhere())
}
