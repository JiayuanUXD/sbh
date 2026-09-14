/**
 * OPT-097：页脚 ICP 备案号。站点设置里填了号 → 首页页脚出现指向工信部的链接；清空 → 不渲染。
 * 写法沿用 member-auth.spec 的开关模式：request 上下文登录后台管理员改 Global，page 上下文验 C 端。
 * afterChange 已挂 revalidateTag，单实例下改完即时生效，不用等 60 秒 TTL。
 */
import { expect, test, type APIRequestContext } from '@playwright/test'

const BASE = (process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3717}`).replace(/\/$/, '')
const ORIGIN_HEADERS = { origin: BASE, 'content-type': 'application/json' }
const ADMIN = { email: 'e2e-adm@example.com', password: 'Test1234!' }
const ICP = '沪ICP备2026037944号'

async function setIcpRecordNumber(request: APIRequestContext, value: string | null) {
  const login = await request.post(`${BASE}/api/users/login`, { data: ADMIN, failOnStatusCode: false })
  expect(login.status(), 'E2E 管理员账号应成功登录').toBe(200)
  return request.post(`${BASE}/api/globals/site-settings`, {
    data: { icpRecordNumber: value },
    headers: ORIGIN_HEADERS,
    failOnStatusCode: false,
  })
}

test.describe('页脚 ICP 备案号（OPT-097）', () => {
  test('默认不渲染；配置后出现工信部链接；清空后消失', async ({ page, request }) => {
    await page.goto('/')
    await expect(page.locator('.site-footer__icp')).toHaveCount(0)

    expect((await setIcpRecordNumber(request, ICP)).status()).toBe(200)
    try {
      await page.goto('/')
      const link = page.locator('.site-footer__icp')
      await expect(link).toHaveText(ICP)
      await expect(link).toHaveAttribute('href', 'https://beian.miit.gov.cn/')
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    } finally {
      expect((await setIcpRecordNumber(request, null)).status()).toBe(200)
    }
    await page.goto('/')
    await expect(page.locator('.site-footer__icp')).toHaveCount(0)
  })

  test('格式不对的号保存被拒（400），不会挂到线上', async ({ request }) => {
    const res = await setIcpRecordNumber(request, 'abc')
    expect(res.status()).toBe(400)
    const body = (await res.json()) as { errors?: Array<{ message?: string }> }
    expect(JSON.stringify(body.errors ?? [])).toContain('ICP备')
  })
})
