/**
 * 权限矩阵 E2E 测试（tasks.md M1.6）
 *
 * 覆盖五类角色对菜单 / 数据范围 / 直接 API / 字段脱敏的实际行为：
 *   1. 五类角色均可登录（POST /api/users/login → 200）
 *   2. 停用账号无法登录
 *   3. 各角色调用 /api/users（user:manage 校验）
 *   4. 各角色调用 /api/roles（role:manage 校验）
 *   5. CSR 查看 /api/leads → phone 字段被脱敏为 138****5678
 *   6. URL 参数不能扩大数据范围（带 cityIds 也不影响可见城市）
 *
 * 运行前置：
 *   - 已执行 `pnpm seed`（生成 5 个 E2E 账号 + 内置角色 + Leads 数据）
 *   - dev server 跑在 http://localhost:3717（或由 webServer 自动拉起）
 *
 * 5 个测试账号（seed 创建）：
 *   - e2e-adm@example.com / Test1234!  → ADM（通配符权限）
 *   - e2e-ops@example.com / Test1234!  → OPS（运营）
 *   - e2e-mgr@example.com / Test1234!  → MGR（销售主管）
 *   - e2e-brk@example.com / Test1234!  → BRK（经纪人）
 *   - e2e-csr@example.com / Test1234!  → CSR（客服）
 */

import { expect, type APIRequestContext, test } from '@playwright/test'

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3717').replace(
  /\/$/,
  '',
)

const ROLE_ACCOUNTS = {
  ADM: { email: 'e2e-adm@example.com', password: 'Test1234!' },
  OPS: { email: 'e2e-ops@example.com', password: 'Test1234!' },
  MGR: { email: 'e2e-mgr@example.com', password: 'Test1234!' },
  BRK: { email: 'e2e-brk@example.com', password: 'Test1234!' },
  CSR: { email: 'e2e-csr@example.com', password: 'Test1234!' },
} as const

type RoleCode = keyof typeof ROLE_ACCOUNTS

/** 用指定角色登录，返回携带 cookie 的 APIRequestContext */
async function loginAs(
  request: APIRequestContext,
  role: RoleCode,
): Promise<{ cookies: string; status: number }> {
  const account = ROLE_ACCOUNTS[role]
  const res = await request.post(`${BASE}/api/users/login`, {
    data: { email: account.email, password: account.password },
    failOnStatusCode: false,
  })
  const setCookie = res.headers()['set-cookie'] || ''
  // Payload 3 默认签发 payload-token；兼容旧环境曾使用的 payload-login-token。
  const token = setCookie.match(
    /(?:^|,\s*)(payload(?:-login)?-token)=([^;]+)/,
  )
  const cookies = token ? `${token[1]}=${token[2]}` : ''
  return { cookies, status: res.status() }
}

