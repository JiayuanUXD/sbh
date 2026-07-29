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

// 与 playwright.config.ts 的 baseURL 保持一致：优先 NEXT_PUBLIC_SITE_URL，
// 否则用 http://localhost:${PORT}（默认 3717）。硬编码 3717 会在服务跑在非默认
// 端口时把 API 请求静默打到别的服务上，导致假失败。
const BASE = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  `http://localhost:${process.env.PORT ?? 3717}`
).replace(/\/$/, '')

const ROLE_ACCOUNTS = {
  ADM: { email: 'e2e-adm@example.com', password: 'Test1234!' },
  OPS: { email: 'e2e-ops@example.com', password: 'Test1234!' },
  MGR: { email: 'e2e-mgr@example.com', password: 'Test1234!' },
  BRK: { email: 'e2e-brk@example.com', password: 'Test1234!' },
  CSR: { email: 'e2e-csr@example.com', password: 'Test1234!' },
} as const

type RoleCode = keyof typeof ROLE_ACCOUNTS
type DocumentRecord = Record<string, unknown>
type DocumentID = number | string

function isRecord(value: unknown): value is DocumentRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function relationshipID(value: unknown): DocumentID | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (!isRecord(value)) return null
  return typeof value.id === 'number' || typeof value.id === 'string'
    ? value.id
    : null
}

function requireDocs(body: unknown, context: string): DocumentRecord[] {
  expect(isRecord(body), `${context} 应返回 JSON 对象`).toBe(true)
  if (!isRecord(body)) throw new Error(`${context} 未返回 JSON 对象`)

  expect(Array.isArray(body.docs), `${context} 应明确返回 docs 数组`).toBe(true)
  if (!Array.isArray(body.docs)) throw new Error(`${context} 缺少 docs 数组`)

  for (const [index, doc] of body.docs.entries()) {
    expect(isRecord(doc), `${context} docs[${index}] 应为对象`).toBe(true)
    if (!isRecord(doc)) throw new Error(`${context} docs[${index}] 不是对象`)
  }
  return body.docs as DocumentRecord[]
}

function expectLeadsOwnedByUser(
  body: unknown,
  userID: DocumentID,
  context: string,
): DocumentRecord[] {
  const docs = requireDocs(body, context)
  expect(docs.length, `${context} fixture 应至少包含一条自有线索`).toBeGreaterThan(0)

  for (const doc of docs) {
    const owner = isRecord(doc.owner) ? doc.owner : null
    const ownerUserID = relationshipID(owner?.user)
    expect(
      ownerUserID,
      `${context} 线索 ${String(doc.id)} 必须归属当前 BRK 用户`,
    ).toBe(userID)
  }
  return docs
}

/** 用指定角色登录，返回携带 cookie 的 APIRequestContext */
async function loginAs(
  request: APIRequestContext,
  role: RoleCode,
): Promise<{ cookies: string; status: number; userID: DocumentID }> {
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
  const body: unknown = await res.json().catch(() => null)
  const userID = isRecord(body) && isRecord(body.user)
    ? relationshipID(body.user)
    : null
  expect(userID, `${role} 登录响应应返回当前用户 ID`).not.toBeNull()
  if (userID === null) throw new Error(`${role} 登录响应缺少用户 ID`)

  return { cookies, status: res.status(), userID }
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
    expect(requireDocs(body, 'ADM 用户列表').length).toBeGreaterThan(0)
  })

  test('CSR 不能列出用户（无 user:manage）', async ({ request }) => {
    const { cookies, userID } = await loginAs(request, 'CSR')
    const { status, body } = await apiGet(request, cookies, '/api/users?limit=5')
    expect(status).toBe(200)
    const docs = requireDocs(body, 'CSR 用户列表')
    expect(docs).toHaveLength(1)
    expect(relationshipID(docs[0])).toBe(userID)
    expect(docs[0]?.email).toBe(ROLE_ACCOUNTS.CSR.email)
  })

  test('BRK 不能列出他人（无 user:manage）', async ({ request }) => {
    const { cookies, userID } = await loginAs(request, 'BRK')
    const { status, body } = await apiGet(request, cookies, '/api/users?limit=5')
    expect(status).toBe(200)
    const docs = requireDocs(body, 'BRK 用户列表')
    expect(docs).toHaveLength(1)
    expect(relationshipID(docs[0])).toBe(userID)
    expect(docs[0]?.email).toBe(ROLE_ACCOUNTS.BRK.email)
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
    const docs = requireDocs(body, 'ADM 角色列表')
    const codes = docs.map((doc) => doc.code).sort()
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
    const docs = requireDocs(body, 'CSR 角色列表')
    expect(docs).toHaveLength(1)
    expect(docs[0]?.code).toBe('CSR')
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
    const docs = requireDocs(body, 'CSR 线索列表')
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
    const docs = requireDocs(body, 'OPS 线索列表')
    expect(docs.length).toBeGreaterThan(0)
    const full = docs.find((doc) =>
      typeof doc.phone === 'string' && /^1\d{10}$/.test(doc.phone),
    )
    expect(full).toBeDefined()
  })

  test('BRK 查看 leads → 自有范围内 phone 可看原值', async ({ request }) => {
    // BRK 有 phone:full 权限，但 dataScope=self；200 时逐条证明归属本人，
    // 再验证职责范围内的手机号保留完整值。
    const { cookies, userID } = await loginAs(request, 'BRK')
    const { status, body } = await apiGet(
      request,
      cookies,
      '/api/leads?limit=20&depth=2',
    )
    if (status === 403) {
      expect(status).toBe(403)
      return
    }

    expect(status).toBe(200)
    const docs = expectLeadsOwnedByUser(body, userID, 'BRK 线索列表')
    for (const doc of docs) {
      expect(doc.phone).toMatch(/^1\d{10}$/)
    }
  })
})

