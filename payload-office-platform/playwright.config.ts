import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3717', headless: true },
  webServer: {
    command: 'pnpm dev',
    port: 3717,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