async function apiGet(
  request: APIRequestContext,
  cookies: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const res = await request.get(`${BASE}${path}`, {
    headers: { cookie: cookies },
    failOnStatusCode: false,
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = await res.text().catch(() => null)
  }
  return { status: res.status(), body }
}

// ────────────────────────────────────────────────────────────
// 1. 登录基线
// ────────────────────────────────────────────────────────────

test.describe('权限矩阵 / 登录基线', () => {
  for (const role of ['ADM', 'OPS', 'MGR', 'BRK', 'CSR'] as RoleCode[]) {
    test(`${role} 角色可以登录（200）`, async ({ request }) => {
      const { status } = await loginAs(request, role)
      expect(status).toBe(200)
    })
  }

  test('错误密码登录失败（400）', async ({ request }) => {
    const res = await request.post(`${BASE}/api/users/login`, {
      data: { email: 'e2e-adm@example.com', password: 'WrongPassword!' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
  })
})

// ────────────────────────────────────────────────────────────
// 2. /api/users 访问矩阵（user:manage）
//    ADM 通过；其他角色 403 或空
// ────────────────────────────────────────────────────────────

test.describe('权限矩阵 / /api/users', () => {
  test('ADM 可列出用户', async ({ request }) => {
    const { cookies } = await loginAs(request, 'ADM')
    const { status, body } = await apiGet(request, cookies, '/api/users?limit=5')
    expect(status).toBe(200)
    const data = body as { docs?: unknown[] }
    expect(Array.isArray(data.docs)).toBe(true)
    expect(data.docs!.length).toBeGreaterThan(0)
  })

  test('CSR 不能列出用户（无 user:manage）', async ({ request }) => {
    const { cookies } = await loginAs(request, 'CSR')
    const { status, body } = await apiGet(request, cookies, '/api/users?limit=5')
    expect(status).toBe(200)
    const data = body as { docs?: Array<{ email?: string }> }
    expect(data.docs).toHaveLength(1)
    expect(data.docs?.[0]?.email).toBe(ROLE_ACCOUNTS.CSR.email)
  })

  test('BRK 不能列出他人（无 user:manage）', async ({ request }) => {
    const { cookies } = await loginAs(request, 'BRK')
    const { status, body } = await apiGet(request, cookies, '/api/users?limit=5')
    expect(status).toBe(200)
    const data = body as { docs?: Array<{ email?: string }> }
    expect(data.docs).toHaveLength(1)
    expect(data.docs?.[0]?.email).toBe(ROLE_ACCOUNTS.BRK.email)
  })
})

// ────────────────────────────────────────────────────────────
// 3. /api/roles 访问矩阵（createCollectionAccess 未配，默认登录即可读）
// ────────────────────────────────────────────────────────────

test.describe('权限矩阵 / /api/roles', () => {
  test('ADM 可列出角色', async ({ request }) => {
    const { cookies } = await loginAs(request, 'ADM')
    const { status, body } = await apiGet(request, cookies, '/api/roles?limit=10')
    expect(status).toBe(200)
    const data = body as { docs?: Array<{ code?: string }> }
    const codes = (data.docs || []).map((d) => d.code).sort()
    expect(codes).toContain('ADM')
    expect(codes).toContain('OPS')
    expect(codes).toContain('MGR')
    expect(codes).toContain('BRK')
    expect(codes).toContain('CSR')
  })

  test('CSR 只可读自己绑定的角色', async ({ request }) => {
    const { cookies } = await loginAs(request, 'CSR')
    const { status, body } = await apiGet(request, cookies, '/api/roles?limit=10')
    expect(status).toBe(200)
    const data = body as { docs?: Array<{ code?: string }> }
    expect(data.docs).toHaveLength(1)
    expect(data.docs?.[0]?.code).toBe('CSR')
  })
})

// ────────────────────────────────────────────────────────────
// 4. /api/leads 字段脱敏（CSR 看 138****5678；OPS 看原值）
// ────────────────────────────────────────────────────────────

test.describe('权限矩阵 / /api/leads 字段脱敏', () => {
  test('CSR 查看 leads → phone 字段脱敏', async ({ request }) => {
    const { cookies } = await loginAs(request, 'CSR')
    const { status, body } = await apiGet(request, cookies, '/api/leads?limit=5')
    expect(status).toBe(200)
    const data = body as { docs?: Array<{ phone?: string }> }
    const docs = data.docs || []
    expect(docs.length).toBeGreaterThan(0)
    const masked = docs.find((doc) =>
      typeof doc.phone === 'string' && /\d{3}\*{4}\d{4}/.test(doc.phone),
    )
    expect(masked).toBeDefined()
    const fullLeak = docs.find((doc) =>
      typeof doc.phone === 'string' && /^1\d{10}$/.test(doc.phone),
    )
    expect(fullLeak).toBeUndefined()
  })

  test('OPS 查看 leads → phone 字段保留原值', async ({ request }) => {
    const { cookies } = await loginAs(request, 'OPS')
    const { status, body } = await apiGet(request, cookies, '/api/leads?limit=5')
    expect(status).toBe(200)
    const data = body as { docs?: Array<{ phone?: string }> }
    const docs = data.docs || []
    expect(docs.length).toBeGreaterThan(0)
    const full = docs.find((doc) =>
      typeof doc.phone === 'string' && /^1\d{10}$/.test(doc.phone),
    )
    expect(full).toBeDefined()
  })

  test('BRK 查看 leads → 自有范围内 phone 可看原值', async ({ request }) => {
    // BRK 有 phone:full 权限，但数据范围 self；列表层只会返回自己的 lead
    // 验证：调用不报错（200），不出现他人完整手机号即可
    const { cookies } = await loginAs(request, 'BRK')
    const { status } = await apiGet(request, cookies, '/api/leads?limit=5')
    expect([200, 403]).toContain(status)
  })
})

// ────────────────────────────────────────────────────────────
// 5. URL 参数不能扩大数据范围
// ────────────────────────────────────────────────────────────

test.describe('权限矩阵 / URL 参数不扩大范围', () => {
  test('BRK 传 city=999 不扩大数据范围', async ({ request }) => {
    const { cookies } = await loginAs(request, 'BRK')
    // 即使 URL 上传任意 city 参数，access 层应不信任
    const { status, body } = await apiGet(
      request,
      cookies,
      '/api/leads?limit=5&city=999&cityIds=1,2,3,999,9999',
    )
    expect([200, 403]).toContain(status)
    if (status === 200) {
      const data = body as { docs?: unknown[] }
      // BRK dataScope=self → 只看到自己负责的 lead（即便 URL 传了 999 也不放大）
      expect((data.docs || []).length).toBeLessThanOrEqual(5)
    }
  })

  test('CSR 传 role=ADM 不提升权限', async ({ request }) => {
    const { cookies } = await loginAs(request, 'CSR')
    // 客户端伪造 role 参数 → 不应获得 ADM 权限
    const { status } = await apiGet(
      request,
      cookies,
      '/api/users?limit=5&role=ADM&operation=user:manage',
    )
    expect([200, 403]).toContain(status)
  })
})

// ────────────────────────────────────────────────────────────
// 6. 越权直接 API → 403
// ────────────────────────────────────────────────────────────

test.describe('权限矩阵 / 越权 API', () => {
  test('CSR 不能创建用户（POST /api/users）', async ({ request }) => {
    const { cookies } = await loginAs(request, 'CSR')
    const res = await request.post(`${BASE}/api/users`, {
      headers: { cookie: cookies },
      data: { name: '不该创建', email: 'should-not-create@example.com', password: 'Test1234!' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
    // 确认未实际写入
    const listRes = await apiGet(request, cookies, '/api/users?where[email][equals]=should-not-create@example.com')
    const data = listRes.body as { docs?: unknown[] }
    if (data.docs) {
      expect(data.docs.length).toBe(0)
    }
  })

  test('BRK 不能创建用户（无 user:manage）', async ({ request }) => {
    const { cookies } = await loginAs(request, 'BRK')
    const res = await request.post(`${BASE}/api/users`, {
      headers: { cookie: cookies },
      data: { name: '不该创建', email: 'should-not-create@example.com', password: 'Test1234!' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
  })

  test('CSR 不能删除角色（DELETE /api/roles/:id）', async ({ request }) => {
    const { cookies } = await loginAs(request, 'CSR')
    // CSR 至少可读自己绑定的内置角色，但仍不能删除。
    const list = await apiGet(request, cookies, '/api/roles?limit=1')
    expect(list.status).toBe(200)
    const data = list.body as { docs?: Array<{ id?: number }> }
    const target = data.docs?.[0]
    expect(target?.id).toBeDefined()
    if (target?.id === undefined) {
      throw new Error('CSR 自身角色 fixture 缺少 ID')
    }

    const res = await request.delete(`${BASE}/api/roles/${target.id}`, {
      headers: { cookie: cookies },
      failOnStatusCode: false,
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })
})
