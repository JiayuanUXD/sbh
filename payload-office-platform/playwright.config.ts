/**
 * F7.1 全链路 E2E Playwright 配置
 *
 * 设计依据：specs/frontend-mvp/tasks/F7-acceptance.md 7.1
 *
 * 策略：
 *   - 仅启用 chromium（项目性能预算约束）
 *   - webServer 自动启动本地 server：CI 用 `next start`（生产构建，无逐路由 JIT 编译，
 *     消除导航 10s poll 超时）；本地用 `next dev`（reuseExistingServer 复用已跑的 server）
 *   - baseURL 恒指向本地 server（PLAYWRIGHT_BASE_URL ?? http://localhost:PORT）；
 *     **绝不**用 NEXT_PUBLIC_SITE_URL 当 baseURL——生产 fail-closed 守卫要求它是线上 https
 *     URL，若拿它当 baseURL 会把 E2E 打到线上而非本地 server（见 lib/runtime/config-guard）
 *   - testDir 指向 tests/e2e，与 vitest 隔离
 *   - 失败重试 2 次，截图 + trace 在失败时保留
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 3717)
// baseURL 只认本地 server：显式 PLAYWRIGHT_BASE_URL 覆盖，否则 localhost:PORT。
// 与 NEXT_PUBLIC_SITE_URL 解耦——后者在生产 server 下必须是线上 https（过 fail-closed 守卫）。
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`

export function resolveServerReadyURL(
  localBaseURL: string,
  explicitURL: string | undefined,
): string {
  return explicitURL ?? `${localBaseURL}/admin`
}

// 深工作树的 webpack dev 编译 Payload admin 代价高；允许调用方改用已知轻量路由探活。
// 默认仍保持既有 /admin 契约，CI 与历史套件行为不变。
const serverReadyURL = resolveServerReadyURL(baseURL, process.env.PLAYWRIGHT_SERVER_URL)

// E2E_PROD_SERVER=1 时用生产 server（先 `next build` 再 `next start`），消除 next dev
// 的逐路由 JIT 编译慢（admin 导航在 10s poll 内不可交互的根因）。本地默认走 next dev。
const useProdServer = !!process.env.E2E_PROD_SERVER
const serverCommand = useProdServer
  ? `pnpm exec next start -p ${PORT}`
  : `pnpm exec next dev -p ${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // 本地 server 自管理：CI 里自动拉起（next start 生产 server / next dev 本地）；
  // 本地若已有 server 在跑则复用（reuseExistingServer），避免与 vitest / 手动调试争用端口。
  // url 用 baseURL（localhost:PORT），确保等待和请求都指向本地 server 而非线上。
  webServer: {
    command: serverCommand,
    url: serverReadyURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
