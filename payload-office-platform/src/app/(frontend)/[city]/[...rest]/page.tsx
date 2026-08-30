import { notFound } from 'next/navigation'

/**
 * C 端 catch-all 兜底 —— 让 `[city]/` 下"压根没匹配上任何路由"的请求先被接住，
 * 再显式 notFound()，从而落到 `(frontend)/not-found.tsx` 已经写好的边界。
 *
 * 背景（协调 agent 用 Playwright 实测发现的缺口）：`not-found.tsx` 只在**已经
 * 匹配到某个 page、该 page 自己抛 notFound()** 时才生效——例如 `/not-a-city`
 * 能落到自定义 404，是因为 `[city]/page.tsx` 匹配上了 `city` 段、自己发现不是
 * 合法城市再调用 notFound()。但 `/shanghai/definitely-not-a-real-page` 这类
 * 请求里，`shanghai` 匹配 `[city]`，第二段 `definitely-not-a-real-page` 在
 * `[city]/` 下没有任何静态段（`listings`/`buildings`/`sale`）或动态段能接——
 * Next.js 根本没有解析出完整的段树、没有 page 组件被渲染，因此不会经过任何
 * `not-found.tsx` 边界，而是直接回落到内置默认 404（无页头页脚、英文、
 * `prefers-color-scheme: dark`）。这正是本仓库同时存在 `(frontend)` 与
 * `(payload)` 两个 root layout 时的已知限制：Next 在"连壳都没解析出来"时无从
 * 选择套哪个 layout。加一个 catch-all 段先把请求接住，是让这类 URL 也能拿到
 * 完整 layout + 自定义 404 内容的标准做法。
 *
 * 路由匹配优先级（同目录层级、Next.js 官方规则）：静态段 > 动态段 > catch-all。
 * `[city]/listings`、`[city]/buildings`、`[city]/sale`、`[city]` 本身都比这个
 * catch-all 更具体，不会被它抢走；`[city]/listings/[slug]` 这类下一级动态段
 * 同理不受影响——本文件只在同层没有任何其它段能匹配时才会被选中。
 *
 * 不读取任何数据，纯粹是路由兜底。标注 `force-dynamic` 不是为了拿到"每请求
 * 都执行"的效果（notFound() 本来就与是否动态渲染无关），而是防止 `next build`
 * 在没有 `generateStaticParams` 的情况下尝试对这个 catch-all 段做静态预渲染
 * ——与 `[city]/*` 下其余页面的既有写法（均标注 `dynamic = 'force-dynamic'`）
 * 保持一致，行为可预期。
 */
export const dynamic = 'force-dynamic'

export default function CityCatchAllPage() {
  notFound()
}