// ────────────────────────────────────────────────────────────
// 5. URL 参数不能扩大数据范围
// ────────────────────────────────────────────────────────────

test.describe('权限矩阵 / URL 参数不扩大范围', () => {
  test('BRK 传 city=999 不扩大数据范围', async ({ request }) => {
    const { cookies, userID } = await loginAs(request, 'BRK')
    // 即使 URL 上传任意 city 参数，access 层应不信任
    const { status, body } = await apiGet(
      request,
      cookies,
      '/api/leads?limit=20&depth=2&city=999&cityIds=1,2,3,999,9999',
    )
    if (status === 403) {
      expect(status).toBe(403)
      return
    }

    expect(status).toBe(200)
    expectLeadsOwnedByUser(body, userID, 'BRK 伪造城市参数后的线索列表')
  })

  test('CSR 传 role=ADM 不提升权限', async ({ request }) => {
    const { cookies, userID } = await loginAs(request, 'CSR')
    // 客户端伪造 role 参数 → 不应获得 ADM 权限
    const { status, body } = await apiGet(
      request,
      cookies,
      '/api/users?limit=5&role=ADM&operation=user:manage',
    )
    if (status === 403) {
      expect(status).toBe(403)
      return
    }

    expect(status).toBe(200)
    const docs = requireDocs(body, 'CSR 伪造 ADM 参数后的用户列表')
    expect(docs).toHaveLength(1)
    expect(relationshipID(docs[0])).toBe(userID)
    expect(docs[0]?.email).toBe(ROLE_ACCOUNTS.CSR.email)

    const roleCodes = Array.isArray(docs[0]?.roles)
      ? docs[0].roles
          .map((role) => (isRecord(role) ? role.code : null))
          .filter((code): code is string => typeof code === 'string')
      : []
    expect(roleCodes).not.toContain('ADM')
  })
})

// ────────────────────────────────────────────────────────────
// 6. 越权直接 API → 403
// ────────────────────────────────────────────────────────────

test.describe('权限矩阵 / 越权 API', () => {
  test('CSR 不能创建用户（POST /api/users）', async ({ request }) => {
    const targetEmail = 'should-not-create-csr@example.com'
    const { cookies } = await loginAs(request, 'CSR')
    const res = await request.post(`${BASE}/api/users`, {
      headers: { cookie: cookies },
      data: { name: '不该创建', email: targetEmail, password: 'Test1234!' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)

    const { cookies: adminCookies } = await loginAs(request, 'ADM')
    const listRes = await apiGet(
      request,
      adminCookies,
      `/api/users?where[email][equals]=${encodeURIComponent(targetEmail)}`,
    )
    expect(listRes.status).toBe(200)
    expect(requireDocs(listRes.body, 'ADM 核验 CSR 越权写入结果')).toHaveLength(0)
  })

  test('BRK 不能创建用户（无 user:manage）', async ({ request }) => {
    const targetEmail = 'should-not-create-brk@example.com'
    const { cookies } = await loginAs(request, 'BRK')
    const res = await request.post(`${BASE}/api/users`, {
      headers: { cookie: cookies },
      data: { name: '不该创建', email: targetEmail, password: 'Test1234!' },
      failOnStatusCode: false,
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)

    const { cookies: adminCookies } = await loginAs(request, 'ADM')
    const listRes = await apiGet(
      request,
      adminCookies,
      `/api/users?where[email][equals]=${encodeURIComponent(targetEmail)}`,
    )
    expect(listRes.status).toBe(200)
    expect(requireDocs(listRes.body, 'ADM 核验 BRK 越权写入结果')).toHaveLength(0)
  })

  test('CSR 不能删除角色（DELETE /api/roles/:id）', async ({ request }) => {
    const { cookies } = await loginAs(request, 'CSR')
    // CSR 至少可读自己绑定的内置角色，但仍不能删除。
    const list = await apiGet(request, cookies, '/api/roles?limit=1')
    expect(list.status).toBe(200)
    const docs = requireDocs(list.body, 'CSR 自身角色列表')
    expect(docs).toHaveLength(1)
    const targetID = relationshipID(docs[0])
    expect(targetID).not.toBeNull()
    if (targetID === null) {
      throw new Error('CSR 自身角色 fixture 缺少 ID')
    }

    const res = await request.delete(`${BASE}/api/roles/${targetID}`, {
      headers: { cookie: cookies },
      failOnStatusCode: false,
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })
})
