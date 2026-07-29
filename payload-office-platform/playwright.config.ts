/**
 * F7.1 全链路 E2E Playwright 配置
 *
 * 设计依据：specs/frontend-mvp/tasks/F7-acceptance.md 7.1
 *
 * 策略：
 *   - 仅启用 chromium（项目性能预算约束）
 *   - webServer 自动启动 `pnpm dev`（端口 3717）
 *   - baseURL 由 NEXT_PUBLIC_SITE_URL 注入，默认 http://localhost:3717
 *   - testDir 指向 tests/e2e，与 vitest 隔离
 *   - 失败重试 2 次，截图 + trace 在失败时保留
 */
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 3717)
const baseURL = process.env.NEXT_PUBLIC_SITE_URL ?? `http://localhost:${PORT}`

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
  // 本地 dev server 自管理：CI 里自动拉起 `pnpm dev`（next dev -p 3717，dev 模式不触发
  // 生产 fail-closed，连 job 级 SQLITE_URL 的已 seed 库）；本地若已有 server 在跑则复用，
  // 避免与 vitest / 手动调试争用端口。url 用 baseURL（未设 NEXT_PUBLIC_SITE_URL 时即
  // http://localhost:3717），确保等待和请求都指向本地 server 而非线上。
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `${baseURL}/admin`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
