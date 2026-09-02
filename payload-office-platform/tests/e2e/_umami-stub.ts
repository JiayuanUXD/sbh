import type { Page } from '@playwright/test'

/**
 * E2E 里的 Umami 采集脚本处理（OPT-064）
 *
 * ## 为什么每个 spec 都要拦
 *
 * `quality.yml` 的 e2e job 给了构建期 `NEXT_PUBLIC_UMAMI_*`（不给的话 adapter
 * 是 Noop，埋点接线根本验不到），于是**每个前台页面都会渲染一个
 * `<script src="https://umami-e2e.invalid/script.js">`**。
 *
 * 那个域名故意不可达——但浏览器不知道，它会真的去解析，然后在控制台留下一条
 * `ERR_NAME_NOT_RESOLVED`。而 `city-partner-flow` / `detail-pages` /
 * `landing-pages` 三个 spec 都有「控制台零错误」的断言，于是全线变红。
 *
 * 关键认知：`addInitScript` 打的桩顶替的是 **`window.umami` 这个对象**，
 * 它拦不住浏览器去拉那个 `<script src>`。两件事必须分别处理。
 *
 * 换个可达的域名也解决不了：404 同样是控制台错误；而指向真实生产 Umami
 * 会让 CI 流量污染线上统计，更糟。唯一干净的做法是在 Playwright 层拦掉请求。
 */

/** 采集脚本与热图录制器的请求特征 */
const UMAMI_SCRIPT_PATTERN = /\/(script|recorder)\.js(\?|$)/

/**
 * 拦掉 Umami 脚本请求，用空 JS 兑现。
 *
 * 任何断言「控制台零错误」的 spec 都要在 `beforeEach` 里调一次，
 * 否则会被那条 `ERR_NAME_NOT_RESOLVED` 拖红——而那与被测功能毫无关系。
 */
export async function blockUmamiScript(page: Page): Promise<void> {
  await page.route(
    (url) => UMAMI_SCRIPT_PATTERN.test(url.pathname) && url.hostname.includes('umami'),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: '/* umami tracker stubbed in e2e */',
      }),
  )
}

/** 埋点桩捕获到的一条事件 */
export interface CapturedUmamiEvent {
  name: string
  data: Record<string, unknown>
}

/**
 * 在页面任何脚本执行**之前**装好 `window.umami` 桩，并把收到的事件挂到
 * `window.__umamiEvents` 上供读取。
 *
 * 这样验的是「我们这边的接线对不对」，而不是「Umami 服务通不通」——
 * 后者属于运维验收，不该由 E2E 保证，也不该让 CI 依赖一个外部服务的可用性。
 */
export async function stubUmami(page: Page): Promise<void> {
  await blockUmamiScript(page)
  await page.addInitScript(() => {
    const captured: Array<{ name: string; data: Record<string, unknown> }> = []
    Reflect.set(window, '__umamiEvents', captured)
    Reflect.set(window, 'umami', {
      track: (name: string, data: Record<string, unknown> = {}) => {
        captured.push({ name, data })
      },
      identify: () => {},
    })
  })
}

export async function readUmamiEvents(page: Page): Promise<CapturedUmamiEvent[]> {
  return page.evaluate(
    () => (Reflect.get(window, '__umamiEvents') as CapturedUmamiEvent[]) ?? [],
  )
}
