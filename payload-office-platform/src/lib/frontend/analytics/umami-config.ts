/**
 * Umami 接入配置的单一真源（OPT-064）
 *
 * 两个调用方各自判断「分析是否开启」会漂移：`layout.tsx` 注了脚本而 `init.ts`
 * 选了 Noop，或者反过来——脚本没注但 adapter 一直往不存在的 `window.umami` 上抛错、
 * 队列白重试三轮。判据只写一处。
 *
 * ## 为什么必须写成静态成员表达式
 *
 * `NEXT_PUBLIC_*` 由 Next 在 **`next build` 时内联成字面量**，靠的是对
 * `process.env.NEXT_PUBLIC_FOO` 这种**静态成员表达式**做文本替换。
 * 写成 `process.env[name]` 动态取值，客户端拿到的是 `undefined`——
 * 本仓库已经在 `NEXT_PUBLIC_SITE_URL` 上吃过这个亏（见 `.agent/testing.md`
 * 「本地 next start 的两条环境事实」）。所以下面三个变量必须逐个写全。
 *
 * 推论：这三个值改了要**重新构建**才生效，配在 CloudRun 的服务级环境变量里
 * 对客户端 bundle 不可见。它们的归属是 Dockerfile 的 builder 阶段 ENV。
 */

export interface UmamiConfig {
  /** Umami 服务的 origin，例如 https://umami-xxx.sh.run.tcloudbase.com */
  src: string
  /** 站点条目 ID（UUID） */
  websiteId: string
  /** 是否加载 recorder.js（点击/滚动热图） */
  heatmap: boolean
}

/** 与 `site-config.ts` 的 `parseAnalyticsFlag` 同口径：只认 'true' / '1'。 */
function isEnabledFlag(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}

/** 去掉末尾斜杠，避免拼出 `https://host//script.js` */
function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * 解析 Umami 接入配置。
 *
 * 返回 null 表示**未接入**：调用方应退化为无行为（不注脚本、adapter 用 Noop），
 * 而不是报错。这让「代码已合、Umami 还没部署」成为一个完全安静的中间状态。
 */
export function resolveUmamiConfig(): UmamiConfig | null {
  const enabled = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED
  const src = process.env.NEXT_PUBLIC_UMAMI_SRC
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID
  const heatmap = process.env.NEXT_PUBLIC_UMAMI_HEATMAP

  if (!isEnabledFlag(enabled)) return null
  if (!src || !websiteId) return null

  return {
    src: normalizeOrigin(src),
    websiteId,
    heatmap: isEnabledFlag(heatmap),
  }
}
