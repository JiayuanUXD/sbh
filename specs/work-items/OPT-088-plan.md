# OPT-088 实施计划：会员基座 + 短信 / 密码登录 + 前台登录入口 + 收藏同步

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 母文档：`OPT-088-member-system-design.md`（总设计，所有契约以它为准）+ `OPT-088-member-auth-foundation.md`（验收）
> 分支：`feat/opt-088-member-auth-<hex>`，由 `pnpm branch:new feat opt-088 member auth` 生成；worktree 建在 `E:\wt-088`（`git worktree add E:\wt-088 <分支>`），**不要在 `E:\github\sbh` 主树上改代码**。
> 应用目录：`E:\wt-088\payload-office-platform`，下文所有路径相对它，所有命令在它里面执行。

**Goal:** 外部用户能在前台用手机验证码或手机号加密码注册登录、设密码、退出，收藏随账号同步；员工从页脚进后台；会员永远不会成为后台的 `req.user`。

**Architecture:** `members` 是 Payload 第二个 auth collection，只借它的密码哈希、`sessions`、锁定；HTTP 入口全部自建在 `src/app/api/member/*`，会话写在独立 cookie `sbh-member-token`；Payload 自带的会员 auth REST 端点被总路由包装成 404；领域逻辑集中在 `src/domain/member/`，路由是薄壳。

**Tech Stack:** Next.js 16 App Router、React 19、Payload 3.86（`jwtSign` 顶层导出）、jose 5.10.0、tencentcloud-sdk-nodejs-sms、PostgreSQL、Vitest、Playwright。

## Global Constraints

- G1 会员 cookie 名恒为 `sbh-member-token`；属性 `Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`，生产加 `Secure`；不设 Domain。
- G2 **不给 `members` 注册任何 `auth.strategies`**；**不用 Payload 发的 cookie**；`payload.login` 只取返回值里的 `token`。
- G3 `members` 的 `access`：read / create / update / unlock 只给 `req.user.collection === 'users'` 且持 `member:manage` 的员工；delete 恒 `false`。创建闸门：`req.context.memberFlow` 非空字符串或员工持 `member:manage`。登录闸门：`req.context.memberFlow === 'password'` 且 `status === 'active'`。
- G4 手机号唯一事实源是 `username`（规范化 11 位）；可空唯一列写 `null` 不写空串。
- G5 错误响应形如 `{ ok: false, code, message }`，`code` 与状态码只用母文档 §6 的表；成功 `{ ok: true, ... }`。
- G6 非 GET 请求必须先过 `isSameOrigin`（403 `FORBIDDEN_ORIGIN`）与 `isStrictJsonContentType`（400 `BAD_REQUEST`）；请求体以 `unknown` 收口，手写守卫；禁 `any` / `as any` / `@ts-ignore`。
- G7 验证码：6 位数字、5 分钟、最多 5 次、只存 HMAC；`SMS_PROVIDER=fixture` 时恒为 `123456`，生产拒绝 `console` / `fixture`。
- G8 限流键与阈值：`member-sms:phone:*` 60 秒 1 次、`member-sms:phone-day:*` 24 小时 10 次、`member-sms:ip:*` 1 小时 20 次（三者 `failOpen: false`）；`member-login:ip:*` 15 分钟 30 次（`failOpen: true`）。键里只放 sha256 前 16 位。
- G9 手机号进日志一律 `maskPhone`；验证码明文永不落库、永不落日志。
- G10 索引与唯一约束一律在 collection 配置里声明再 `migrate:create` 生成，不手写 `CREATE INDEX`；改了 collection 就 `pnpm generate:types`（`payload-types.ts` 不入库）。
- G11 提交只用显式 `git add <路径>`；禁 `-A` / `.` / `-am`；禁 `--no-verify`；不碰 `public/prd/*`；不 push、不合并（合并即上线）。每个涉及 `src/collections/` `src/globals/` `src/payload.config.ts` 的提交必须带新增迁移文件，否则 pre-commit 拦；纯前端提交不会触发该闸。
- G12 文案简体中文；注释写「为什么」；新增样式只放 `src/app/(frontend)/styles/member.css`，只用既有 token 与 `.btn` / `.modal__label` / `.sf-card` 基元。
- G13 浏览器验收由控制者做；实施代理不起 dev server（控制者按需在 3722 起 `next dev`），但每个任务末尾要跑本任务的单测，任务 12 跑全量闸门。

## 文件结构

| 文件 | 职责 | 任务 |
|---|---|---|
| `package.json` | 加 `jose@5.10.0`、`tencentcloud-sdk-nodejs-sms` | T0 |
| `src/lib/api/request-guards.ts`（新） | 共享 `isSameOrigin` / `isStrictJsonContentType` / `extractPgPool` / `clientIp` | T1 |
| `src/app/api/city-partner-applications/request-guards.ts`、`src/app/api/supply-submissions/request-guards.ts`、`src/app/api/inquiries/route.ts` | 改为引用共享模块 | T1 |
| `src/domain/auth/permission-codes.ts`、`src/test/factory/roles.ts`、`src/domain/admin-navigation/navigation-config.ts`、`src/domain/shared/errors.ts` | 菜单码 `members`、操作码 `member:manage`、导航叶子、`DomainTag` 加 `member` | T2 |
| `src/domain/member/member-access.ts`（新） | access 函数、创建闸门、登录闸门、停用清会话 | T3 |
| `src/collections/Members.ts`、`MemberSmsCodes.ts`、`MemberFavorites.ts`（新） | 三个集合 | T3 |
| `src/payload.config.ts`、`src/migrations/*_opt_088_members.*`、`*_opt_088_grant_ops_member_codes.ts` | 注册与迁移 | T3 |
| `src/domain/member/rest-fence.ts`（新）、`src/app/(payload)/api/[...slug]/route.ts` | Payload auth REST 封口 | T4 |
| `src/domain/member/sms-code.ts`、`sms-provider.ts`、`rate-limits.ts`（新）、`src/lib/runtime/config-guard.ts`、`.env.example` | 验证码、短信适配器、限流、生产守卫 | T5 |
| `src/domain/member/session.ts`、`current-member.ts`、`member-dto.ts`（新） | 会话签发校验、cookie、DTO | T6 |
| `src/domain/member/member-service.ts`（新）、`src/app/api/member/**/route.ts` | 登录 / 密码 / 资料 / 退出 | T7 |
| `src/domain/member/favorites.ts`（新）、`src/app/api/member/favorites/**` | 收藏 | T8 |
| `src/components/frontend/member/*`、`SiteHeader.tsx`、`SiteNav.tsx`、`SiteFooter.tsx`、`src/app/(frontend)/layout.tsx`、`styles/member.css` | 入口与会员上下文 | T9 |
| `src/app/(frontend)/login/**`、`account/**`、`ShareSaveActions.tsx` | 页面与收藏联动 | T10 |
| `scripts/seed.ts`、`.github/workflows/quality.yml`、`tests/e2e/member-auth.spec.ts` | 夹具与 E2E | T11 |

---

### Task 0：分支、worktree、依赖、规格入库

**Files:**
- Modify: `package.json`
- Add: `../specs/work-items/OPT-088-member-system-design.md`、`OPT-088-member-auth-foundation.md`、`OPT-089-member-wechat-login.md`、`OPT-090-member-inquiry-progress.md`、`OPT-088-plan.md`（已存在于主树，未入库）

- [ ] **Step 1: 建分支与 worktree**

```bash
cd E:/github/sbh/payload-office-platform
git fetch origin
git worktree add -b feat/opt-088-member-auth-$(node -e "console.log(require('crypto').randomBytes(2).toString('hex'))") E:/wt-088 origin/master
cd E:/wt-088/payload-office-platform
pnpm install --frozen-lockfile
pnpm setup:hooks
```

- [ ] **Step 2: 把主树里的五份规格复制进 worktree 并入库**

```bash
cp E:/github/sbh/specs/work-items/OPT-088-*.md E:/github/sbh/specs/work-items/OPT-089-member-wechat-login.md E:/github/sbh/specs/work-items/OPT-090-member-inquiry-progress.md E:/wt-088/specs/work-items/
cd E:/wt-088
git add specs/work-items/OPT-088-member-system-design.md specs/work-items/OPT-088-member-auth-foundation.md specs/work-items/OPT-089-member-wechat-login.md specs/work-items/OPT-090-member-inquiry-progress.md specs/work-items/OPT-088-plan.md
git commit -m "docs(opt-088): 会员体系总设计、三期工作项与第一期实施计划"
```

- [ ] **Step 3: 加依赖**

```bash
cd E:/wt-088/payload-office-platform
pnpm add jose@5.10.0 tencentcloud-sdk-nodejs-sms@^4.0.0
```

预期：`package.json` 的 `dependencies` 出现两行，`pnpm-lock.yaml` 更新。`jose` 版本必须与 Payload 的 5.10.0 一致（去重）。

- [ ] **Step 4: 确认可运行**

```bash
pnpm typecheck
```

预期：通过（与 master 同状态）。

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(opt-088): 新增 jose 与腾讯云短信 SDK 依赖"
```

---

### Task 1：共享请求守卫 `src/lib/api/request-guards.ts`

**Files:**
- Create: `src/lib/api/request-guards.ts`
- Modify: `src/app/api/city-partner-applications/request-guards.ts`（删除三个函数与 `TOKEN` / `QUOTED_STRING` / `JSON_MEDIA_TYPE` / `poolLike` 常量，改为 re-export）
- Modify: `src/app/api/supply-submissions/request-guards.ts`（同上）
- Modify: `src/app/api/inquiries/route.ts:63-67`（删除本地 `clientIp`，改 import）
- Test: `tests/api-request-guards.test.ts`

**Interfaces:**
- Produces:

```ts
export function isStrictJsonContentType(contentType: string | null): boolean
export function isSameOrigin(req: Request, expectedOrigin?: string): boolean       // 钉死站点 origin（城市合伙人的既有语义，OPT-028）
export function isSameOriginHost(req: Request): boolean                            // Origin 的 host 必须等于 Host 头；缺任一头 → false。会员路由用这个
export function extractPgPool(database: unknown): PoolLike | null
export function clientIp(req: Request): string   // x-forwarded-for 首段 → x-real-ip → 'unknown'
```

仓库里同源校验有两套语义：`city-partner-applications/request-guards.ts` 钉死 `siteConfig.siteOrigin`，CI 的 `next start` 下 origin 是 `http://localhost:3717` 而构建期内联的站点 URL 是 https，于是恒 403（`tests/e2e/multi-city-forms.spec.ts:239` 有说明）；`inquiries/route.ts` 与 `supply-submissions/route.ts` 各自有一份「Origin 的 host 与 Host 头自洽、缺头放行」的本地版本。会员路由用 **host 自洽且缺头拒绝** 的 `isSameOriginHost`：浏览器 `fetch` 的 POST 恒带 Origin，缺头只可能是非浏览器调用。**不动询盘与投放两处的本地 `isSameOrigin`**（改成缺头拒绝会改变既有公开表单的行为，不在本期范围）。

- [ ] **Step 1: 写失败测试** `tests/api-request-guards.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { clientIp, extractPgPool, isSameOrigin, isSameOriginHost, isStrictJsonContentType } from '@/lib/api/request-guards'

describe('共享请求守卫', () => {
  it('isSameOriginHost：Origin 的 host 等于 Host 头才放行，缺头拒绝', () => {
    const mk = (headers: Record<string, string>) => new Request('http://internal.invalid/api', { headers })
    expect(isSameOriginHost(mk({ host: 'localhost:3717', origin: 'http://localhost:3717' }))).toBe(true)
    expect(isSameOriginHost(mk({ host: 'sbh.example.com', origin: 'https://sbh.example.com' }))).toBe(true)
    expect(isSameOriginHost(mk({ host: 'sbh.example.com', origin: 'https://evil.example' }))).toBe(false)
    expect(isSameOriginHost(mk({ host: 'sbh.example.com' }))).toBe(false)
    expect(isSameOriginHost(mk({ origin: 'https://sbh.example.com' }))).toBe(false)
    expect(isSameOriginHost(mk({ host: 'sbh.example.com', origin: 'not a url' }))).toBe(false)
  })

  it('严格 JSON 媒体类型', () => {
    expect(isStrictJsonContentType('application/json')).toBe(true)
    expect(isStrictJsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(isStrictJsonContentType('text/json')).toBe(false)
    expect(isStrictJsonContentType(null)).toBe(false)
  })

  it('同源校验：origin 与 host 都必须匹配配置的站点 origin', () => {
    const ok = new Request('https://sbh.example.com/api', {
      headers: { host: 'sbh.example.com', origin: 'https://sbh.example.com' },
    })
    expect(isSameOrigin(ok, 'https://sbh.example.com')).toBe(true)
    const bad = new Request('https://sbh.example.com/api', {
      headers: { host: 'sbh.example.com', origin: 'https://attacker.example' },
    })
    expect(isSameOrigin(bad, 'https://sbh.example.com')).toBe(false)
    expect(isSameOrigin(new Request('https://sbh.example.com/api'), 'https://sbh.example.com')).toBe(false)
  })

  it('clientIp：x-forwarded-for 首段优先，其次 x-real-ip，否则 unknown', () => {
    expect(clientIp(new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }))).toBe('1.2.3.4')
    expect(clientIp(new Request('http://x', { headers: { 'x-real-ip': ' 9.9.9.9 ' } }))).toBe('9.9.9.9')
    expect(clientIp(new Request('http://x'))).toBe('unknown')
  })

  it('extractPgPool 只认带 query 函数的 pool', () => {
    const pool = { query: async () => ({ rows: [], rowCount: 0 }) }
    expect(extractPgPool({ pool })).toBe(pool)
    expect(extractPgPool({ pool: {} })).toBeNull()
    expect(extractPgPool(null)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm exec vitest run tests/api-request-guards.test.ts
```

预期：FAIL，`Cannot find module '@/lib/api/request-guards'`。

- [ ] **Step 3: 新建共享模块** `src/lib/api/request-guards.ts`

```ts
/**
 * 公开 API 的共享请求守卫（OPT-088 抽出）。
 *
 * 此前 `isSameOrigin` / `isStrictJsonContentType` / `extractPgPool` 在城市合伙人与
 * 投放房源两处各有一份，`clientIp` 在询盘路由里。会员路由是第三个消费方，
 * 再复制一份就是第三份事实源。三处原文件改为从这里引用。
 */
import { siteConfig } from '@/lib/frontend/site-config'
import type { PoolLike } from '@/lib/rate-limit-pg'

const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+"
const QUOTED_STRING = '"(?:[^"\\\\\r\n]|\\\\[\t -~])*"'
const JSON_MEDIA_TYPE = new RegExp(
  `^\\s*application\\/json\\s*(?:;\\s*${TOKEN}\\s*=\\s*(?:${TOKEN}|${QUOTED_STRING})\\s*)*$`,
  'i',
)

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function poolLike(value: unknown): value is PoolLike {
  const candidate = record(value)
  return candidate !== null && typeof candidate.query === 'function'
}

export function isStrictJsonContentType(contentType: string | null): boolean {
  return contentType !== null && JSON_MEDIA_TYPE.test(contentType)
}

/** origin 与 host 都要与配置的站点 origin 一致；缺任一头即拒绝（fail-closed）。 */
export function isSameOrigin(req: Request, expectedOrigin = siteConfig.siteOrigin): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (!origin || !host) return false
  try {
    const suppliedOrigin = new URL(origin)
    const expected = new URL(expectedOrigin)
    const suppliedHost = new URL(`${expected.protocol}//${host}`)
    return suppliedOrigin.origin === expected.origin && suppliedHost.host === expected.host
  } catch {
    return false
  }
}

/** Origin 的 host 必须等于 Host 头；缺任一头即拒绝。会员路由用它：本地 / CI 的 localhost 与生产域名都自然通过。 */
export function isSameOriginHost(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function extractPgPool(database: unknown): PoolLike | null {
  const candidate = record(database)
  return poolLike(candidate?.pool) ? candidate.pool : null
}

/** 提取客户端 IP（CloudRun / 反代场景取首跳）。 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}
```

- [ ] **Step 4: 三处原文件改为引用**

`src/app/api/city-partner-applications/request-guards.ts`：删除文件内 `TOKEN`、`QUOTED_STRING`、`JSON_MEDIA_TYPE`、`poolLike`、`isStrictJsonContentType`、`isSameOrigin`、`extractPgPool` 的定义与 `siteConfig` import（若 `siteConfig` 无其它用处），在文件顶部加：

```ts
export { extractPgPool, isSameOrigin, isStrictJsonContentType } from '@/lib/api/request-guards'
```

`src/app/api/supply-submissions/request-guards.ts`：同样处理（它只有 `isStrictJsonContentType` 与 `extractPgPool` 两个，`record` 若还被其它校验函数用到就保留）。

`src/app/api/inquiries/route.ts`：只删除第 63-67 行的本地 `clientIp`，在 import 区加 `import { clientIp } from '@/lib/api/request-guards'`。该文件第 83 行起的本地 `isSameOrigin` **保留不动**（语义是缺头放行，与共享模块的两个函数都不同）。

- [ ] **Step 5: 跑相关测试**

```bash
pnpm exec vitest run tests/api-request-guards.test.ts tests/city-partner-api-guards.test.ts tests/supply-submissions-api-guards.test.ts
pnpm typecheck
```

预期：全部 PASS（若 `tests/supply-submissions-api-guards.test.ts` 不存在则跳过该文件名）。

- [ ] **Step 6: 提交**

```bash
git add src/lib/api/request-guards.ts tests/api-request-guards.test.ts src/app/api/city-partner-applications/request-guards.ts src/app/api/supply-submissions/request-guards.ts src/app/api/inquiries/route.ts
git commit -m "refactor(api): 请求守卫抽成共享模块，三处副本改为引用（OPT-088）"
```

---

### Task 2：权限码、角色夹具、导航叶子、DomainTag

**Files:**
- Modify: `src/domain/auth/permission-codes.ts`（`MENU_CODES` 加 `'members'`；`OPERATION_CODES` 加 `'member:manage'`）
- Modify: `src/test/factory/roles.ts`（OPS 两处各加一项）
- Modify: `src/domain/admin-navigation/navigation-config.ts:122-127`（`crm` 组末尾加叶子）
- Modify: `src/domain/shared/errors.ts:14-26`（`DomainTag` 加 `| 'member'`）
- Modify: `tests/admin-navigation-visibility.test.ts`（若有断言列出 crm 组全部叶子的期望值，追加 `'members'`）
- Test: `tests/member-permission-codes.test.ts`

**Interfaces:**
- Produces: 菜单码字符串 `'members'`、操作码 `'member:manage'`、`DomainTag` 含 `'member'`。

- [ ] **Step 1: 写失败测试** `tests/member-permission-codes.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { MENU_CODES, OPERATION_CODES } from '@/domain/auth/permission-codes'
import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import type { AdminNavLeaf } from '@/domain/admin-navigation/navigation-types'
import { BUILTIN_ROLES } from '@/test/factory/roles'

function leaves(): AdminNavLeaf[] {
  const out: AdminNavLeaf[] = []
  for (const group of ADMIN_NAV_GROUPS) {
    for (const child of group.children) {
      if ('children' in child) out.push(...child.children)
      else out.push(child)
    }
  }
  return out
}

describe('会员权限码与导航', () => {
  it('注册了菜单码 members 与操作码 member:manage', () => {
    expect(MENU_CODES).toContain('members')
    expect(OPERATION_CODES).toContain('member:manage')
  })

  it('OPS 夹具持有两码，ADM 通配', () => {
    expect(BUILTIN_ROLES.OPS.menuPermissions).toContain('members')
    expect(BUILTIN_ROLES.OPS.operationPermissions).toContain('member:manage')
    expect(BUILTIN_ROLES.ADM.operationPermissions).toEqual(['*'])
  })

  it('客户运营组下有会员叶子，且要求 member:manage', () => {
    const leaf = leaves().find((l) => l.id === 'members')
    expect(leaf).toBeDefined()
    expect(leaf?.href).toBe('/admin/collections/members')
    expect(leaf?.menuCodes).toEqual(['members'])
    expect(leaf?.requiredOperationCode).toBe('member:manage')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm exec vitest run tests/member-permission-codes.test.ts
```

预期：三个用例 FAIL。

- [ ] **Step 3: 改四个源文件**

`permission-codes.ts` 的 `MENU_CODES`，在 `'customers',` 后加：

```ts
  // 会员（OPT-088）：C 端注册用户，与 customers（CRM 客户档案）是两张表
  'members',
```

`OPERATION_CODES`，在 `'user:manage', // 创建/启停账号` 后加：

```ts
  // 会员管理（OPT-088）：读列表 / 改昵称与状态 / 解锁；会员自己的操作不经此码，走 /api/member/*
  'member:manage',
```

`roles.ts` OPS：`menuPermissions` 在 `'form-submissions',` 后加 `'members',`；`operationPermissions` 末尾（现有最后一项之后）加：

```ts
      // OPT-088 会员管理：迁移 *_opt_088_grant_ops_member_codes 授予，夹具同步（否则 seed 会擦掉）
      'member:manage',
```

`navigation-config.ts` `crm` 组，在 `follow-ups` 叶子后加：

```ts
    leaf('members', '会员', '/admin/collections/members', ['members'], {
      requiredOperationCode: 'member:manage',
    }),
```

`errors.ts` `DomainTag`：在 `| 'dictionary'` 后加 `| 'member'`。

- [ ] **Step 4: 跑受影响测试**

```bash
pnpm exec vitest run tests/member-permission-codes.test.ts tests/permission-codes.test.ts tests/admin-navigation-visibility.test.ts tests/admin-navigation-context-links.test.ts tests/org.test.ts
```

预期：PASS。若 `admin-navigation-visibility.test.ts` 因期望列表缺 `members` 而红，把 `'members'` 追加到对应期望数组（它是行为变化的正确反映，不是删断言）。

- [ ] **Step 5: 提交**

```bash
git add src/domain/auth/permission-codes.ts src/test/factory/roles.ts src/domain/admin-navigation/navigation-config.ts src/domain/shared/errors.ts tests/member-permission-codes.test.ts tests/admin-navigation-visibility.test.ts
git commit -m "feat(auth): 会员菜单码、member:manage 操作码与后台导航叶子（OPT-088）"
```

### Task 3：三个集合、access 与闸门、注册、迁移、全后台守卫

**Files:**
- Create: `src/domain/member/member-access.ts`
- Create: `src/collections/Members.ts`、`src/collections/MemberSmsCodes.ts`、`src/collections/MemberFavorites.ts`
- Modify: `src/payload.config.ts:52`（import）与 `:355-387`（collections 数组末尾）
- Create（生成）: `src/migrations/<ts>_opt_088_members.ts` + `.json`
- Create（手写）: `src/migrations/<ts>_opt_088_grant_ops_member_codes.ts`
- Test: `tests/member-access.test.ts`、`tests/member-never-req-user.test.ts`

**Interfaces:**
- Produces（T5–T8 依赖，签名逐字）：

```ts
// src/domain/member/member-access.ts
export const MEMBER_MANAGE_CODE = 'member:manage'
export function isStaffRequest(req: { user?: unknown }): boolean          // req.user 存在且 collection === 'users'
export async function canManageMembers(args: { req: PayloadRequest }): Promise<boolean>
export const memberCollectionAccess: CollectionConfig['access']            // read/create/update/unlock = canManageMembers, delete = () => false
export const guardMemberCreate: CollectionBeforeChangeHook                  // create 且无 memberFlow 且非 member:manage → ForbiddenError
export const clearSessionsOnDisable: CollectionBeforeChangeHook             // status → disabled 时 data.sessions = []
export const guardMemberLogin: CollectionBeforeLoginHook                    // memberFlow !== 'password' 或 status !== 'active' → 抛错
export const MEMBER_TOKEN_EXPIRATION_SECONDS = 2_592_000
// src/collections/Members.ts
export const Members: CollectionConfig            // slug 'members'
export const MemberSmsCodes: CollectionConfig     // slug 'member-sms-codes'
export const MemberFavorites: CollectionConfig    // slug 'member-favorites'
```

- [ ] **Step 1: 写失败测试** `tests/member-access.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import type { PayloadRequest } from 'payload'
import type { RequestContext } from '@/domain/auth/access'
import { BUILTIN_ROLES, type BuiltinRoleCode } from '@/test/factory/roles'
import type { Role, User } from '@/payload-types'
import {
  canManageMembers,
  clearSessionsOnDisable,
  guardMemberCreate,
  guardMemberLogin,
  isStaffRequest,
  memberCollectionAccess,
} from '@/domain/member/member-access'

function makeStaff(overrides: Partial<User> = {}): User {
  return {
    id: 1, name: 'staff', email: 'staff@example.com', status: 'active', sessionVersion: 1,
    roles: [1], updatedAt: '', createdAt: '', collection: 'users', ...overrides,
  } as unknown as User
}

function makeRole(code: BuiltinRoleCode): Role {
  const f = BUILTIN_ROLES[code]
  return {
    id: 1, code: f.code, name: f.name, isBuiltin: true, status: 'active', dataScope: f.dataScope,
    menuPermissions: f.menuPermissions, operationPermissions: f.operationPermissions,
    fieldPermissions: f.fieldPermissions, updatedAt: '', createdAt: '',
  } as unknown as Role
}

function makeReq(params: { user?: unknown; roles?: Role[]; context?: Record<string, unknown> }): PayloadRequest {
  return {
    user: params.user ?? null,
    context: params.context ?? {},
    payload: { find: vi.fn(async () => ({ docs: params.roles ?? [] })) },
  } as unknown as PayloadRequest
}

const memberUser = { id: 9, collection: 'members', username: '13800001234', status: 'active' }

describe('members access', () => {
  it('isStaffRequest 只认 users 集合的用户', () => {
    expect(isStaffRequest({ user: makeStaff() })).toBe(true)
    expect(isStaffRequest({ user: memberUser })).toBe(false)
    expect(isStaffRequest({ user: null })).toBe(false)
  })

  it.each(['read', 'create', 'update', 'unlock'] as const)('%s：匿名 / 会员 / 无权员工拒绝，持 member:manage 员工放行', async (op) => {
    const fn = memberCollectionAccess?.[op]
    expect(typeof fn).toBe('function')
    const call = (req: PayloadRequest) => (fn as (a: { req: PayloadRequest }) => Promise<boolean> | boolean)({ req })
    expect(await call(makeReq({ user: null }))).toBe(false)
    expect(await call(makeReq({ user: memberUser }))).toBe(false)
    expect(await call(makeReq({ user: makeStaff(), roles: [makeRole('BRK')] }))).toBe(false)
    expect(await call(makeReq({ user: makeStaff(), roles: [makeRole('OPS')] }))).toBe(true)
    expect(await call(makeReq({ user: makeStaff(), roles: [makeRole('ADM')] }))).toBe(true)
  })

  it('delete 对任何人都是 false', async () => {
    const fn = memberCollectionAccess?.delete as (a: { req: PayloadRequest }) => boolean
    expect(fn({ req: makeReq({ user: makeStaff(), roles: [makeRole('ADM')] }) })).toBe(false)
  })

  it('创建闸门：无 memberFlow 且非管理员 → 抛错；带 memberFlow 放行；管理员放行', async () => {
    const run = (req: PayloadRequest) =>
      (guardMemberCreate as unknown as (a: Record<string, unknown>) => Promise<unknown>)({
        operation: 'create', req, data: { username: '13800001234' }, context: req.context,
      })
    await expect(run(makeReq({ user: null }))).rejects.toThrow(/验证流程/)
    await expect(run(makeReq({ user: memberUser }))).rejects.toThrow(/验证流程/)
    await expect(run(makeReq({ user: null, context: { memberFlow: 'sms' } }))).resolves.toBeTruthy()
    await expect(run(makeReq({ user: makeStaff(), roles: [makeRole('ADM')] }))).resolves.toBeTruthy()
  })

  it('登录闸门：只有 memberFlow=password 且 active 才通过', async () => {
    const run = (ctx: Record<string, unknown>, status: string) =>
      (guardMemberLogin as unknown as (a: Record<string, unknown>) => Promise<unknown>)({
        req: makeReq({ context: ctx }), user: { ...memberUser, status }, context: ctx,
      })
    await expect(run({}, 'active')).rejects.toThrow()
    await expect(run({ memberFlow: 'password' }, 'disabled')).rejects.toThrow()
    await expect(run({ memberFlow: 'password' }, 'active')).resolves.toBeTruthy()
  })

  it('停用即清空 sessions', async () => {
    const data = await (clearSessionsOnDisable as unknown as (a: Record<string, unknown>) => Promise<Record<string, unknown>>)({
      operation: 'update', req: makeReq({}), originalDoc: { status: 'active', sessions: [{ id: 'x' }] },
      data: { status: 'disabled' }, context: {},
    })
    expect(data.sessions).toEqual([])
  })

  it('canManageMembers 对会员上下文恒 false，即便 payload.find 返回 ADM', async () => {
    expect(await canManageMembers({ req: makeReq({ user: memberUser, roles: [makeRole('ADM')] }) })).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm exec vitest run tests/member-access.test.ts
```

预期：FAIL，找不到模块。

- [ ] **Step 3: 写 `src/domain/member/member-access.ts`**

```ts
/**
 * 会员集合的准入与闸门（OPT-088，母文档 §7）
 *
 * 三条不变量：
 *   1. 只有 users 集合、持 member:manage 的员工能经 Payload access 读改会员；会员自己的
 *      操作全部走 /api/member/*（Local API + overrideAccess），不经这里。
 *   2. 创建只有两条路：服务端验证流程（req.context.memberFlow）或持 member:manage 的员工。
 *      这一条同时堵住 Payload 自带的 first-register（它走 overrideAccess，但 beforeChange 照跑）。
 *   3. Payload 的 login 操作只接受 req.context.memberFlow === 'password'，其余一律拒绝——
 *      这是 /api/members/login 被总路由封成 404 之外的第二道门。
 */
import type {
  AccessArgs,
  CollectionBeforeChangeHook,
  CollectionBeforeLoginHook,
  CollectionConfig,
  PayloadRequest,
} from 'payload'
import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { ForbiddenError } from '@/domain/shared/errors'

export const MEMBER_MANAGE_CODE = 'member:manage'
/** 会员会话 30 天；Payload 的 sessions.expiresAt 与我们签的 JWT 都用它。 */
export const MEMBER_TOKEN_EXPIRATION_SECONDS = 60 * 60 * 24 * 30

export function isStaffRequest(req: { user?: unknown }): boolean {
  const user = req.user
  if (user === null || typeof user !== 'object') return false
  return (user as { collection?: unknown }).collection === 'users'
}

export async function canManageMembers(args: { req: PayloadRequest }): Promise<boolean> {
  if (!isStaffRequest(args.req)) return false
  const ctx = await getPermissionContext(args.req as RequestContext)
  if (!ctx) return false
  return hasOperationPermission(ctx, MEMBER_MANAGE_CODE)
}

const manage = (args: AccessArgs): Promise<boolean> => canManageMembers({ req: args.req })

export const memberCollectionAccess: CollectionConfig['access'] = {
  read: manage,
  create: manage,
  update: manage,
  // 会员不物理删：停用即可。有收藏 / 会话引用，删了会级联丢历史。
  delete: () => false,
  unlock: manage,
}

function memberFlowOf(req: PayloadRequest): string | null {
  const flow = (req.context as Record<string, unknown> | undefined)?.memberFlow
  return typeof flow === 'string' && flow.length > 0 ? flow : null
}

export const guardMemberCreate: CollectionBeforeChangeHook = async ({ operation, req, data }) => {
  if (operation !== 'create') return data
  if (memberFlowOf(req)) return data
  if (await canManageMembers({ req })) return data
  throw new ForbiddenError({ domain: 'member', message: '会员只能通过验证流程创建' })
}

export const clearSessionsOnDisable: CollectionBeforeChangeHook = async ({ operation, originalDoc, data }) => {
  if (operation !== 'update' || !originalDoc) return data
  const before = (originalDoc as { status?: unknown }).status
  const after = (data as { status?: unknown }).status
  if (before !== 'disabled' && after === 'disabled') {
    ;(data as Record<string, unknown>).sessions = []
  }
  return data
}

export const guardMemberLogin: CollectionBeforeLoginHook = async ({ req, user }) => {
  if (memberFlowOf(req) !== 'password') {
    throw new ForbiddenError({ domain: 'member', message: '会员登录只允许经 /api/member/login/password' })
  }
  if ((user as { status?: unknown }).status !== 'active') {
    throw new ForbiddenError({ domain: 'member', message: '账号已停用' })
  }
  return user
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm exec vitest run tests/member-access.test.ts
```

预期：PASS。

- [ ] **Step 5: 写三个集合**

`src/collections/Members.ts`：

```ts
import type { CollectionConfig } from 'payload'
import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import type { FieldMaskRule } from '@/domain/auth/field-mask'
import {
  MEMBER_TOKEN_EXPIRATION_SECONDS,
  clearSessionsOnDisable,
  guardMemberCreate,
  guardMemberLogin,
  memberCollectionAccess,
} from '@/domain/member/member-access'
import { isValidCnMobile, maskPhone, normalizePhone } from '@/domain/shared/phone'

/** 缺 phone:full 时后台看到 138****1111；username 就是手机号。 */
const MEMBER_PHONE_MASK_RULE: FieldMaskRule = {
  field: 'username',
  requiredPermission: 'phone:full',
  mask: (value) => (typeof value === 'string' ? maskPhone(value) : value),
}

/**
 * 会员（OPT-088，母文档 §4.1）
 *
 * 是 Payload 的第二个 auth collection，但只借它的密码哈希、sessions 与锁定：
 *   - HTTP 入口全部在 src/app/api/member/*，Payload 自带的 /api/members/login 等被总路由封成 404；
 *   - 会话写在 cookie sbh-member-token，Payload 自带策略只认 payload-token，
 *     所以后台的 req.user 永远不会是会员；
 *   - 不要给本集合加 auth.strategies，加了会员就会进入后台 req.user。
 */
export const Members: CollectionConfig = {
  slug: 'members',
  labels: { singular: '会员', plural: '会员管理' },
  admin: {
    group: false,
    useAsTitle: 'username',
    defaultColumns: ['username', 'nickname', 'status', 'hasPassword', 'wechatBoundAt', 'lastLoginAt', 'createdAt'],
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    description: 'C 端注册用户。手机号是唯一身份键；停用后会话立即失效。',
  },
  auth: {
    loginWithUsername: { allowEmailLogin: false, requireEmail: false, requireUsername: true },
    tokenExpiration: MEMBER_TOKEN_EXPIRATION_SECONDS,
    useAPIKey: false,
    cookies: { secure: process.env.NODE_ENV === 'production' },
  },
  graphQL: false,
  trash: false,
  access: memberCollectionAccess,
  hooks: {
    beforeChange: [guardMemberCreate, clearSessionsOnDisable],
    beforeLogin: [guardMemberLogin],
    afterRead: createFieldMaskHooks([MEMBER_PHONE_MASK_RULE]),
  },
  fields: [
    {
      // 覆写 Payload 注入的 username：标签、校验、规范化。mergeBaseFields 会按 name 深合并。
      name: 'username',
      type: 'text',
      label: '手机号',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true, description: '规范化 11 位手机号，注册后不可修改。' },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !isValidCnMobile(value)) return '请输入正确的大陆手机号'
        return true
      },
      hooks: {
        beforeChange: [({ value }) => (typeof value === 'string' ? normalizePhone(value) : value)],
      },
    },
    { name: 'email', type: 'email', admin: { hidden: true } },
    { name: 'nickname', label: '昵称', type: 'text', maxLength: 30 },
    {
      type: 'row',
      fields: [
        {
          name: 'status',
          label: '状态',
          type: 'select',
          required: true,
          defaultValue: 'active',
          options: [
            { label: '启用', value: 'active' },
            { label: '停用', value: 'disabled' },
          ],
          admin: { description: '停用后旧会话立即失效。' },
        },
        { name: 'hasPassword', label: '已设密码', type: 'checkbox', defaultValue: false, admin: { readOnly: true } },
        { name: 'lastLoginAt', label: '最近登录', type: 'date', admin: { readOnly: true } },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'wechatUnionId', label: '微信 UnionID', type: 'text', unique: true, index: true, admin: { readOnly: true } },
        { name: 'wechatOpenId', label: '微信 OpenID', type: 'text', admin: { readOnly: true } },
        { name: 'wechatBoundAt', label: '微信绑定时间', type: 'date', admin: { readOnly: true } },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'consentPolicyVersion', label: '同意的隐私政策版本', type: 'text', required: true, admin: { readOnly: true } },
        { name: 'consentAcceptedAt', label: '同意时间', type: 'date', required: true, admin: { readOnly: true } },
      ],
    },
  ],
}
```

`src/collections/MemberSmsCodes.ts`：

```ts
import type { CollectionConfig } from 'payload'

/** 验证码（OPT-088 §4.2）。后台隐藏、REST 全拒；只由服务端 Local API 读写；明文不落库。 */
export const MemberSmsCodes: CollectionConfig = {
  slug: 'member-sms-codes',
  labels: { singular: '会员验证码', plural: '会员验证码' },
  admin: { hidden: true },
  graphQL: false,
  trash: false,
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [
    { name: 'phone', type: 'text', required: true, index: true },
    {
      name: 'purpose',
      type: 'select',
      required: true,
      options: [
        { label: '登录', value: 'login' },
        { label: '设置密码', value: 'set-password' },
        { label: '绑定微信', value: 'bind-wechat' },
      ],
    },
    { name: 'codeHash', type: 'text', required: true },
    { name: 'expiresAt', type: 'date', required: true, index: true },
    { name: 'attempts', type: 'number', required: true, defaultValue: 0 },
    { name: 'consumedAt', type: 'date' },
    { name: 'ipHash', type: 'text' },
  ],
}
```

`src/collections/MemberFavorites.ts`：

```ts
import type { CollectionConfig } from 'payload'

/** 收藏（OPT-088 §4.3）。唯一性由 targetKey 承载，Payload 配置声明不了复合唯一。 */
export const MemberFavorites: CollectionConfig = {
  slug: 'member-favorites',
  labels: { singular: '会员收藏', plural: '会员收藏' },
  admin: { hidden: true },
  graphQL: false,
  trash: false,
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: {
    beforeChange: [
      ({ data }) => {
        const d = data as Record<string, unknown>
        const member = typeof d.member === 'object' && d.member !== null ? (d.member as { id?: unknown }).id : d.member
        d.targetKey = `${String(member)}:${String(d.targetType)}:${String(d.targetId)}`
        return data
      },
    ],
  },
  fields: [
    { name: 'member', type: 'relationship', relationTo: 'members', required: true, index: true },
    {
      name: 'targetType',
      type: 'select',
      required: true,
      options: [
        { label: '房源', value: 'listing' },
        { label: '楼盘', value: 'building' },
      ],
    },
    { name: 'targetId', type: 'number', required: true },
    { name: 'targetSlug', type: 'text', required: true },
    { name: 'titleSnapshot', type: 'text', required: true },
    { name: 'savedAt', type: 'date', required: true },
    { name: 'targetKey', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true } },
  ],
}
```

- [ ] **Step 6: 注册到 `payload.config.ts` 并生成类型与迁移**

在第 52 行后加：

```ts
import { Members } from './collections/Members'
import { MemberSmsCodes } from './collections/MemberSmsCodes'
import { MemberFavorites } from './collections/MemberFavorites'
```

`collections` 数组在 `LocationAliases,` 后加 `Members, MemberSmsCodes, MemberFavorites,`。

```bash
pnpm generate:types
grep -c "prefix" src/payload-types.ts
pnpm exec payload migrate:create opt_088_members
```

预期：`grep` 输出 2；`src/migrations/` 出现 `<时间戳>_opt_088_members.ts` 与 `.json`。打开 `.ts` 检查：含 `CREATE TABLE "members"`、`"members_sessions"`、`"member_sms_codes"`、`"member_favorites"`，含 `members_username_idx`（unique）、`member_favorites_target_key_idx`（unique）、`members_wechat_union_id_idx`（unique）；`down` 是对应 `DROP TABLE`。**不要手改生成的 SQL**。

- [ ] **Step 7: 手写授权迁移** `src/migrations/<时间戳+1 秒>_opt_088_grant_ops_member_codes.ts`（时间戳取生成迁移的时间戳加 1，保证顺序在其后）

```ts
import { sql, type MigrateDownArgs, type MigrateUpArgs } from '@payloadcms/db-postgres'

/**
 * 给内置 OPS 角色授予会员管理的菜单码 members 与操作码 member:manage（OPT-088）。
 * ADM 是 ['*'] 不用授。写法与 20260908_150000_grant_ops_supply_write_codes 同款：逐码判存在再追加，
 * 不整体覆写。**必须与 src/test/factory/roles.ts 同步**（seed 会用夹具覆写角色）。
 */
const OPS = 'OPS'

async function grant(args: MigrateUpArgs, column: 'menu_permissions' | 'operation_permissions', code: string): Promise<void> {
  await args.db.execute(sql`
    UPDATE "roles"
    SET ${sql.raw(`"${column}"`)} = COALESCE(${sql.raw(`"${column}"`)}, '[]'::jsonb) || ${JSON.stringify([code])}::jsonb
    WHERE "is_builtin" = true AND "code" = ${OPS}
      AND NOT (COALESCE(${sql.raw(`"${column}"`)}, '[]'::jsonb) ? ${code});
  `)
}

async function revoke(args: MigrateDownArgs, column: 'menu_permissions' | 'operation_permissions', code: string): Promise<void> {
  await args.db.execute(sql`
    UPDATE "roles"
    SET ${sql.raw(`"${column}"`)} = COALESCE(${sql.raw(`"${column}"`)}, '[]'::jsonb) - ${code}
    WHERE "is_builtin" = true AND "code" = ${OPS};
  `)
}

export async function up(args: MigrateUpArgs): Promise<void> {
  await grant(args, 'menu_permissions', 'members')
  await grant(args, 'operation_permissions', 'member:manage')
}

export async function down(args: MigrateDownArgs): Promise<void> {
  await revoke(args, 'operation_permissions', 'member:manage')
  await revoke(args, 'menu_permissions', 'members')
}
```

先核对既有迁移 `20260908_150000_grant_ops_supply_write_codes.ts` 里 jsonb 列名与 `sql.raw` 的用法是否一致，不一致以既有文件为准。

- [ ] **Step 8: 本地跑迁移与 dry-run**

```bash
pnpm migrate:dry-run
pnpm exec payload migrate
pnpm migrate:status
```

预期：dry-run 无危险项；两条迁移应用成功。把 dry-run 输出保存到 `../artifacts/verification/OPT-088/migrate-dry-run.txt`。

- [ ] **Step 9: 写全后台守卫测试** `tests/member-never-req-user.test.ts`

```ts
import type { SanitizedConfig } from 'payload'
import { describe, expect, it, vi } from 'vitest'

const { default: configPromise } = await import('@/payload.config')
const payloadConfig = (await configPromise) as SanitizedConfig

/**
 * 会员永远不能成为后台 req.user 的守卫（OPT-088 §7.4）。
 * 即便将来有人给 members 挂了 auth 策略，所有 access 也必须对 collection='members' 的用户返回 false。
 */
const memberReq = {
  user: { id: 1, collection: 'members', username: '13800001234', status: 'active' },
  context: {},
  payload: { find: vi.fn(async () => ({ docs: [] })) },
}

/** read: () => true 的公开集合 / global；只豁免 read。新增公开读集合时本清单必须有人改。 */
const PUBLIC_READ_COLLECTIONS = new Set([
  'media', 'pages', 'articles', 'locations', 'buildings', 'brokers', 'merchants',
  'building-merchant-relations', 'display-tags', 'city-site-profiles', 'amenities', 'business-area-extensions',
])
const PUBLIC_READ_GLOBALS = new Set(['site-settings', 'advisor-service-hours'])

const OPS = ['read', 'create', 'update', 'delete', 'unlock', 'readVersions'] as const

async function denied(fn: unknown): Promise<boolean> {
  const result = await (fn as (a: unknown) => unknown)({ req: memberReq, id: 1, data: {} })
  return result === false
}

describe('会员上下文必须被全后台 access 拒绝', () => {
  const collections = payloadConfig.collections.filter((c) => !c.slug.startsWith('payload-'))

  it('每个集合都显式声明了 access.read', () => {
    const missing = collections.filter((c) => typeof c.access?.read !== 'function').map((c) => c.slug)
    expect(missing).toEqual([])
  })

  it.each(collections.map((c) => [c.slug, c] as const))('%s', async (slug, collection) => {
    for (const op of OPS) {
      const fn = collection.access?.[op]
      if (typeof fn !== 'function') continue
      if (op === 'read' && PUBLIC_READ_COLLECTIONS.has(slug)) continue
      expect(await denied(fn), `${slug}.access.${op} 对会员放行了`).toBe(true)
    }
  })

  it.each(payloadConfig.globals.map((g) => [g.slug, g] as const))('global %s', async (slug, global) => {
    for (const op of ['read', 'update', 'readVersions'] as const) {
      const fn = global.access?.[op]
      if (typeof fn !== 'function') continue
      if (op === 'read' && PUBLIC_READ_GLOBALS.has(slug)) continue
      expect(await denied(fn), `global ${slug}.access.${op} 对会员放行了`).toBe(true)
    }
  })
})
```

- [ ] **Step 10: 跑守卫与覆盖测试**

```bash
pnpm exec vitest run tests/member-never-req-user.test.ts tests/collection-write-access-coverage.test.ts tests/member-access.test.ts
pnpm typecheck
```

预期：PASS。若某个既有集合对会员放行（返回 `true` 或 Where 对象），说明它只判了 `Boolean(req.user)`，把该判据改成 `isStaffRequest(req) && ...`（例：`FollowUps.read`、`Teams.read`、`LeadOwnershipHistory.read`、`Listings` 的 `roomNumber` 字段级 read、`Leads` 的 `visitorRef` 字段级 read）。字段级 access 不在本测试范围，但这五处 `Boolean(req.user)` 一并改成 `isStaffRequest(req)`，改法逐字：

```ts
import { isStaffRequest } from '@/domain/member/member-access'
// 原：read: ({ req }) => Boolean(req.user),
read: ({ req }) => isStaffRequest(req),
```

- [ ] **Step 11: 提交（本提交含集合，pre-commit 要求带迁移，已带）**

```bash
git add src/domain/member/member-access.ts src/collections/Members.ts src/collections/MemberSmsCodes.ts src/collections/MemberFavorites.ts src/payload.config.ts src/migrations/*opt_088_members.ts src/migrations/*opt_088_members.json src/migrations/*opt_088_grant_ops_member_codes.ts tests/member-access.test.ts tests/member-never-req-user.test.ts src/collections/FollowUps.ts src/collections/Teams.ts src/collections/LeadOwnershipHistory.ts src/collections/Listings.ts src/collections/Leads.ts
git commit -m "feat(members): 会员集合、access 闸门、授权迁移与全后台守卫（OPT-088）"
```

---

### Task 4：Payload 自带 auth REST 端点封口

**Files:**
- Create: `src/domain/member/rest-fence.ts`
- Modify: `src/app/(payload)/api/[...slug]/route.ts`
- Test: `tests/member-rest-fence.test.ts`

**Interfaces:**
- Produces: `export const BLOCKED_MEMBER_AUTH_PATHS`、`export function isBlockedMemberAuthPath(segments: readonly string[] | undefined): boolean`

- [ ] **Step 1: 写失败测试** `tests/member-rest-fence.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { BLOCKED_MEMBER_AUTH_PATHS, isBlockedMemberAuthPath } from '@/domain/member/rest-fence'

describe('members auth REST 封口', () => {
  it('九个 auth 端点全部拦', () => {
    expect(BLOCKED_MEMBER_AUTH_PATHS).toEqual([
      'login', 'logout', 'refresh-token', 'me', 'first-register', 'forgot-password', 'reset-password', 'unlock', 'verify',
    ])
    for (const p of BLOCKED_MEMBER_AUTH_PATHS) expect(isBlockedMemberAuthPath(['members', p])).toBe(true)
    expect(isBlockedMemberAuthPath(['members', 'verify', 'some-token'])).toBe(true)
  })
  it('文档 REST 与其它集合不拦', () => {
    expect(isBlockedMemberAuthPath(['members'])).toBe(false)
    expect(isBlockedMemberAuthPath(['members', '123'])).toBe(false)
    expect(isBlockedMemberAuthPath(['users', 'login'])).toBe(false)
    expect(isBlockedMemberAuthPath(undefined)).toBe(false)
    expect(isBlockedMemberAuthPath([])).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败** `pnpm exec vitest run tests/member-rest-fence.test.ts` → FAIL 找不到模块。

- [ ] **Step 3: 写 `src/domain/member/rest-fence.ts`**

```ts
/**
 * Payload 给每个 auth collection 都挂 login / logout / refresh-token / me / first-register /
 * forgot-password / reset-password / unlock / verify 九个 REST 端点。会员的 HTTP 入口全在
 * /api/member/*（注意单数），这九个对 members 一律 404：它们会发 payload-token cookie、
 * 绕过我们的限流与同意校验，first-register 在表空时还能匿名建号。
 * 文档 REST（/api/members、/api/members/:id）不拦——后台编辑会员要用，且已有 access 把关。
 */
export const BLOCKED_MEMBER_AUTH_PATHS = [
  'login', 'logout', 'refresh-token', 'me', 'first-register', 'forgot-password', 'reset-password', 'unlock', 'verify',
] as const

export function isBlockedMemberAuthPath(segments: readonly string[] | undefined): boolean {
  if (!segments || segments.length < 2) return false
  if (segments[0] !== 'members') return false
  return (BLOCKED_MEMBER_AUTH_PATHS as readonly string[]).includes(segments[1])
}
```

- [ ] **Step 4: 包装总路由** `src/app/(payload)/api/[...slug]/route.ts` 整体改为：

```ts
/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* OPT-088：在 Payload 生成的六个 REST 处理器外包一层，把 members 的 auth 端点封成 404。
   Payload 不会重写本文件（只有 create-payload-app 生成它）；若将来重新生成，须把包装恢复。 */
import config from '@payload-config'
import '@payloadcms/next/css'
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from '@payloadcms/next/routes'
import { isBlockedMemberAuthPath } from '@/domain/member/rest-fence'

type RouteContext = { params: Promise<{ slug: string[] }> }
type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>

function withMemberFence(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    const { slug } = await context.params
    if (isBlockedMemberAuthPath(slug)) return new Response(null, { status: 404 })
    return handler(request, context)
  }
}

export const GET = withMemberFence(REST_GET(config) as unknown as RouteHandler)
export const POST = withMemberFence(REST_POST(config) as unknown as RouteHandler)
export const DELETE = withMemberFence(REST_DELETE(config) as unknown as RouteHandler)
export const PATCH = withMemberFence(REST_PATCH(config) as unknown as RouteHandler)
export const PUT = withMemberFence(REST_PUT(config) as unknown as RouteHandler)
export const OPTIONS = withMemberFence(REST_OPTIONS(config) as unknown as RouteHandler)
```

- [ ] **Step 5: 验证** `pnpm exec vitest run tests/member-rest-fence.test.ts && pnpm typecheck` → PASS。

- [ ] **Step 6: 提交**

```bash
git add src/domain/member/rest-fence.ts "src/app/(payload)/api/[...slug]/route.ts" tests/member-rest-fence.test.ts
git commit -m "feat(members): 封住 Payload 自带的会员 auth REST 端点（OPT-088）"
```

### Task 5：验证码、短信适配器、限流配置、生产守卫

**Files:**
- Create: `src/domain/member/sms-code.ts`、`src/domain/member/sms-provider.ts`、`src/domain/member/rate-limits.ts`
- Modify: `src/lib/runtime/config-guard.ts`（`ConfigGuardEnv` 加 `SMS_PROVIDER`；`validateProductionConfig` 末尾加校验）
- Modify: `.env.example`（追加短信段）
- Test: `tests/member-sms-code.test.ts`、`tests/member-sms-provider.test.ts`、`tests/member-rate-limits.test.ts`

**Interfaces:**
- Produces（签名逐字）：

```ts
// sms-code.ts
export type SmsPurpose = 'login' | 'set-password' | 'bind-wechat'
export const SMS_PURPOSES: readonly SmsPurpose[]
export const SMS_CODE_TTL_MS = 5 * 60_000
export const SMS_CODE_MAX_ATTEMPTS = 5
export const FIXTURE_SMS_CODE = '123456'
export function isSmsPurpose(value: unknown): value is SmsPurpose
export function generateSmsCode(mode: 'random' | 'fixture'): string           // 6 位数字
export function hashSmsCode(secret: string, phone: string, purpose: SmsPurpose, code: string): string
export function smsCodeMatches(secret: string, phone: string, purpose: SmsPurpose, code: string, storedHash: string): boolean
export type StoredSmsCode = Readonly<{ codeHash: string; expiresAt: string; attempts: number; consumedAt?: string | null }>
export type SmsCodeCheck = 'ok' | 'invalid' | 'expired'
export function checkSmsCode(input: { secret: string; phone: string; purpose: SmsPurpose; code: string; stored: StoredSmsCode | null; now: Date }): SmsCodeCheck
// 语义：stored 为空 / 已消费 / attempts（已含本次，即传入前 +1 后的值）> 5 / 哈希不等 → 'invalid'；过期 → 'expired'
// sms-provider.ts
export type SmsProvider = Readonly<{ name: 'console' | 'fixture' | 'tencent'; send: (input: { phone: string; code: string; minutes: number }) => Promise<void> }>
export type SmsEnv = Readonly<Partial<Record<'NODE_ENV' | 'SMS_PROVIDER' | 'TENCENT_SMS_SECRET_ID' | 'TENCENT_SMS_SECRET_KEY' | 'TENCENT_SMS_SDK_APP_ID' | 'TENCENT_SMS_SIGN_NAME' | 'TENCENT_SMS_TEMPLATE_ID' | 'TENCENT_SMS_TEMPLATE_PARAMS' | 'TENCENT_SMS_REGION', string>>>
export function expandTemplateParams(pattern: string | undefined, code: string, minutes: number): string[]
export function resolveSmsProvider(env: SmsEnv, log: (msg: string) => void): SmsProvider | null   // 生产未配 → null；非生产缺省 console
export function collectSmsProductionViolations(env: SmsEnv): { field: string; reason: string }[]
// rate-limits.ts
export const MEMBER_RATE_LIMITS: { smsPhoneMinute; smsPhoneDay; smsIp; loginIp }   // 每项 { prefix: string; config: RateLimitConfig }
export function rateLimitKey(prefix: string, raw: string): string                    // `${prefix}:${sha256(raw).slice(0,16)}`
export const memberRatePruneRef: PruneTimestampRef
```

- [ ] **Step 1: 写失败测试** `tests/member-sms-code.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_SMS_CODE, SMS_CODE_TTL_MS, checkSmsCode, generateSmsCode, hashSmsCode, isSmsPurpose, smsCodeMatches,
} from '@/domain/member/sms-code'

const secret = 'test-secret-with-enough-length-0123456789'
const phone = '13800001234'

describe('sms-code', () => {
  it('随机码是 6 位数字；fixture 恒为 123456', () => {
    for (let i = 0; i < 20; i += 1) expect(generateSmsCode('random')).toMatch(/^\d{6}$/)
    expect(generateSmsCode('fixture')).toBe(FIXTURE_SMS_CODE)
  })
  it('哈希稳定且与号码、用途、密钥绑定', () => {
    const h = hashSmsCode(secret, phone, 'login', '123456')
    expect(h).toBe(hashSmsCode(secret, phone, 'login', '123456'))
    expect(h).not.toBe(hashSmsCode(secret, phone, 'set-password', '123456'))
    expect(h).not.toBe(hashSmsCode('other', phone, 'login', '123456'))
    expect(smsCodeMatches(secret, phone, 'login', '123456', h)).toBe(true)
    expect(smsCodeMatches(secret, phone, 'login', '000000', h)).toBe(false)
  })
  it('isSmsPurpose', () => {
    expect(isSmsPurpose('login')).toBe(true)
    expect(isSmsPurpose('x')).toBe(false)
  })
  it('checkSmsCode：空 / 消费过 / 超次 / 不等 → invalid；过期 → expired；否则 ok', () => {
    const now = new Date('2026-09-11T00:00:00Z')
    const stored = { codeHash: hashSmsCode(secret, phone, 'login', '123456'), expiresAt: new Date(now.getTime() + SMS_CODE_TTL_MS).toISOString(), attempts: 1 }
    const base = { secret, phone, purpose: 'login' as const, now }
    expect(checkSmsCode({ ...base, code: '123456', stored })).toBe('ok')
    expect(checkSmsCode({ ...base, code: '123456', stored: null })).toBe('invalid')
    expect(checkSmsCode({ ...base, code: '123456', stored: { ...stored, consumedAt: now.toISOString() } })).toBe('invalid')
    expect(checkSmsCode({ ...base, code: '123456', stored: { ...stored, attempts: 6 } })).toBe('invalid')
    expect(checkSmsCode({ ...base, code: '654321', stored })).toBe('invalid')
    expect(checkSmsCode({ ...base, code: '123456', stored: { ...stored, expiresAt: new Date(now.getTime() - 1).toISOString() } })).toBe('expired')
  })
})
```

`tests/member-sms-provider.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { collectSmsProductionViolations, expandTemplateParams, resolveSmsProvider } from '@/domain/member/sms-provider'

describe('sms-provider', () => {
  it('模板占位展开', () => {
    expect(expandTemplateParams(undefined, '123456', 5)).toEqual(['123456', '5'])
    expect(expandTemplateParams('{code}', '123456', 5)).toEqual(['123456'])
    expect(expandTemplateParams('{minutes},{code}', '1', 5)).toEqual(['5', '1'])
  })
  it('非生产缺省 console；fixture 可选；生产未配返回 null', () => {
    expect(resolveSmsProvider({ NODE_ENV: 'development' }, () => {})?.name).toBe('console')
    expect(resolveSmsProvider({ NODE_ENV: 'test', SMS_PROVIDER: 'fixture' }, () => {})?.name).toBe('fixture')
    expect(resolveSmsProvider({ NODE_ENV: 'production' }, () => {})).toBeNull()
  })
  it('tencent 缺凭据抛错，凭据齐全返回 tencent', () => {
    expect(() => resolveSmsProvider({ NODE_ENV: 'development', SMS_PROVIDER: 'tencent' }, () => {})).toThrow(/TENCENT_SMS/)
    const full = {
      NODE_ENV: 'development', SMS_PROVIDER: 'tencent', TENCENT_SMS_SECRET_ID: 'a', TENCENT_SMS_SECRET_KEY: 'b',
      TENCENT_SMS_SDK_APP_ID: '1400', TENCENT_SMS_SIGN_NAME: '签名', TENCENT_SMS_TEMPLATE_ID: '1',
    }
    expect(resolveSmsProvider(full, () => {})?.name).toBe('tencent')
  })
  it('生产拒绝 console / fixture，允许 tencent', () => {
    expect(collectSmsProductionViolations({ NODE_ENV: 'production', SMS_PROVIDER: 'console' })).toHaveLength(1)
    expect(collectSmsProductionViolations({ NODE_ENV: 'production', SMS_PROVIDER: 'fixture' })).toHaveLength(1)
    expect(collectSmsProductionViolations({ NODE_ENV: 'production', SMS_PROVIDER: 'tencent', TENCENT_SMS_SECRET_ID: 'a', TENCENT_SMS_SECRET_KEY: 'b', TENCENT_SMS_SDK_APP_ID: '1', TENCENT_SMS_SIGN_NAME: 's', TENCENT_SMS_TEMPLATE_ID: 't' })).toEqual([])
    expect(collectSmsProductionViolations({ NODE_ENV: 'production' })).toEqual([])
  })
})
```

`tests/member-rate-limits.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { MEMBER_RATE_LIMITS, rateLimitKey } from '@/domain/member/rate-limits'

describe('member rate limits', () => {
  it('键只含前缀与 16 位哈希', () => {
    const key = rateLimitKey('member-sms:phone', '13800001234')
    expect(key).toMatch(/^member-sms:phone:[0-9a-f]{16}$/)
    expect(key).not.toContain('13800001234')
    expect(rateLimitKey('a', 'x')).toBe(rateLimitKey('a', 'x'))
  })
  it('阈值与失败策略按母文档 §6.1', () => {
    expect(MEMBER_RATE_LIMITS.smsPhoneMinute.config).toMatchObject({ windowMs: 60_000, max: 1, failOpen: false })
    expect(MEMBER_RATE_LIMITS.smsPhoneDay.config).toMatchObject({ windowMs: 86_400_000, max: 10, failOpen: false })
    expect(MEMBER_RATE_LIMITS.smsIp.config).toMatchObject({ windowMs: 3_600_000, max: 20, failOpen: false })
    expect(MEMBER_RATE_LIMITS.loginIp.config).toMatchObject({ windowMs: 900_000, max: 30, failOpen: true })
  })
})
```

- [ ] **Step 2: 跑三个测试确认失败**

```bash
pnpm exec vitest run tests/member-sms-code.test.ts tests/member-sms-provider.test.ts tests/member-rate-limits.test.ts
```

- [ ] **Step 3: 写 `src/domain/member/sms-code.ts`**

```ts
/**
 * 验证码的纯规则（OPT-088 §4.2 / §6.2）：生成、HMAC、比对、生命周期。不碰数据库。
 * 明文只在这里的返回值里出现一次，调用方负责只把它交给短信适配器。
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export type SmsPurpose = 'login' | 'set-password' | 'bind-wechat'
export const SMS_PURPOSES: readonly SmsPurpose[] = ['login', 'set-password', 'bind-wechat']
export const SMS_CODE_TTL_MS = 5 * 60_000
export const SMS_CODE_MAX_ATTEMPTS = 5
export const FIXTURE_SMS_CODE = '123456'

export function isSmsPurpose(value: unknown): value is SmsPurpose {
  return typeof value === 'string' && (SMS_PURPOSES as readonly string[]).includes(value)
}

export function generateSmsCode(mode: 'random' | 'fixture'): string {
  if (mode === 'fixture') return FIXTURE_SMS_CODE
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashSmsCode(secret: string, phone: string, purpose: SmsPurpose, code: string): string {
  return createHmac('sha256', secret).update(`member-sms|${phone}|${purpose}|${code}`, 'utf8').digest('hex')
}

export function smsCodeMatches(secret: string, phone: string, purpose: SmsPurpose, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashSmsCode(secret, phone, purpose, code), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export type StoredSmsCode = Readonly<{ codeHash: string; expiresAt: string; attempts: number; consumedAt?: string | null }>
export type SmsCodeCheck = 'ok' | 'invalid' | 'expired'

/** `stored.attempts` 是调用方已经 +1 写回后的值。 */
export function checkSmsCode(input: {
  secret: string; phone: string; purpose: SmsPurpose; code: string; stored: StoredSmsCode | null; now: Date
}): SmsCodeCheck {
  const { stored } = input
  if (!stored || stored.consumedAt) return 'invalid'
  if (stored.attempts > SMS_CODE_MAX_ATTEMPTS) return 'invalid'
  if (new Date(stored.expiresAt).getTime() <= input.now.getTime()) return 'expired'
  if (!/^\d{6}$/.test(input.code)) return 'invalid'
  return smsCodeMatches(input.secret, input.phone, input.purpose, input.code, stored.codeHash) ? 'ok' : 'invalid'
}
```

- [ ] **Step 4: 写 `src/domain/member/sms-provider.ts`**

```ts
/**
 * 短信适配器（OPT-088 §6.2）。三个实现：
 *   console  非生产缺省，把验证码打进日志（脱敏手机号）；
 *   fixture  E2E 用，什么都不发（验证码由 sms-code 的 fixture 模式恒为 123456）；
 *   tencent  腾讯云短信 v20210111 SendSms。
 * 生产未配 SMS_PROVIDER → 返回 null，路由据此回 503；生产取 console / fixture → config-guard 拒绝启动。
 */
import { maskPhone } from '@/domain/shared/phone'

export type SmsProvider = Readonly<{
  name: 'console' | 'fixture' | 'tencent'
  send: (input: { phone: string; code: string; minutes: number }) => Promise<void>
}>

export type SmsEnv = Readonly<Partial<Record<
  | 'NODE_ENV' | 'SMS_PROVIDER' | 'TENCENT_SMS_SECRET_ID' | 'TENCENT_SMS_SECRET_KEY' | 'TENCENT_SMS_SDK_APP_ID'
  | 'TENCENT_SMS_SIGN_NAME' | 'TENCENT_SMS_TEMPLATE_ID' | 'TENCENT_SMS_TEMPLATE_PARAMS' | 'TENCENT_SMS_REGION',
  string
>>>

const TENCENT_REQUIRED = [
  'TENCENT_SMS_SECRET_ID', 'TENCENT_SMS_SECRET_KEY', 'TENCENT_SMS_SDK_APP_ID', 'TENCENT_SMS_SIGN_NAME', 'TENCENT_SMS_TEMPLATE_ID',
] as const

export function expandTemplateParams(pattern: string | undefined, code: string, minutes: number): string[] {
  const p = pattern && pattern.trim().length > 0 ? pattern : '{code},{minutes}'
  return p.split(',').map((s) => s.trim().replace('{code}', code).replace('{minutes}', String(minutes)))
}

function missingTencent(env: SmsEnv): string[] {
  return TENCENT_REQUIRED.filter((k) => !env[k] || env[k]!.trim().length === 0)
}

export function collectSmsProductionViolations(env: SmsEnv): { field: string; reason: string }[] {
  if (env.NODE_ENV !== 'production') return []
  const provider = env.SMS_PROVIDER
  if (!provider) return []
  if (provider === 'console' || provider === 'fixture') {
    return [{ field: 'SMS_PROVIDER', reason: `生产环境不允许 SMS_PROVIDER=${provider}（验证码会进日志或恒为常量）` }]
  }
  if (provider === 'tencent') {
    return missingTencent(env).map((field) => ({ field, reason: 'SMS_PROVIDER=tencent 时必填' }))
  }
  return [{ field: 'SMS_PROVIDER', reason: `未知取值 ${provider}` }]
}

function consoleProvider(log: (msg: string) => void): SmsProvider {
  return { name: 'console', send: async ({ phone, code }) => { log(`[sms:console] phone=${maskPhone(phone)} code=${code}`) } }
}

function fixtureProvider(): SmsProvider {
  return { name: 'fixture', send: async () => undefined }
}

function tencentProvider(env: SmsEnv): SmsProvider {
  const missing = missingTencent(env)
  if (missing.length > 0) throw new Error(`SMS_PROVIDER=tencent 缺少 ${missing.join(', ')}`)
  return {
    name: 'tencent',
    send: async ({ phone, code, minutes }) => {
      // 动态 import：SDK 只在真的发短信时加载，单测与 console 模式不碰它。
      const { sms } = await import('tencentcloud-sdk-nodejs-sms')
      const Client = sms.v20210111.Client
      const client = new Client({
        credential: { secretId: env.TENCENT_SMS_SECRET_ID!, secretKey: env.TENCENT_SMS_SECRET_KEY! },
        region: env.TENCENT_SMS_REGION || 'ap-guangzhou',
        profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } },
      })
      const res = await client.SendSms({
        PhoneNumberSet: [`+86${phone}`],
        SmsSdkAppId: env.TENCENT_SMS_SDK_APP_ID!,
        SignName: env.TENCENT_SMS_SIGN_NAME!,
        TemplateId: env.TENCENT_SMS_TEMPLATE_ID!,
        TemplateParamSet: expandTemplateParams(env.TENCENT_SMS_TEMPLATE_PARAMS, code, minutes),
      })
      const status = res.SendStatusSet?.[0]
      if (!status || status.Code !== 'Ok') {
        throw new Error(`腾讯云短信发送失败：${status?.Code ?? 'no-status'} ${status?.Message ?? ''}`)
      }
    },
  }
}

export function resolveSmsProvider(env: SmsEnv, log: (msg: string) => void): SmsProvider | null {
  const provider = env.SMS_PROVIDER
  const isProd = env.NODE_ENV === 'production'
  if (!provider) return isProd ? null : consoleProvider(log)
  if (provider === 'console') return isProd ? null : consoleProvider(log)
  if (provider === 'fixture') return isProd ? null : fixtureProvider()
  if (provider === 'tencent') return tencentProvider(env)
  return null
}
```

若 `pnpm typecheck` 报 `tencentcloud-sdk-nodejs-sms` 无类型导出 `sms`，改为 `const mod = await import('tencentcloud-sdk-nodejs-sms'); const Client = mod.sms.v20210111.Client`，仍不行则查看 `node_modules/tencentcloud-sdk-nodejs-sms/tencentcloud/index.d.ts` 的导出名并照它改，不要用 `any`。

- [ ] **Step 5: 写 `src/domain/member/rate-limits.ts`**

```ts
/**
 * 会员接口限流（OPT-088 §6.1）。与 lib/rate-limit-config 同一张 inquiry_rate_limit 表，靠前缀隔离配额。
 * 发短信花钱，三条短信配额 failOpen:false；登录配额 failOpen:true（密码有 Payload 锁定、验证码有次数上限兜底）。
 */
import { createHash } from 'node:crypto'
import type { PruneTimestampRef, RateLimitConfig } from '@/lib/rate-limit-distributed'

type Limit = Readonly<{ prefix: string; config: RateLimitConfig }>

const base = { maxKeys: 100_000, pruneIntervalMs: 5 * 60_000 }

export const MEMBER_RATE_LIMITS: Readonly<Record<'smsPhoneMinute' | 'smsPhoneDay' | 'smsIp' | 'loginIp', Limit>> = {
  smsPhoneMinute: { prefix: 'member-sms:phone', config: { ...base, windowMs: 60_000, max: 1, failOpen: false } },
  smsPhoneDay: { prefix: 'member-sms:phone-day', config: { ...base, windowMs: 86_400_000, max: 10, failOpen: false } },
  smsIp: { prefix: 'member-sms:ip', config: { ...base, windowMs: 3_600_000, max: 20, failOpen: false } },
  loginIp: { prefix: 'member-login:ip', config: { ...base, windowMs: 900_000, max: 30, failOpen: true } },
}

export function rateLimitKey(prefix: string, raw: string): string {
  return `${prefix}:${createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16)}`
}

export const memberRatePruneRef: PruneTimestampRef = { value: 0 }
```

- [ ] **Step 6: config-guard 与 .env.example**

`src/lib/runtime/config-guard.ts`：`ConfigGuardEnv` 加 `SMS_PROVIDER?: string` 与 `TENCENT_SMS_SECRET_ID?: string`、`TENCENT_SMS_SECRET_KEY?: string`、`TENCENT_SMS_SDK_APP_ID?: string`、`TENCENT_SMS_SIGN_NAME?: string`、`TENCENT_SMS_TEMPLATE_ID?: string`；顶部 `import { collectSmsProductionViolations } from '@/domain/member/sms-provider'`；在 `violations.push(...collectCosProductionViolations(env))` 后加 `violations.push(...collectSmsProductionViolations(env))`。

`.env.example` 末尾追加：

```
# ──────────────────────────────────────────────────────────────
# 会员短信验证码（OPT-088）
# ──────────────────────────────────────────────────────────────
# console（非生产缺省，验证码打进日志）/ fixture（E2E，验证码恒 123456）/ tencent（腾讯云短信）
# 生产未配置时短信接口返回 503；生产禁止 console / fixture（启动即拒绝）
# SMS_PROVIDER=console
# tencent 时必填：
# TENCENT_SMS_SECRET_ID=
# TENCENT_SMS_SECRET_KEY=
# TENCENT_SMS_SDK_APP_ID=
# TENCENT_SMS_SIGN_NAME=
# TENCENT_SMS_TEMPLATE_ID=
# 模板参数占位，逗号分隔，缺省 {code},{minutes}；模板只有一个参数时配 {code}
# TENCENT_SMS_TEMPLATE_PARAMS={code},{minutes}
# TENCENT_SMS_REGION=ap-guangzhou
```

- [ ] **Step 7: 验证**

```bash
pnpm exec vitest run tests/member-sms-code.test.ts tests/member-sms-provider.test.ts tests/member-rate-limits.test.ts tests/config-guard.test.ts
pnpm typecheck
```

预期：PASS（`tests/config-guard.test.ts` 若不存在则忽略）。

- [ ] **Step 8: 提交**

```bash
git add src/domain/member/sms-code.ts src/domain/member/sms-provider.ts src/domain/member/rate-limits.ts src/lib/runtime/config-guard.ts .env.example tests/member-sms-code.test.ts tests/member-sms-provider.test.ts tests/member-rate-limits.test.ts
git commit -m "feat(members): 验证码规则、短信适配器、限流配置与生产守卫（OPT-088）"
```

---

### Task 6：会话签发与校验、cookie、DTO、`getCurrentMember`

**Files:**
- Create: `src/domain/member/session.ts`、`src/domain/member/member-dto.ts`、`src/domain/member/current-member.ts`
- Test: `tests/member-session.test.ts`、`tests/member-dto.test.ts`

**Interfaces:**
- Produces（签名逐字）：

```ts
// member-dto.ts
export type MemberDto = Readonly<{ id: number; phoneMasked: string; nickname: string | null; hasPassword: boolean; wechatBound: boolean; createdAt: string }>
export function toMemberDto(member: Member): MemberDto            // Member 来自 @/payload-types
// session.ts
export const MEMBER_COOKIE_NAME = 'sbh-member-token'
export type MemberTokenClaims = Readonly<{ id: number; collection: 'members'; sid: string }>
export function serializeMemberCookie(token: string, opts: { secure: boolean; maxAgeSeconds: number }): string
export function expiredMemberCookie(opts: { secure: boolean }): string
export function readCookie(cookieHeader: string | null, name: string): string | null
export async function signMemberToken(claims: MemberTokenClaims, secret: string, expiresInSeconds: number): Promise<string>
export async function verifyMemberToken(token: string, secret: string): Promise<MemberTokenClaims | null>
export function newSession(existing: Member['sessions'], now: Date, ttlSeconds: number): { sid: string; sessions: NonNullable<Member['sessions']> }
export function sessionIsLive(sessions: Member['sessions'], sid: string, now: Date): boolean
export async function issueMemberSession(payload: Payload, member: Member, now?: Date): Promise<{ token: string; cookie: string }>
export async function tokenToCookie(payload: Payload, token: string): Promise<string>
export async function resolveMemberFromToken(payload: Payload, token: string | null, now?: Date): Promise<Member | null>
export async function revokeMemberSession(payload: Payload, member: Member, sid: string): Promise<void>
// current-member.ts（只在 Server Component / 路由里用）
export const getCurrentMember: () => Promise<Member | null>          // React cache() 包装，读 next/headers cookies
export const getCurrentMemberDto: () => Promise<MemberDto | null>
```

- [ ] **Step 1: 写失败测试** `tests/member-session.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import type { Member } from '@/payload-types'
import {
  MEMBER_COOKIE_NAME, expiredMemberCookie, newSession, readCookie, resolveMemberFromToken, serializeMemberCookie,
  sessionIsLive, signMemberToken, verifyMemberToken,
} from '@/domain/member/session'

const secret = 'unit-test-secret-0123456789-0123456789'
const now = new Date('2026-09-11T00:00:00Z')

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 7, username: '13800001234', status: 'active', hasPassword: false, sessions: [],
    consentPolicyVersion: 'MVP-R2', consentAcceptedAt: now.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString(),
    ...overrides,
  } as unknown as Member
}

describe('member session', () => {
  it('cookie 序列化属性', () => {
    const c = serializeMemberCookie('tok', { secure: true, maxAgeSeconds: 2592000 })
    expect(c).toBe(`${MEMBER_COOKIE_NAME}=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`)
    expect(serializeMemberCookie('tok', { secure: false, maxAgeSeconds: 10 })).not.toContain('Secure')
    expect(expiredMemberCookie({ secure: false })).toContain('Max-Age=0')
    expect(readCookie('a=1; sbh-member-token=xyz; b=2', MEMBER_COOKIE_NAME)).toBe('xyz')
    expect(readCookie(null, MEMBER_COOKIE_NAME)).toBeNull()
  })

  it('签发 → 校验往返；错密钥 / 篡改 / 非 members 集合 → null', async () => {
    const token = await signMemberToken({ id: 7, collection: 'members', sid: 's1' }, secret, 60)
    expect(await verifyMemberToken(token, secret)).toEqual({ id: 7, collection: 'members', sid: 's1' })
    expect(await verifyMemberToken(token, 'wrong-secret-wrong-secret-wrong-secret')).toBeNull()
    expect(await verifyMemberToken(token + 'x', secret)).toBeNull()
    const users = await signMemberToken({ id: 7, collection: 'users' as unknown as 'members', sid: 's1' }, secret, 60)
    expect(await verifyMemberToken(users, secret)).toBeNull()
  })

  it('newSession 追加并清理过期；sessionIsLive 判 sid 与到期', () => {
    const expired = { id: 'old', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-02T00:00:00Z' }
    const { sid, sessions } = newSession([expired], now, 60)
    expect(sessions.map((s) => s.id)).toEqual([sid])
    expect(sessionIsLive(sessions, sid, now)).toBe(true)
    expect(sessionIsLive(sessions, 'other', now)).toBe(false)
    expect(sessionIsLive(sessions, sid, new Date(now.getTime() + 61_000))).toBe(false)
  })

  it('resolveMemberFromToken：sid 在 sessions 且启用才返回；停用 / sid 不在 / 过期 → null', async () => {
    const live = { id: 'sid-1', createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString() }
    const doc = member({ sessions: [live] })
    const payload = { secret, findByID: vi.fn(async () => doc) } as unknown as Payload
    const token = await signMemberToken({ id: 7, collection: 'members', sid: 'sid-1' }, secret, 60)
    expect(await resolveMemberFromToken(payload, token, now)).toEqual(doc)
    expect(await resolveMemberFromToken(payload, null, now)).toBeNull()
    const disabled = { secret, findByID: vi.fn(async () => member({ sessions: [live], status: 'disabled' })) } as unknown as Payload
    expect(await resolveMemberFromToken(disabled, token, now)).toBeNull()
    const other = await signMemberToken({ id: 7, collection: 'members', sid: 'nope' }, secret, 60)
    expect(await resolveMemberFromToken(payload, other, now)).toBeNull()
    expect(await resolveMemberFromToken(payload, token, new Date(now.getTime() + 61_000))).toBeNull()
  })
})
```

`tests/member-dto.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { Member } from '@/payload-types'
import { toMemberDto } from '@/domain/member/member-dto'

describe('toMemberDto', () => {
  it('只暴露六个字段，手机号脱敏', () => {
    const dto = toMemberDto({
      id: 3, username: '13800001234', nickname: '小王', hasPassword: true, wechatUnionId: 'u1', status: 'active',
      hash: 'H', salt: 'S', sessions: [{ id: 'x', expiresAt: '2030-01-01T00:00:00Z' }], createdAt: '2026-09-11T00:00:00Z', updatedAt: '',
      consentPolicyVersion: 'MVP-R2', consentAcceptedAt: '2026-09-11T00:00:00Z',
    } as unknown as Member)
    expect(dto).toEqual({ id: 3, phoneMasked: '138****1234', nickname: '小王', hasPassword: true, wechatBound: true, createdAt: '2026-09-11T00:00:00Z' })
    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'hasPassword', 'id', 'nickname', 'phoneMasked', 'wechatBound'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败** `pnpm exec vitest run tests/member-session.test.ts tests/member-dto.test.ts`

- [ ] **Step 3: 写 `src/domain/member/member-dto.ts`**

```ts
import type { Member } from '@/payload-types'
import { maskPhone } from '@/domain/shared/phone'

/** 会员对外 DTO（OPT-088 §5）。永远不含 hash / salt / sessions / unionid / 完整手机号。 */
export type MemberDto = Readonly<{
  id: number
  phoneMasked: string
  nickname: string | null
  hasPassword: boolean
  wechatBound: boolean
  createdAt: string
}>

export function toMemberDto(member: Member): MemberDto {
  return {
    id: member.id,
    phoneMasked: maskPhone(member.username),
    nickname: member.nickname ?? null,
    hasPassword: Boolean(member.hasPassword),
    wechatBound: typeof member.wechatUnionId === 'string' && member.wechatUnionId.length > 0,
    createdAt: member.createdAt,
  }
}
```

- [ ] **Step 4: 写 `src/domain/member/session.ts`**

```ts
/**
 * 会员会话（OPT-088 §5）。
 * token 是 HS256 JWT，claims 只有 { id, collection:'members', sid }，用 Payload 的 jwtSign 签、jose 验；
 * sid 写进会员的 sessions 数组（Payload 自带字段），撤销即从数组删除。
 * cookie 名 sbh-member-token，与后台的 payload-token 完全分开。
 */
import { randomUUID } from 'node:crypto'
import { jwtVerify } from 'jose'
import { jwtSign, type Payload } from 'payload'
import type { Member } from '@/payload-types'
import { MEMBER_TOKEN_EXPIRATION_SECONDS } from './member-access'

export const MEMBER_COOKIE_NAME = 'sbh-member-token'

export type MemberTokenClaims = Readonly<{ id: number; collection: 'members'; sid: string }>

export function serializeMemberCookie(token: string, opts: { secure: boolean; maxAgeSeconds: number }): string {
  const parts = [`${MEMBER_COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${opts.maxAgeSeconds}`]
  if (opts.secure) parts.push('Secure')
  return parts.join('; ')
}

export function expiredMemberCookie(opts: { secure: boolean }): string {
  return serializeMemberCookie('', { secure: opts.secure, maxAgeSeconds: 0 })
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=') || null
  }
  return null
}

export async function signMemberToken(claims: MemberTokenClaims, secret: string, expiresInSeconds: number): Promise<string> {
  const { token } = await jwtSign({ fieldsToSign: { ...claims }, secret, tokenExpiration: expiresInSeconds })
  return token
}

export async function verifyMemberToken(token: string, secret: string): Promise<MemberTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] })
    if (payload.collection !== 'members') return null
    if (typeof payload.id !== 'number' || typeof payload.sid !== 'string' || payload.sid.length === 0) return null
    return { id: payload.id, collection: 'members', sid: payload.sid }
  } catch {
    return null
  }
}

type Session = NonNullable<Member['sessions']>[number]

export function newSession(existing: Member['sessions'], now: Date, ttlSeconds: number): { sid: string; sessions: Session[] } {
  const sid = randomUUID()
  const live = (existing ?? []).filter((s) => new Date(s.expiresAt).getTime() > now.getTime())
  const session: Session = { id: sid, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString() }
  return { sid, sessions: [...live, session] }
}

export function sessionIsLive(sessions: Member['sessions'], sid: string, now: Date): boolean {
  return (sessions ?? []).some((s) => s.id === sid && new Date(s.expiresAt).getTime() > now.getTime())
}

function secure(): boolean {
  return process.env.NODE_ENV === 'production'
}

export async function tokenToCookie(_payload: Payload, token: string): Promise<string> {
  return serializeMemberCookie(token, { secure: secure(), maxAgeSeconds: MEMBER_TOKEN_EXPIRATION_SECONDS })
}

/** 短信 / 微信登录用：写 session、更新 lastLoginAt、签 token。密码登录走 payload.login，只需 tokenToCookie。 */
export async function issueMemberSession(payload: Payload, member: Member, now: Date = new Date()): Promise<{ token: string; cookie: string }> {
  const { sid, sessions } = newSession(member.sessions, now, MEMBER_TOKEN_EXPIRATION_SECONDS)
  await payload.update({
    collection: 'members',
    id: member.id,
    data: { sessions, lastLoginAt: now.toISOString() },
    overrideAccess: true,
    context: { memberFlow: 'session' },
  })
  const token = await signMemberToken({ id: member.id, collection: 'members', sid }, payload.secret, MEMBER_TOKEN_EXPIRATION_SECONDS)
  return { token, cookie: await tokenToCookie(payload, token) }
}

export async function resolveMemberFromToken(payload: Payload, token: string | null, now: Date = new Date()): Promise<Member | null> {
  if (!token) return null
  const claims = await verifyMemberToken(token, payload.secret)
  if (!claims) return null
  const member = await payload.findByID({ collection: 'members', id: claims.id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!member || member.status !== 'active') return null
  if (!sessionIsLive(member.sessions, claims.sid, now)) return null
  return member
}

export async function revokeMemberSession(payload: Payload, member: Member, sid: string): Promise<void> {
  await payload.update({
    collection: 'members',
    id: member.id,
    data: { sessions: (member.sessions ?? []).filter((s) => s.id !== sid) },
    overrideAccess: true,
    context: { memberFlow: 'session' },
  })
}
```

若 `jwtSign` 的 `fieldsToSign` 类型不接受 `MemberTokenClaims`，改为 `fieldsToSign: { ...claims } as Record<string, unknown>`。若 `payload.findByID` 对未找到抛错，上面的 `.catch(() => null)` 已兜住。

- [ ] **Step 5: 写 `src/domain/member/current-member.ts`**

```ts
import { cache } from 'react'
import { cookies } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { Member } from '@/payload-types'
import { toMemberDto, type MemberDto } from './member-dto'
import { MEMBER_COOKIE_NAME, resolveMemberFromToken } from './session'

/** 只在 Server Component / 路由处理器里调用；请求级缓存，一个请求最多查一次库。 */
export const getCurrentMember = cache(async (): Promise<Member | null> => {
  const store = await cookies()
  const token = store.get(MEMBER_COOKIE_NAME)?.value ?? null
  if (!token) return null
  const payload = await getPayload({ config })
  return resolveMemberFromToken(payload, token)
})

export const getCurrentMemberDto = cache(async (): Promise<MemberDto | null> => {
  const member = await getCurrentMember()
  return member ? toMemberDto(member) : null
})
```

- [ ] **Step 6: 验证** `pnpm exec vitest run tests/member-session.test.ts tests/member-dto.test.ts && pnpm typecheck` → PASS。

- [ ] **Step 7: 提交**

```bash
git add src/domain/member/session.ts src/domain/member/member-dto.ts src/domain/member/current-member.ts tests/member-session.test.ts tests/member-dto.test.ts
git commit -m "feat(members): 会话签发校验、cookie 与会员 DTO（OPT-088）"
```

### Task 7：会员领域服务与登录 / 密码 / 资料 / 退出路由

**Files:**
- Create: `src/domain/member/member-service.ts`、`src/domain/member/http.ts`
- Create: `src/app/api/member/sms/send/route.ts`、`src/app/api/member/login/sms/route.ts`、`src/app/api/member/login/password/route.ts`、`src/app/api/member/me/route.ts`、`src/app/api/member/logout/route.ts`、`src/app/api/member/password/route.ts`、`src/app/api/member/profile/route.ts`
- Test: `tests/member-service.test.ts`、`tests/member-http.test.ts`

**Interfaces:**
- Consumes: T5 的 `sms-code.ts` / `sms-provider.ts` / `rate-limits.ts`，T6 的 `session.ts` / `member-dto.ts` / `current-member.ts`，T1 的 `request-guards.ts`。
- Produces（签名逐字）：

```ts
// http.ts
export type MemberErrorCode = 'BAD_REQUEST' | 'INVALID_PHONE' | 'CONSENT_REQUIRED' | 'CODE_INVALID' | 'CODE_EXPIRED' | 'INVALID_CREDENTIALS' | 'UNAUTHENTICATED' | 'ACCOUNT_DISABLED' | 'FORBIDDEN_ORIGIN' | 'WECHAT_ALREADY_BOUND' | 'FAVORITE_LIMIT' | 'RATE_LIMITED' | 'SMS_UNAVAILABLE'
export const MEMBER_ERROR_STATUS: Record<MemberErrorCode, number>
export const MEMBER_ERROR_MESSAGE: Record<MemberErrorCode, string>
export class MemberHttpError extends Error { readonly code: MemberErrorCode; readonly retryAfterSeconds?: number }
export function fail(code: MemberErrorCode, retryAfterSeconds?: number): Response
export function ok(body: Record<string, unknown>, init?: { cookie?: string; status?: number }): Response
export async function readJsonBody(req: Request): Promise<Record<string, unknown>>        // 同源 + 严格 JSON + 对象，否则抛 MemberHttpError
export function handleMemberRoute(run: () => Promise<Response>): Promise<Response>        // catch MemberHttpError → fail；其它错 → 500 { ok:false, code:'INTERNAL' }
// member-service.ts
export type MemberServiceDeps = { payload: Payload; now: () => Date; smsProvider: SmsProvider | null; codeMode: 'random' | 'fixture' }
export async function sendSmsCode(deps, input: { phone: string; purpose: SmsPurpose; ip: string }): Promise<void>
export async function consumeSmsCode(deps, input: { phone: string; purpose: SmsPurpose; code: string }): Promise<SmsCodeCheck>
export async function findMemberByPhone(deps, phone: string): Promise<Member | null>
export async function createMemberFromVerifiedPhone(deps, input: { phone: string; policyVersion: string; flow: string }): Promise<Member>
export async function loginWithSms(deps, input: { phone: string; code: string; consent: { accepted: boolean; policyVersion: string } | null }): Promise<{ member: Member; isNew: boolean; cookie: string }>
export async function loginWithPassword(deps, input: { phone: string; password: string }): Promise<{ member: Member; cookie: string }>
export async function setPasswordWithSms(deps, input: { phone: string; code: string; newPassword: string; currentSid: string | null }): Promise<{ member: Member; cookie: string }>
export async function updateNickname(deps, member: Member, nickname: string): Promise<Member>
export function isValidPassword(value: unknown): value is string   // 8–64 位，含字母与数字
export async function checkRateLimit(payload: Payload, limit: { prefix: string; config: RateLimitConfig }, raw: string): Promise<void>  // 超限抛 MemberHttpError('RATE_LIMITED', retryAfter)
```

- [ ] **Step 1: 写失败测试** `tests/member-service.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import type { Member, MemberSmsCode } from '@/payload-types'
import { hashSmsCode } from '@/domain/member/sms-code'
import {
  consumeSmsCode, isValidPassword, loginWithPassword, loginWithSms, sendSmsCode, setPasswordWithSms, type MemberServiceDeps,
} from '@/domain/member/member-service'
import { MemberHttpError } from '@/domain/member/http'

const secret = 'service-test-secret-0123456789-0123456789'
const now = new Date('2026-09-11T00:00:00Z')
const phone = '13800001234'

type Store = { codes: MemberSmsCode[]; members: Member[] }

/** 极简内存版 payload：只实现服务用到的 find / create / update / findByID / login。 */
function fakePayload(store: Store) {
  let nextId = 100
  const payload = {
    secret,
    logger: { info: vi.fn(), warn: vi.fn() },
    find: vi.fn(async (args: { collection: string; where: Record<string, unknown>; sort?: string }) => {
      if (args.collection === 'member-sms-codes') {
        const w = args.where as { and: Array<Record<string, { equals?: unknown; exists?: boolean }>> }
        const docs = store.codes
          .filter((c) => w.and.every((clause) => {
            const [k, cond] = Object.entries(clause)[0]
            if (cond.exists === false) return (c as unknown as Record<string, unknown>)[k] == null
            return (c as unknown as Record<string, unknown>)[k] === cond.equals
          }))
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        return { docs }
      }
      if (args.collection === 'members') {
        const eq = (args.where as { username: { equals: string } }).username.equals
        return { docs: store.members.filter((m) => m.username === eq) }
      }
      return { docs: [] }
    }),
    create: vi.fn(async (args: { collection: string; data: Record<string, unknown> }) => {
      const doc = { id: nextId++, createdAt: now.toISOString(), updatedAt: now.toISOString(), ...args.data }
      if (args.collection === 'member-sms-codes') store.codes.push(doc as unknown as MemberSmsCode)
      if (args.collection === 'members') store.members.push({ ...doc, sessions: [] } as unknown as Member)
      return doc
    }),
    update: vi.fn(async (args: { collection: string; id: number; data: Record<string, unknown> }) => {
      const list = args.collection === 'member-sms-codes' ? store.codes : store.members
      const doc = (list as unknown as Array<Record<string, unknown>>).find((d) => d.id === args.id)!
      Object.assign(doc, args.data)
      return doc
    }),
    findByID: vi.fn(async (args: { id: number }) => store.members.find((m) => m.id === args.id) ?? null),
    login: vi.fn(async (args: { data: { username: string; password: string } }) => {
      const m = store.members.find((x) => x.username === args.data.username)
      if (!m || args.data.password !== 'Member1234!') throw new Error('AuthenticationError')
      return { token: 'payload-token-value', user: m, exp: 0 }
    }),
    delete: vi.fn(async () => ({ docs: [] })),
  }
  return payload as unknown as Payload
}

function deps(store: Store, overrides: Partial<MemberServiceDeps> = {}): MemberServiceDeps {
  return { payload: fakePayload(store), now: () => now, smsProvider: { name: 'fixture', send: vi.fn(async () => undefined) }, codeMode: 'fixture', ...overrides }
}

describe('member-service', () => {
  it('sendSmsCode 写入哈希而非明文，并调用适配器', async () => {
    const store: Store = { codes: [], members: [] }
    const d = deps(store)
    await sendSmsCode(d, { phone, purpose: 'login', ip: '1.1.1.1' })
    expect(store.codes).toHaveLength(1)
    expect(store.codes[0].codeHash).toBe(hashSmsCode(secret, phone, 'login', '123456'))
    expect(JSON.stringify(store.codes[0])).not.toContain('123456')
    expect(d.smsProvider?.send).toHaveBeenCalledWith({ phone, code: '123456', minutes: 5 })
  })

  it('sendSmsCode 无适配器 → SMS_UNAVAILABLE 且不落库', async () => {
    const store: Store = { codes: [], members: [] }
    await expect(sendSmsCode(deps(store, { smsProvider: null }), { phone, purpose: 'login', ip: 'x' })).rejects.toMatchObject({ code: 'SMS_UNAVAILABLE' })
    expect(store.codes).toHaveLength(0)
  })

  it('consumeSmsCode：正确码 ok 且标记消费；再次使用 invalid；错码累计 attempts', async () => {
    const store: Store = { codes: [], members: [] }
    const d = deps(store)
    await sendSmsCode(d, { phone, purpose: 'login', ip: 'x' })
    expect(await consumeSmsCode(d, { phone, purpose: 'login', code: '000000' })).toBe('invalid')
    expect(store.codes[0].attempts).toBe(1)
    expect(await consumeSmsCode(d, { phone, purpose: 'login', code: '123456' })).toBe('ok')
    expect(store.codes[0].consumedAt).toBeTruthy()
    expect(await consumeSmsCode(d, { phone, purpose: 'login', code: '123456' })).toBe('invalid')
  })

  it('loginWithSms：新号码需同意；同意后创建会员并发 cookie', async () => {
    const store: Store = { codes: [], members: [] }
    const d = deps(store)
    await sendSmsCode(d, { phone, purpose: 'login', ip: 'x' })
    await expect(loginWithSms(d, { phone, code: '123456', consent: null })).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' })
    await sendSmsCode(d, { phone, purpose: 'login', ip: 'x' })
    const result = await loginWithSms(d, { phone, code: '123456', consent: { accepted: true, policyVersion: 'MVP-R2' } })
    expect(result.isNew).toBe(true)
    expect(result.member.username).toBe(phone)
    expect(result.cookie).toMatch(/^sbh-member-token=/)
    expect(store.members[0].sessions).toHaveLength(1)
  })

  it('loginWithPassword：错密码 → INVALID_CREDENTIALS；对 → cookie', async () => {
    const store: Store = { codes: [], members: [{ id: 1, username: phone, status: 'active', hasPassword: true, sessions: [] } as unknown as Member] }
    const d = deps(store)
    await expect(loginWithPassword(d, { phone, password: 'wrong' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    const r = await loginWithPassword(d, { phone, password: 'Member1234!' })
    expect(r.cookie).toContain('sbh-member-token=payload-token-value')
  })

  it('setPasswordWithSms：校验码后写密码、hasPassword、只留当前 sid', async () => {
    const store: Store = { codes: [], members: [{ id: 1, username: phone, status: 'active', hasPassword: false, sessions: [{ id: 'keep', expiresAt: '2030-01-01T00:00:00Z' }, { id: 'drop', expiresAt: '2030-01-01T00:00:00Z' }] } as unknown as Member] }
    const d = deps(store)
    await sendSmsCode(d, { phone, purpose: 'set-password', ip: 'x' })
    await expect(setPasswordWithSms(d, { phone, code: '123456', newPassword: 'short', currentSid: 'keep' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const r = await setPasswordWithSms(d, { phone, code: '123456', newPassword: 'Member1234!', currentSid: 'keep' })
    expect(r.member.hasPassword).toBe(true)
    expect(store.members[0].sessions?.map((s) => s.id)).toEqual(['keep'])
  })

  it('isValidPassword', () => {
    expect(isValidPassword('Abcdefg1')).toBe(true)
    expect(isValidPassword('abcdefgh')).toBe(false)
    expect(isValidPassword('12345678')).toBe(false)
    expect(isValidPassword('Ab1')).toBe(false)
    expect(isValidPassword(42)).toBe(false)
  })

  it('MemberHttpError 带 code', () => {
    expect(new MemberHttpError('RATE_LIMITED', 30)).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 30 })
  })
})
```

`tests/member-http.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { MEMBER_ERROR_STATUS, fail, ok, readJsonBody } from '@/domain/member/http'

describe('member http helpers', () => {
  it('fail 映射状态码与文案，429 带 Retry-After', async () => {
    const r = fail('RATE_LIMITED', 42)
    expect(r.status).toBe(429)
    expect(r.headers.get('Retry-After')).toBe('42')
    expect(await r.json()).toMatchObject({ ok: false, code: 'RATE_LIMITED' })
    expect(MEMBER_ERROR_STATUS.UNAUTHENTICATED).toBe(401)
    expect(MEMBER_ERROR_STATUS.SMS_UNAVAILABLE).toBe(503)
  })
  it('ok 可带 Set-Cookie', async () => {
    const r = ok({ member: null }, { cookie: 'sbh-member-token=x; Path=/' })
    expect(r.headers.get('set-cookie')).toContain('sbh-member-token=x')
    expect(await r.json()).toEqual({ ok: true, member: null })
  })
  it('readJsonBody：跨站 403、非 JSON 400、非对象 400', async () => {
    const origin = 'http://localhost:3717'
    const mk = (headers: Record<string, string>, body: string) => new Request(`${origin}/api/member/x`, { method: 'POST', headers, body })
    await expect(readJsonBody(mk({ host: 'localhost:3717', origin: 'https://evil.example', 'content-type': 'application/json' }, '{}'))).rejects.toMatchObject({ code: 'FORBIDDEN_ORIGIN' })
    await expect(readJsonBody(mk({ host: 'localhost:3717', origin, 'content-type': 'text/plain' }, '{}'))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(readJsonBody(mk({ host: 'localhost:3717', origin, 'content-type': 'application/json' }, '[1]'))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(readJsonBody(mk({ host: 'localhost:3717', origin, 'content-type': 'application/json' }, '{"a":1}'))).resolves.toEqual({ a: 1 })
  })
})
```

`readJsonBody` 用的是 `isSameOriginHost`（只比 Origin 与 Host 头），所以本测试不依赖 `siteConfig`，任何 origin 只要与 host 自洽都通过。

- [ ] **Step 2: 跑测试确认失败** `pnpm exec vitest run tests/member-service.test.ts tests/member-http.test.ts`

- [ ] **Step 3: 写 `src/domain/member/http.ts`**

```ts
/** 会员路由的响应约定（OPT-088 §6）：错误码、状态码、文案单一来源。 */
import { NextResponse } from 'next/server'
import { isSameOriginHost, isStrictJsonContentType } from '@/lib/api/request-guards'

export type MemberErrorCode =
  | 'BAD_REQUEST' | 'INVALID_PHONE' | 'CONSENT_REQUIRED' | 'CODE_INVALID' | 'CODE_EXPIRED' | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED' | 'ACCOUNT_DISABLED' | 'FORBIDDEN_ORIGIN' | 'WECHAT_ALREADY_BOUND' | 'FAVORITE_LIMIT'
  | 'RATE_LIMITED' | 'SMS_UNAVAILABLE'

export const MEMBER_ERROR_STATUS: Record<MemberErrorCode, number> = {
  BAD_REQUEST: 400, INVALID_PHONE: 400, CONSENT_REQUIRED: 400, CODE_INVALID: 400, CODE_EXPIRED: 400,
  INVALID_CREDENTIALS: 401, UNAUTHENTICATED: 401, ACCOUNT_DISABLED: 403, FORBIDDEN_ORIGIN: 403,
  WECHAT_ALREADY_BOUND: 409, FAVORITE_LIMIT: 409, RATE_LIMITED: 429, SMS_UNAVAILABLE: 503,
}

export const MEMBER_ERROR_MESSAGE: Record<MemberErrorCode, string> = {
  BAD_REQUEST: '请求格式不正确',
  INVALID_PHONE: '请输入正确的大陆手机号',
  CONSENT_REQUIRED: '请先阅读并同意隐私政策',
  CODE_INVALID: '验证码错误或已失效',
  CODE_EXPIRED: '验证码已过期，请重新获取',
  INVALID_CREDENTIALS: '手机号或密码错误',
  UNAUTHENTICATED: '请先登录',
  ACCOUNT_DISABLED: '账号已停用，请联系客服',
  FORBIDDEN_ORIGIN: '请求来源不被允许',
  WECHAT_ALREADY_BOUND: '该微信已绑定其他账号，请先在原账号解绑',
  FAVORITE_LIMIT: '收藏已达上限 200 条，请先清理',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  SMS_UNAVAILABLE: '短信服务暂不可用，请稍后再试',
}

export class MemberHttpError extends Error {
  readonly code: MemberErrorCode
  readonly retryAfterSeconds?: number
  constructor(code: MemberErrorCode, retryAfterSeconds?: number) {
    super(MEMBER_ERROR_MESSAGE[code])
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function fail(code: MemberErrorCode, retryAfterSeconds?: number): Response {
  const headers: Record<string, string> = {}
  if (code === 'RATE_LIMITED' && retryAfterSeconds !== undefined) headers['Retry-After'] = String(retryAfterSeconds)
  return NextResponse.json({ ok: false, code, message: MEMBER_ERROR_MESSAGE[code] }, { status: MEMBER_ERROR_STATUS[code], headers })
}

export function ok(body: Record<string, unknown>, init: { cookie?: string; status?: number } = {}): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (init.cookie) headers['Set-Cookie'] = init.cookie
  return NextResponse.json({ ok: true, ...body }, { status: init.status ?? 200, headers })
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  if (!isSameOriginHost(req)) throw new MemberHttpError('FORBIDDEN_ORIGIN')
  if (!isStrictJsonContentType(req.headers.get('content-type'))) throw new MemberHttpError('BAD_REQUEST')
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    throw new MemberHttpError('BAD_REQUEST')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new MemberHttpError('BAD_REQUEST')
  return parsed as Record<string, unknown>
}

export async function handleMemberRoute(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof MemberHttpError) return fail(error.code, error.retryAfterSeconds)
    console.error('[member-route] unexpected error', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, code: 'INTERNAL', message: '服务暂时不可用' }, { status: 500 })
  }
}
```

- [ ] **Step 4: 写 `src/domain/member/member-service.ts`**

```ts
/**
 * 会员领域服务（OPT-088 §6.2–6.4）。路由只做参数收口与响应，业务都在这里，便于用内存版 payload 单测。
 * 所有 Local API 调用 overrideAccess:true 并带 context.memberFlow——那是创建闸门与登录闸门的通行证。
 */
import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import type { Member, MemberSmsCode } from '@/payload-types'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import { createPgRateLimitDeps } from '@/lib/rate-limit-pg'
import { runDistributedRateLimit, type RateLimitConfig } from '@/lib/rate-limit-distributed'
import { extractPgPool } from '@/lib/api/request-guards'
import { isValidCnMobile, normalizePhone } from '@/domain/shared/phone'
import { MemberHttpError } from './http'
import { MEMBER_TOKEN_EXPIRATION_SECONDS } from './member-access'
import { MEMBER_RATE_LIMITS, memberRatePruneRef, rateLimitKey } from './rate-limits'
import { issueMemberSession, signMemberToken, tokenToCookie } from './session'
import {
  SMS_CODE_TTL_MS, checkSmsCode, generateSmsCode, hashSmsCode, type SmsCodeCheck, type SmsPurpose,
} from './sms-code'
import type { SmsProvider } from './sms-provider'

export type MemberServiceDeps = {
  payload: Payload
  now: () => Date
  smsProvider: SmsProvider | null
  codeMode: 'random' | 'fixture'
}

const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)[\x21-\x7e]{8,64}$/
const PRUNE_INTERVAL_MS = 10 * 60_000
let lastCodePruneAt = 0

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && PASSWORD_RE.test(value)
}

export function requirePhone(value: unknown): string {
  if (typeof value !== 'string') throw new MemberHttpError('INVALID_PHONE')
  const normalized = normalizePhone(value)
  if (!isValidCnMobile(normalized)) throw new MemberHttpError('INVALID_PHONE')
  return normalized
}

export async function checkRateLimit(payload: Payload, limit: { prefix: string; config: RateLimitConfig }, raw: string): Promise<void> {
  const pool = extractPgPool(payload.db)
  if (!pool) {
    if (!limit.config.failOpen) throw new MemberHttpError('RATE_LIMITED', 60)
    return
  }
  const decision = await runDistributedRateLimit(createPgRateLimitDeps(pool), limit.config, rateLimitKey(limit.prefix, raw), memberRatePruneRef)
  if (!decision.allowed) throw new MemberHttpError('RATE_LIMITED', Math.max(1, decision.retryAfterSeconds))
}

function hashIp(ip: string): string {
  return rateLimitKey('ip', ip).slice(3)
}

async function pruneExpiredCodes(deps: MemberServiceDeps): Promise<void> {
  const now = deps.now().getTime()
  if (now - lastCodePruneAt < PRUNE_INTERVAL_MS) return
  lastCodePruneAt = now
  const cutoff = new Date(now - 24 * 60 * 60_000).toISOString()
  await deps.payload.delete({ collection: 'member-sms-codes', where: { expiresAt: { less_than: cutoff } }, overrideAccess: true }).catch(() => undefined)
}

export async function sendSmsCode(deps: MemberServiceDeps, input: { phone: string; purpose: SmsPurpose; ip: string }): Promise<void> {
  if (!deps.smsProvider) throw new MemberHttpError('SMS_UNAVAILABLE')
  await checkRateLimit(deps.payload, MEMBER_RATE_LIMITS.smsPhoneMinute, input.phone)
  await checkRateLimit(deps.payload, MEMBER_RATE_LIMITS.smsPhoneDay, input.phone)
  await checkRateLimit(deps.payload, MEMBER_RATE_LIMITS.smsIp, input.ip)
  await pruneExpiredCodes(deps)
  const code = generateSmsCode(deps.codeMode)
  const now = deps.now()
  await deps.payload.create({
    collection: 'member-sms-codes',
    data: {
      phone: input.phone,
      purpose: input.purpose,
      codeHash: hashSmsCode(deps.payload.secret, input.phone, input.purpose, code),
      expiresAt: new Date(now.getTime() + SMS_CODE_TTL_MS).toISOString(),
      attempts: 0,
      ipHash: hashIp(input.ip),
    },
    overrideAccess: true,
  })
  try {
    await deps.smsProvider.send({ phone: input.phone, code, minutes: 5 })
  } catch (error) {
    deps.payload.logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'member_sms_send_failed')
    throw new MemberHttpError('SMS_UNAVAILABLE')
  }
}

async function latestCode(deps: MemberServiceDeps, phone: string, purpose: SmsPurpose): Promise<MemberSmsCode | null> {
  const result = await deps.payload.find({
    collection: 'member-sms-codes',
    where: { and: [{ phone: { equals: phone } }, { purpose: { equals: purpose } }, { consumedAt: { exists: false } }] },
    sort: '-createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs[0] ?? null
}

export async function consumeSmsCode(deps: MemberServiceDeps, input: { phone: string; purpose: SmsPurpose; code: string }): Promise<SmsCodeCheck> {
  const stored = await latestCode(deps, input.phone, input.purpose)
  if (!stored) return 'invalid'
  const attempts = (stored.attempts ?? 0) + 1
  await deps.payload.update({ collection: 'member-sms-codes', id: stored.id, data: { attempts }, overrideAccess: true })
  const check = checkSmsCode({
    secret: deps.payload.secret, phone: input.phone, purpose: input.purpose, code: input.code, now: deps.now(),
    stored: { codeHash: stored.codeHash, expiresAt: stored.expiresAt, attempts, consumedAt: stored.consumedAt ?? null },
  })
  if (check === 'ok') {
    await deps.payload.update({ collection: 'member-sms-codes', id: stored.id, data: { consumedAt: deps.now().toISOString() }, overrideAccess: true })
  }
  return check
}

function throwOnCode(check: SmsCodeCheck): void {
  if (check === 'expired') throw new MemberHttpError('CODE_EXPIRED')
  if (check === 'invalid') throw new MemberHttpError('CODE_INVALID')
}

export async function findMemberByPhone(deps: MemberServiceDeps, phone: string): Promise<Member | null> {
  const result = await deps.payload.find({ collection: 'members', where: { username: { equals: phone } }, limit: 1, depth: 0, overrideAccess: true })
  return result.docs[0] ?? null
}

export async function createMemberFromVerifiedPhone(deps: MemberServiceDeps, input: { phone: string; policyVersion: string; flow: string }): Promise<Member> {
  const now = deps.now().toISOString()
  return deps.payload.create({
    collection: 'members',
    data: {
      username: input.phone,
      // 本地策略要求 create 带 password；未设密码的会员给一个不可猜的随机值，hasPassword 标记状态
      password: randomBytes(32).toString('hex'),
      hasPassword: false,
      status: 'active',
      consentPolicyVersion: input.policyVersion,
      consentAcceptedAt: now,
    },
    overrideAccess: true,
    context: { memberFlow: input.flow },
  })
}

function assertActive(member: Member): void {
  if (member.status !== 'active') throw new MemberHttpError('ACCOUNT_DISABLED')
}

export async function loginWithSms(
  deps: MemberServiceDeps,
  input: { phone: string; code: string; consent: { accepted: boolean; policyVersion: string } | null },
): Promise<{ member: Member; isNew: boolean; cookie: string }> {
  throwOnCode(await consumeSmsCode(deps, { phone: input.phone, purpose: 'login', code: input.code }))
  let member = await findMemberByPhone(deps, input.phone)
  let isNew = false
  if (!member) {
    const consentOk = input.consent?.accepted === true && input.consent.policyVersion === PRIVACY_POLICY_VERSION
    if (!consentOk) throw new MemberHttpError('CONSENT_REQUIRED')
    member = await createMemberFromVerifiedPhone(deps, { phone: input.phone, policyVersion: PRIVACY_POLICY_VERSION, flow: 'sms' })
    isNew = true
  }
  assertActive(member)
  const { cookie } = await issueMemberSession(deps.payload, member, deps.now())
  return { member, isNew, cookie }
}

export async function loginWithPassword(deps: MemberServiceDeps, input: { phone: string; password: string }): Promise<{ member: Member; cookie: string }> {
  let result: { token?: string; user: Member }
  try {
    result = await deps.payload.login({
      collection: 'members',
      data: { username: input.phone, password: input.password },
      context: { memberFlow: 'password' },
      depth: 0,
    })
  } catch {
    // 密码错、账号锁定、账号停用、不存在：一律同一文案，不泄露存在性与锁定态
    throw new MemberHttpError('INVALID_CREDENTIALS')
  }
  if (!result.token) throw new MemberHttpError('INVALID_CREDENTIALS')
  await deps.payload.update({
    collection: 'members', id: result.user.id, data: { lastLoginAt: deps.now().toISOString() }, overrideAccess: true, context: { memberFlow: 'session' },
  })
  return { member: result.user, cookie: await tokenToCookie(deps.payload, result.token) }
}

export async function setPasswordWithSms(
  deps: MemberServiceDeps,
  input: { phone: string; code: string; newPassword: string; currentSid: string | null },
): Promise<{ member: Member; cookie: string }> {
  if (!isValidPassword(input.newPassword)) throw new MemberHttpError('BAD_REQUEST')
  throwOnCode(await consumeSmsCode(deps, { phone: input.phone, purpose: 'set-password', code: input.code }))
  const member = await findMemberByPhone(deps, input.phone)
  if (!member) throw new MemberHttpError('CODE_INVALID')
  assertActive(member)
  const kept = (member.sessions ?? []).filter((s) => s.id === input.currentSid)
  const updated = await deps.payload.update({
    collection: 'members',
    id: member.id,
    data: { password: input.newPassword, hasPassword: true, sessions: kept },
    overrideAccess: true,
    context: { memberFlow: 'password-set' },
  })
  if (input.currentSid) {
    // 已登录改密码：保留当前 sid、重签 token，本设备不掉线，其它设备全部下线
    const token = await signMemberToken({ id: member.id, collection: 'members', sid: input.currentSid }, deps.payload.secret, MEMBER_TOKEN_EXPIRATION_SECONDS)
    return { member: updated, cookie: await tokenToCookie(deps.payload, token) }
  }
  const { cookie } = await issueMemberSession(deps.payload, updated, deps.now())
  return { member: updated, cookie }
}

export async function updateNickname(deps: MemberServiceDeps, member: Member, nickname: string): Promise<Member> {
  const trimmed = nickname.trim()
  if (trimmed.length < 1 || trimmed.length > 30) throw new MemberHttpError('BAD_REQUEST')
  return deps.payload.update({ collection: 'members', id: member.id, data: { nickname: trimmed }, overrideAccess: true, context: { memberFlow: 'profile' } })
}

/** 路由用：从环境装配 deps。 */
export async function buildMemberServiceDeps(payload: Payload): Promise<MemberServiceDeps> {
  const { resolveSmsProvider } = await import('./sms-provider')
  const provider = resolveSmsProvider(process.env, (msg) => payload.logger.info(msg))
  return { payload, now: () => new Date(), smsProvider: provider, codeMode: provider?.name === 'fixture' ? 'fixture' : 'random' }
}
```

`setPasswordWithSms` 里把已登录用户的 `currentSid` 保留并重签一次 token，是为了让「已登录改密码」后 cookie 仍有效且其它设备全部下线；未登录（忘记密码）走 `issueMemberSession` 直接登录。

- [ ] **Step 5: 写七个路由**

`src/app/api/member/sms/send/route.ts`：

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { clientIp } from '@/lib/api/request-guards'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'
import { buildMemberServiceDeps, requirePhone, sendSmsCode } from '@/domain/member/member-service'
import { isSmsPurpose } from '@/domain/member/sms-code'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const phone = requirePhone(body.phone)
    if (!isSmsPurpose(body.purpose)) throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    const deps = await buildMemberServiceDeps(payload)
    await sendSmsCode(deps, { phone, purpose: body.purpose, ip: clientIp(req) })
    // 不论号码是否已注册都 200：不泄露注册状态
    return ok({})
  })
}
```

`src/app/api/member/login/sms/route.ts`：

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { clientIp } from '@/lib/api/request-guards'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'
import { toMemberDto } from '@/domain/member/member-dto'
import { buildMemberServiceDeps, checkRateLimit, loginWithSms, requirePhone } from '@/domain/member/member-service'
import { MEMBER_RATE_LIMITS } from '@/domain/member/rate-limits'

function readConsent(value: unknown): { accepted: boolean; policyVersion: string } | null {
  if (value === null || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  return { accepted: v.accepted === true, policyVersion: typeof v.policyVersion === 'string' ? v.policyVersion : '' }
}

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const phone = requirePhone(body.phone)
    if (typeof body.code !== 'string') throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    await checkRateLimit(payload, MEMBER_RATE_LIMITS.loginIp, clientIp(req))
    const deps = await buildMemberServiceDeps(payload)
    const { member, isNew, cookie } = await loginWithSms(deps, { phone, code: body.code, consent: readConsent(body.consent) })
    return ok({ member: toMemberDto(member), isNew }, { cookie })
  })
}
```

`src/app/api/member/login/password/route.ts`：

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { clientIp } from '@/lib/api/request-guards'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'
import { toMemberDto } from '@/domain/member/member-dto'
import { buildMemberServiceDeps, checkRateLimit, loginWithPassword, requirePhone } from '@/domain/member/member-service'
import { MEMBER_RATE_LIMITS } from '@/domain/member/rate-limits'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const phone = requirePhone(body.phone)
    if (typeof body.password !== 'string' || body.password.length === 0) throw new MemberHttpError('INVALID_CREDENTIALS')
    const payload = await getPayload({ config })
    await checkRateLimit(payload, MEMBER_RATE_LIMITS.loginIp, clientIp(req))
    const deps = await buildMemberServiceDeps(payload)
    const { member, cookie } = await loginWithPassword(deps, { phone, password: body.password })
    return ok({ member: toMemberDto(member) }, { cookie })
  })
}
```

`src/app/api/member/me/route.ts`：

```ts
import { getCurrentMemberDto } from '@/domain/member/current-member'
import { handleMemberRoute, ok } from '@/domain/member/http'

export async function GET(): Promise<Response> {
  return handleMemberRoute(async () => ok({ member: await getCurrentMemberDto() }))
}
```

`src/app/api/member/logout/route.ts`：

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMember } from '@/domain/member/current-member'
import { handleMemberRoute, ok, readJsonBody } from '@/domain/member/http'
import { MEMBER_COOKIE_NAME, expiredMemberCookie, readCookie, revokeMemberSession, verifyMemberToken } from '@/domain/member/session'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    await readJsonBody(req) // 只为同源校验；body 可为 {}
    const payload = await getPayload({ config })
    const member = await getCurrentMember()
    const token = readCookie(req.headers.get('cookie'), MEMBER_COOKIE_NAME)
    const claims = token ? await verifyMemberToken(token, payload.secret) : null
    if (member && claims) await revokeMemberSession(payload, member, claims.sid)
    return ok({}, { cookie: expiredMemberCookie({ secure: process.env.NODE_ENV === 'production' }) })
  })
}
```

`src/app/api/member/password/route.ts`：

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { clientIp } from '@/lib/api/request-guards'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'
import { toMemberDto } from '@/domain/member/member-dto'
import { buildMemberServiceDeps, checkRateLimit, requirePhone, setPasswordWithSms } from '@/domain/member/member-service'
import { MEMBER_RATE_LIMITS } from '@/domain/member/rate-limits'
import { MEMBER_COOKIE_NAME, readCookie, verifyMemberToken } from '@/domain/member/session'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const phone = requirePhone(body.phone)
    if (typeof body.code !== 'string' || typeof body.newPassword !== 'string') throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    await checkRateLimit(payload, MEMBER_RATE_LIMITS.loginIp, clientIp(req))
    const token = readCookie(req.headers.get('cookie'), MEMBER_COOKIE_NAME)
    const claims = token ? await verifyMemberToken(token, payload.secret) : null
    const deps = await buildMemberServiceDeps(payload)
    const { member, cookie } = await setPasswordWithSms(deps, { phone, code: body.code, newPassword: body.newPassword, currentSid: claims?.sid ?? null })
    return ok({ member: toMemberDto(member) }, { cookie })
  })
}
```

`src/app/api/member/profile/route.ts`：

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMember } from '@/domain/member/current-member'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'
import { toMemberDto } from '@/domain/member/member-dto'
import { buildMemberServiceDeps, updateNickname } from '@/domain/member/member-service'

export async function PATCH(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')
    if (typeof body.nickname !== 'string') throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    const updated = await updateNickname(await buildMemberServiceDeps(payload), member, body.nickname)
    return ok({ member: toMemberDto(updated) })
  })
}
```

- [ ] **Step 6: 验证**

```bash
pnpm exec vitest run tests/member-service.test.ts tests/member-http.test.ts
pnpm typecheck
pnpm lint
```

预期：PASS。类型报错常见两处：`payload.login` 返回类型的 `user` 是 `Member`（生成类型里 `AuthOperationsFromCollectionSlug<'members'>` 存在即可）；`payload.find` 的 `where` 用 `exists: false` 需写成 `{ consumedAt: { exists: false } }`（已如此）。

- [ ] **Step 7: 提交**

```bash
git add src/domain/member/http.ts src/domain/member/member-service.ts src/app/api/member tests/member-service.test.ts tests/member-http.test.ts
git commit -m "feat(members): 短信 / 密码登录、设密码、资料、退出的领域服务与路由（OPT-088）"
```

---

### Task 8：收藏

**Files:**
- Create: `src/domain/member/favorites.ts`
- Create: `src/app/api/member/favorites/route.ts`、`src/app/api/member/favorites/merge/route.ts`
- Test: `tests/member-favorites.test.ts`

**Interfaces:**
- Produces（签名逐字）：

```ts
export type FavoriteType = 'listing' | 'building'
export type FavoriteItem = Readonly<{ type: FavoriteType; id: number; slug: string; title: string; savedAt: string }>
export const FAVORITES_LIMIT = 200
export function isFavoriteInput(value: unknown): value is { type: FavoriteType; id: number; slug: string }
export function isFavoriteMergeItem(value: unknown): value is { type: FavoriteType; id: number; slug: string; savedAt: string }
export function mergeFavorites(server: readonly FavoriteItem[], incoming: readonly { type: FavoriteType; id: number; slug: string; savedAt: string; title: string }[]): FavoriteItem[]  // 去重（保留 savedAt 较新），按 savedAt 倒序，裁到 200
export async function listFavorites(payload: Payload, memberId: number): Promise<FavoriteItem[]>
export async function addFavorite(payload: Payload, memberId: number, input: { type: FavoriteType; id: number; slug: string }, savedAt?: string): Promise<FavoriteItem[]>   // 超限抛 MemberHttpError('FAVORITE_LIMIT')；目标不存在抛 BAD_REQUEST
export async function removeFavorite(payload: Payload, memberId: number, input: { type: FavoriteType; id: number }): Promise<FavoriteItem[]>
export async function mergeLocalFavorites(payload: Payload, memberId: number, items: readonly { type: FavoriteType; id: number; slug: string; savedAt: string }[]): Promise<FavoriteItem[]>
```

- [ ] **Step 1: 写失败测试** `tests/member-favorites.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { FAVORITES_LIMIT, isFavoriteInput, isFavoriteMergeItem, mergeFavorites, type FavoriteItem } from '@/domain/member/favorites'

const item = (id: number, savedAt: string, type: 'listing' | 'building' = 'listing'): FavoriteItem => ({ type, id, slug: `s${id}`, title: `t${id}`, savedAt })

describe('favorites 纯规则', () => {
  it('输入守卫', () => {
    expect(isFavoriteInput({ type: 'listing', id: 1, slug: 'a' })).toBe(true)
    expect(isFavoriteInput({ type: 'x', id: 1, slug: 'a' })).toBe(false)
    expect(isFavoriteInput({ type: 'listing', id: '1', slug: 'a' })).toBe(false)
    expect(isFavoriteMergeItem({ type: 'building', id: 2, slug: 'b', savedAt: '2026-01-01T00:00:00Z' })).toBe(true)
    expect(isFavoriteMergeItem({ type: 'building', id: 2, slug: 'b' })).toBe(false)
  })
  it('合并：同 type+id 保留较新 savedAt，倒序，裁到 200', () => {
    const server = [item(1, '2026-01-01T00:00:00Z'), item(2, '2026-01-03T00:00:00Z')]
    const incoming = [{ ...item(1, '2026-01-05T00:00:00Z'), title: 'new' }, { ...item(3, '2026-01-02T00:00:00Z') }]
    const merged = mergeFavorites(server, incoming)
    expect(merged.map((f) => f.id)).toEqual([1, 2, 3])
    expect(merged[0].savedAt).toBe('2026-01-05T00:00:00Z')
    const many = Array.from({ length: 250 }, (_, i) => item(i + 10, `2026-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`))
    expect(mergeFavorites([], many)).toHaveLength(FAVORITES_LIMIT)
  })
  it('listing 与 building 同 id 不冲突', () => {
    expect(mergeFavorites([item(1, '2026-01-01T00:00:00Z')], [item(1, '2026-01-01T00:00:00Z', 'building')])).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败** `pnpm exec vitest run tests/member-favorites.test.ts`

- [ ] **Step 3: 写 `src/domain/member/favorites.ts`**

```ts
/** 收藏（OPT-088 §6.5 / §9）。纯规则在上半部分，Local API 在下半部分。 */
import type { Payload } from 'payload'
import type { MemberFavorite } from '@/payload-types'
import { MemberHttpError } from './http'

export type FavoriteType = 'listing' | 'building'
export type FavoriteItem = Readonly<{ type: FavoriteType; id: number; slug: string; title: string; savedAt: string }>
export const FAVORITES_LIMIT = 200

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/

function isType(v: unknown): v is FavoriteType {
  return v === 'listing' || v === 'building'
}

export function isFavoriteInput(value: unknown): value is { type: FavoriteType; id: number; slug: string } {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return isType(v.type) && typeof v.id === 'number' && Number.isInteger(v.id) && v.id > 0 && typeof v.slug === 'string' && SLUG_RE.test(v.slug)
}

export function isFavoriteMergeItem(value: unknown): value is { type: FavoriteType; id: number; slug: string; savedAt: string } {
  if (!isFavoriteInput(value)) return false
  const savedAt = (value as Record<string, unknown>).savedAt
  return typeof savedAt === 'string' && !Number.isNaN(Date.parse(savedAt))
}

const keyOf = (f: { type: FavoriteType; id: number }): string => `${f.type}:${f.id}`

export function mergeFavorites(
  server: readonly FavoriteItem[],
  incoming: readonly { type: FavoriteType; id: number; slug: string; savedAt: string; title: string }[],
): FavoriteItem[] {
  const map = new Map<string, FavoriteItem>()
  for (const f of [...server, ...incoming]) {
    const k = keyOf(f)
    const prev = map.get(k)
    if (!prev || Date.parse(f.savedAt) > Date.parse(prev.savedAt)) map.set(k, { type: f.type, id: f.id, slug: f.slug, title: f.title, savedAt: f.savedAt })
  }
  return [...map.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)).slice(0, FAVORITES_LIMIT)
}

function toItem(doc: MemberFavorite): FavoriteItem {
  return { type: doc.targetType, id: doc.targetId, slug: doc.targetSlug, title: doc.titleSnapshot, savedAt: doc.savedAt }
}

async function docsOf(payload: Payload, memberId: number): Promise<MemberFavorite[]> {
  const result = await payload.find({
    collection: 'member-favorites', where: { member: { equals: memberId } }, sort: '-savedAt', limit: FAVORITES_LIMIT + 1, depth: 0, overrideAccess: true,
  })
  return result.docs
}

export async function listFavorites(payload: Payload, memberId: number): Promise<FavoriteItem[]> {
  return (await docsOf(payload, memberId)).map(toItem)
}

async function titleOf(payload: Payload, type: FavoriteType, id: number): Promise<string | null> {
  const collection = type === 'listing' ? 'listings' : 'buildings'
  const doc = await payload.findByID({ collection, id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!doc) return null
  const title = (doc as { title?: unknown; name?: unknown }).title ?? (doc as { name?: unknown }).name
  return typeof title === 'string' && title.length > 0 ? title : '未命名'
}

export async function addFavorite(payload: Payload, memberId: number, input: { type: FavoriteType; id: number; slug: string }, savedAt = new Date().toISOString()): Promise<FavoriteItem[]> {
  const existing = await docsOf(payload, memberId)
  if (existing.some((d) => d.targetType === input.type && d.targetId === input.id)) return existing.map(toItem)
  if (existing.length >= FAVORITES_LIMIT) throw new MemberHttpError('FAVORITE_LIMIT')
  const title = await titleOf(payload, input.type, input.id)
  if (title === null) throw new MemberHttpError('BAD_REQUEST')
  await payload.create({
    collection: 'member-favorites',
    data: { member: memberId, targetType: input.type, targetId: input.id, targetSlug: input.slug, titleSnapshot: title, savedAt, targetKey: `${memberId}:${input.type}:${input.id}` },
    overrideAccess: true,
  })
  return listFavorites(payload, memberId)
}

export async function removeFavorite(payload: Payload, memberId: number, input: { type: FavoriteType; id: number }): Promise<FavoriteItem[]> {
  await payload.delete({
    collection: 'member-favorites',
    where: { and: [{ member: { equals: memberId } }, { targetType: { equals: input.type } }, { targetId: { equals: input.id } }] },
    overrideAccess: true,
  })
  return listFavorites(payload, memberId)
}

export async function mergeLocalFavorites(payload: Payload, memberId: number, items: readonly { type: FavoriteType; id: number; slug: string; savedAt: string }[]): Promise<FavoriteItem[]> {
  const server = await listFavorites(payload, memberId)
  const known = new Set(server.map(keyOf))
  const resolved: { type: FavoriteType; id: number; slug: string; savedAt: string; title: string }[] = []
  for (const it of items.slice(0, 100)) {
    if (known.has(keyOf(it))) continue
    const title = await titleOf(payload, it.type, it.id)
    if (title === null) continue
    resolved.push({ ...it, title })
  }
  const merged = mergeFavorites(server, resolved)
  const keep = new Set(merged.map(keyOf))
  for (const f of merged) {
    if (!known.has(keyOf(f))) {
      await payload.create({
        collection: 'member-favorites',
        data: { member: memberId, targetType: f.type, targetId: f.id, targetSlug: f.slug, titleSnapshot: f.title, savedAt: f.savedAt, targetKey: `${memberId}:${f.type}:${f.id}` },
        overrideAccess: true,
      })
    }
  }
  for (const s of server) {
    if (!keep.has(keyOf(s))) await removeFavorite(payload, memberId, s)
  }
  return listFavorites(payload, memberId)
}
```

- [ ] **Step 4: 写两个路由**

`src/app/api/member/favorites/route.ts`：

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMember } from '@/domain/member/current-member'
import { addFavorite, isFavoriteInput, listFavorites, removeFavorite } from '@/domain/member/favorites'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'

export async function GET(): Promise<Response> {
  return handleMemberRoute(async () => {
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')
    const payload = await getPayload({ config })
    return ok({ items: await listFavorites(payload, member.id) })
  })
}

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')
    if (!isFavoriteInput(body)) throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    return ok({ items: await addFavorite(payload, member.id, body) })
  })
}

export async function DELETE(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')
    const type = body.type
    const id = body.id
    if ((type !== 'listing' && type !== 'building') || typeof id !== 'number') throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    return ok({ items: await removeFavorite(payload, member.id, { type, id }) })
  })
}
```

`src/app/api/member/favorites/merge/route.ts`：

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMember } from '@/domain/member/current-member'
import { isFavoriteMergeItem, mergeLocalFavorites } from '@/domain/member/favorites'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')
    if (!Array.isArray(body.items) || body.items.length > 100) throw new MemberHttpError('BAD_REQUEST')
    const items = body.items.filter(isFavoriteMergeItem)
    const payload = await getPayload({ config })
    return ok({ items: await mergeLocalFavorites(payload, member.id, items) })
  })
}
```

- [ ] **Step 5: 验证** `pnpm exec vitest run tests/member-favorites.test.ts && pnpm typecheck && pnpm lint` → PASS。

- [ ] **Step 6: 提交**

```bash
git add src/domain/member/favorites.ts src/app/api/member/favorites tests/member-favorites.test.ts
git commit -m "feat(members): 收藏的领域规则与路由（OPT-088）"
```

### Task 9：前台会员上下文、顶栏 / 抽屉入口、页脚员工入口

**Files:**
- Create: `src/components/frontend/member/MemberProvider.tsx`、`src/components/frontend/member/MemberMenu.tsx`、`src/components/frontend/member/member-api.ts`
- Create: `src/app/(frontend)/styles/member.css`
- Modify: `src/components/frontend/SiteHeader.tsx`（新增 `member` prop，actions 里渲染 `MemberMenu`，向 `SiteNav` 传 `member`）
- Modify: `src/components/frontend/SiteNav.tsx`（新增 `member` prop；抽屉顶部会员区块）
- Modify: `src/components/frontend/SiteFooter.tsx:94-99`（底栏加员工入口）
- Modify: `src/app/(frontend)/layout.tsx`（import `member.css`；`getCurrentMemberDto()`；`MemberProvider`；传 `member`）
- Modify: `tests/frontend-shell-hydration.test.ts`、`tests/city-switcher.test.ts`（mock `current-member`；断言新入口）
- Test: `tests/member-menu.test.ts`

**Interfaces:**
- Consumes: `MemberDto`（T6）、`FavoriteItem`（T8）、`/api/member/*` 契约（T7/T8）。
- Produces（签名逐字）：

```ts
// member-api.ts（client 侧 fetch 封装）
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }
export async function memberPost<T>(path: string, body: unknown, method?: 'POST' | 'PATCH' | 'DELETE'): Promise<ApiResult<T>>
export async function memberGet<T>(path: string): Promise<ApiResult<T>>
// MemberProvider.tsx
export type MemberContextValue = Readonly<{
  member: MemberDto | null
  favorites: readonly FavoriteItem[]
  favoritesReady: boolean
  isFavorite: (type: FavoriteType, id: number) => boolean
  addFavorite: (input: { type: FavoriteType; id: number; slug: string }) => Promise<string | null>   // 返回错误文案或 null
  removeFavorite: (input: { type: FavoriteType; id: number }) => Promise<string | null>
  logout: () => Promise<void>
}>
export function MemberProvider(props: { initialMember: MemberDto | null; children: React.ReactNode }): JSX.Element
export function useMember(): MemberContextValue     // Provider 外调用返回「未登录」空实现，方便单测
// MemberMenu.tsx
export default function MemberMenu(props: { member: MemberDto | null; pathname: string; variant: 'desktop' | 'drawer'; onNavigate?: () => void }): JSX.Element
export function memberDisplayName(member: MemberDto): string   // 昵称首字，否则「尾号 XXXX」
export function loginHref(pathname: string): string           // `/login?returnTo=<encodeURIComponent(pathname)>`
```

- [ ] **Step 1: 写失败测试** `tests/member-menu.test.ts`

```ts
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }))

import MemberMenu, { loginHref, memberDisplayName } from '@/components/frontend/member/MemberMenu'

const member = { id: 1, phoneMasked: '138****1234', nickname: null, hasPassword: false, wechatBound: false, createdAt: '' }

describe('MemberMenu', () => {
  it('loginHref 带 returnTo', () => {
    expect(loginHref('/listings?type=coworking')).toBe('/login?returnTo=%2Flistings%3Ftype%3Dcoworking')
  })
  it('显示名：昵称首字 / 尾号', () => {
    expect(memberDisplayName({ ...member, nickname: '小王' })).toBe('小')
    expect(memberDisplayName(member)).toBe('尾号 1234')
  })
  it('未登录桌面态渲染登录链接', () => {
    const html = renderToStaticMarkup(React.createElement(MemberMenu, { member: null, pathname: '/buildings', variant: 'desktop' }))
    expect(html).toContain('href="/login?returnTo=%2Fbuildings"')
    expect(html).toContain('登录')
  })
  it('已登录抽屉态渲染四项', () => {
    const html = renderToStaticMarkup(React.createElement(MemberMenu, { member, pathname: '/', variant: 'drawer' }))
    for (const text of ['我的收藏', '我的咨询与委托', '账号设置', '退出登录']) expect(html).toContain(text)
    expect(html).toContain('/account/favorites')
    expect(html).toContain('/account/inquiries')
  })
})
```

- [ ] **Step 2: 跑测试确认失败** `pnpm exec vitest run tests/member-menu.test.ts`

- [ ] **Step 3: 写 `member-api.ts`**

```ts
'use client'

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

async function parse<T>(res: Response): Promise<ApiResult<T>> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    return { ok: false, code: 'INTERNAL', message: '服务暂时不可用' }
  }
  const b = (body ?? {}) as Record<string, unknown>
  if (res.ok && b.ok === true) return { ok: true, data: body as T }
  return { ok: false, code: typeof b.code === 'string' ? b.code : 'INTERNAL', message: typeof b.message === 'string' ? b.message : '服务暂时不可用' }
}

export async function memberPost<T>(path: string, body: unknown, method: 'POST' | 'PATCH' | 'DELETE' = 'POST'): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body ?? {}) })
    return await parse<T>(res)
  } catch {
    return { ok: false, code: 'NETWORK', message: '网络异常，请稍后重试' }
  }
}

export async function memberGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' })
    return await parse<T>(res)
  } catch {
    return { ok: false, code: 'NETWORK', message: '网络异常，请稍后重试' }
  }
}
```

- [ ] **Step 4: 写 `MemberProvider.tsx`**

```tsx
'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { MemberDto } from '@/domain/member/member-dto'
import type { FavoriteItem, FavoriteType } from '@/domain/member/favorites'
import { loadSavedDetails, clearSavedDetails } from '@/lib/frontend/saved-details'
import { memberGet, memberPost } from './member-api'

export type MemberContextValue = Readonly<{
  member: MemberDto | null
  favorites: readonly FavoriteItem[]
  favoritesReady: boolean
  isFavorite: (type: FavoriteType, id: number) => boolean
  addFavorite: (input: { type: FavoriteType; id: number; slug: string }) => Promise<string | null>
  removeFavorite: (input: { type: FavoriteType; id: number }) => Promise<string | null>
  logout: () => Promise<void>
}>

const EMPTY: MemberContextValue = {
  member: null, favorites: [], favoritesReady: false,
  isFavorite: () => false, addFavorite: async () => '请先登录', removeFavorite: async () => '请先登录', logout: async () => undefined,
}

const MemberContext = createContext<MemberContextValue>(EMPTY)

type ItemsBody = { items: FavoriteItem[] }

/**
 * 会员上下文（OPT-088 §8.1 / §9）。
 * 登录态下收藏以服务端为准：挂载时拉一次；若 localStorage 里还有未登录时的收藏，先合并上传再清空本地。
 * 未登录时本 Provider 只提供 member=null，收藏按钮走原来的 localStorage 分支。
 */
export function MemberProvider({ initialMember, children }: { initialMember: MemberDto | null; children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<readonly FavoriteItem[]>([])
  const [favoritesReady, setFavoritesReady] = useState(false)
  const bootstrapped = useRef(false)

  useEffect(() => {
    if (!initialMember || bootstrapped.current) return
    bootstrapped.current = true
    let cancelled = false
    const run = async () => {
      const local = loadSavedDetails()
      const result = local.length > 0
        ? await memberPost<ItemsBody>('/api/member/favorites/merge', { items: local })
        : await memberGet<ItemsBody>('/api/member/favorites')
      if (cancelled) return
      if (result.ok) {
        setFavorites(result.data.items)
        if (local.length > 0) clearSavedDetails()
      }
      setFavoritesReady(true)
    }
    void run()
    return () => { cancelled = true }
  }, [initialMember])

  const isFavorite = useCallback((type: FavoriteType, id: number) => favorites.some((f) => f.type === type && f.id === id), [favorites])

  const addFavorite = useCallback(async (input: { type: FavoriteType; id: number; slug: string }) => {
    const prev = favorites
    setFavorites([{ ...input, title: '', savedAt: new Date().toISOString() }, ...prev.filter((f) => !(f.type === input.type && f.id === input.id))])
    const result = await memberPost<ItemsBody>('/api/member/favorites', input)
    if (!result.ok) { setFavorites(prev); return result.message }
    setFavorites(result.data.items)
    return null
  }, [favorites])

  const removeFavorite = useCallback(async (input: { type: FavoriteType; id: number }) => {
    const prev = favorites
    setFavorites(prev.filter((f) => !(f.type === input.type && f.id === input.id)))
    const result = await memberPost<ItemsBody>('/api/member/favorites', input, 'DELETE')
    if (!result.ok) { setFavorites(prev); return result.message }
    setFavorites(result.data.items)
    return null
  }, [favorites])

  const logout = useCallback(async () => {
    await memberPost('/api/member/logout', {})
    window.location.assign('/')
  }, [])

  const value = useMemo<MemberContextValue>(() => ({
    member: initialMember, favorites, favoritesReady, isFavorite, addFavorite, removeFavorite, logout,
  }), [initialMember, favorites, favoritesReady, isFavorite, addFavorite, removeFavorite, logout])

  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>
}

export function useMember(): MemberContextValue {
  return useContext(MemberContext)
}
```

`src/lib/frontend/saved-details.ts` 追加一个导出（放在 `isLocalStorageAvailable` 之前）：

```ts
/** 登录合并后清空本地收藏，避免两份事实源。 */
export function clearSavedDetails(): void {
  const storage = getStorage()
  if (storage === null) return
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // 与 persist 同样静默
  }
  notifySavedChange()
}
```

- [ ] **Step 5: 写 `MemberMenu.tsx`**

```tsx
'use client'

import Link from 'next/link'
import React, { useEffect, useRef, useState } from 'react'
import type { MemberDto } from '@/domain/member/member-dto'
import { useMember } from './MemberProvider'

export function loginHref(pathname: string): string {
  return `/login?returnTo=${encodeURIComponent(pathname)}`
}

export function memberDisplayName(member: MemberDto): string {
  const nick = member.nickname?.trim()
  if (nick) return Array.from(nick)[0]
  return `尾号 ${member.phoneMasked.slice(-4)}`
}

const ITEMS = [
  { href: '/account/favorites', label: '我的收藏' },
  { href: '/account/inquiries', label: '我的咨询与委托' },
  { href: '/account', label: '账号设置' },
] as const

/**
 * 顶栏登录入口 / 会员菜单（OPT-088 §8.1）。
 * desktop：登录 pill 或头像触发器 + 下拉；drawer：抽屉顶部的平铺列表。
 * 下拉的 Esc / 外点关闭 / 焦点归还照 SiteNav 抽屉的做法。
 */
export default function MemberMenu({ member, pathname, variant, onNavigate }: Readonly<{
  member: MemberDto | null
  pathname: string
  variant: 'desktop' | 'drawer'
  onNavigate?: () => void
}>) {
  const { logout } = useMember()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!member) {
    if (variant === 'drawer') {
      return (
        <div className="member-drawer">
          <Link href={loginHref(pathname)} className="mobile-drawer__link member-drawer__login" onClick={onNavigate}>登录 / 注册</Link>
        </div>
      )
    }
    return <Link href={loginHref(pathname)} className="btn btn--ghost btn--sm member-login">登录</Link>
  }

  const items = ITEMS.map((item) => (
    <Link key={item.href} href={item.href} className={variant === 'drawer' ? 'mobile-drawer__link' : 'member-menu__item'} role={variant === 'drawer' ? undefined : 'menuitem'} onClick={() => { setOpen(false); onNavigate?.() }}>
      {item.label}
    </Link>
  ))
  const logoutButton = (
    <button type="button" className={variant === 'drawer' ? 'mobile-drawer__link member-drawer__logout' : 'member-menu__item member-menu__item--danger'} role={variant === 'drawer' ? undefined : 'menuitem'} onClick={() => { void logout() }}>
      退出登录
    </button>
  )

  if (variant === 'drawer') {
    return (
      <div className="member-drawer" aria-label="账号">
        <p className="member-drawer__phone">{member.phoneMasked}</p>
        {items}
        {logoutButton}
      </div>
    )
  }

  return (
    <div className="member-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="member-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="账号菜单"
        title={member.phoneMasked}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="member-menu__avatar" aria-hidden="true">{memberDisplayName(member)}</span>
      </button>
      {open ? (
        <div className="member-menu__panel" role="menu">
          <p className="member-menu__phone">{member.phoneMasked}</p>
          {items}
          {logoutButton}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 6: 接线 `SiteHeader.tsx` / `SiteNav.tsx` / `layout.tsx` / `SiteFooter.tsx`**

`SiteHeader.tsx`：
- `import MemberMenu from '@/components/frontend/member/MemberMenu'` 与 `import type { MemberDto } from '@/domain/member/member-dto'`。
- `HeaderShellProps` 与 `SiteHeader` 的 props 各加 `member?: MemberDto | null`（可选，缺省 `null`，既有测试不用改就能编译）。
- `HeaderContents` 里 `actions` 改为：

```tsx
actions={
  <>
    {showSearch ? (
      <HeaderSearch
        citySlug={multiCityRoutingEnabled && currentCity ? currentCity.slug : undefined}
        initialKeyword={searchParams.get('q') ?? undefined}
      />
    ) : null}
    <span className="member-menu-slot">
      <MemberMenu member={member ?? null} pathname={pathname} variant="desktop" />
    </span>
  </>
}
```

并把 `member` 传给 `SiteNav`（`member={member ?? null}`）。

`SiteNav.tsx`：
- props 加 `member?: MemberDto | null`；`import MemberMenu from '@/components/frontend/member/MemberMenu'`。
- 抽屉里 `<nav className="mobile-drawer__nav" ...>` **之前**插入：

```tsx
<MemberMenu member={member ?? null} pathname={pathname} variant="drawer" onNavigate={() => { setOpen(false); toggleRef.current?.focus() }} />
```

- 焦点循环的首元素会变成会员区块的第一个链接；`tests/city-switcher.test.ts` 里断言「Tab 到底回到第一条导航链接」的用例把期望改成会员区块首链接（这是行为变化的正确反映）。

`layout.tsx`：
- import：`import './styles/member.css'`（放在 `recruit.css` 之后）、`import { MemberProvider } from '@/components/frontend/member/MemberProvider'`、`import { getCurrentMemberDto } from '@/domain/member/current-member'`。
- `Promise.all` 里加第四项 `getCurrentMemberDto()`，解构为 `member`。
- `<body>` 内用 `<MemberProvider initialMember={member}>` 包住 skip link 到 `SiteFooter` 的整段（`Script` 与 `AnalyticsInit` 留在外面也可）；`SiteHeader` 加 `member={member}`。

`SiteFooter.tsx` 底栏：

```tsx
<div className="site-footer__bar-inner">
  <span>© {year} {settings.copyrightHolder}</span>
  <span>{cityName ? `${cityName} · ` : ''}{settings.footerTaglineSuffix}</span>
  {/* OPT-088：员工入口放页脚不放顶栏——公开访客用不到，不该占首屏动作区 */}
  <a href="/admin/login" rel="nofollow" className="site-footer__staff-link">员工入口</a>
</div>
```

- [ ] **Step 7: 写 `styles/member.css`**

```css
/* OPT-088 会员入口与账户页。只用 styles.css §1.1 的 token；容器与断点沿用全站规则。 */

.member-menu-slot { display: none; }
@media (min-width: 1024px) {
  .member-menu-slot { display: inline-flex; align-items: center; }
}

.member-login { min-height: 36px; white-space: nowrap; }

.member-menu { position: relative; }
.member-menu__trigger {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border: 1px solid var(--line); border-radius: var(--r-pill);
  background: var(--bg-subtle); color: var(--ink); cursor: pointer; font-size: var(--fs-13); font-weight: 600;
}
.member-menu__trigger:focus-visible { outline: none; box-shadow: var(--shadow-focus); }
.member-menu__panel {
  position: absolute; right: 0; top: calc(100% + 8px); min-width: 200px;
  background: var(--bg-subtle); border-radius: var(--r-card); box-shadow: var(--shadow-hover);
  padding: var(--sp-2) 0; z-index: 40;
  animation: member-menu-in 200ms var(--ease-enter);
}
@keyframes member-menu-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .member-menu__panel { animation: none; } }
.member-menu__phone { margin: 0; padding: var(--sp-2) var(--sp-4); font-size: var(--fs-13); color: var(--ink-2); }
.member-menu__item {
  display: block; width: 100%; text-align: left; padding: var(--sp-3) var(--sp-4);
  min-height: 44px; font-size: var(--fs-14); color: var(--ink); background: transparent; border: 0; cursor: pointer; text-decoration: none;
}
.member-menu__item:hover, .member-menu__item:focus-visible { background: var(--bg); outline: none; }
.member-menu__item--danger { color: var(--accent-link); }

.member-drawer { display: flex; flex-direction: column; padding-bottom: var(--sp-3); border-bottom: 1px solid var(--line); margin-bottom: var(--sp-3); }
.member-drawer__phone { margin: 0 0 var(--sp-2); font-size: var(--fs-13); color: var(--ink-2); }
.member-drawer__logout { text-align: left; background: transparent; border: 0; cursor: pointer; }

.site-footer__staff-link { margin-left: auto; color: inherit; text-decoration: none; }
.site-footer__staff-link:hover { text-decoration: underline; }

/* 账户与登录页 */
.mb-page { width: min(var(--w), 100% - 32px); margin: 0 auto; padding: var(--pad) 0; }
.mb-card { max-width: 440px; margin: 0 auto; padding: 32px; background: var(--bg-subtle); border-radius: var(--r-card); }
.mb-card--wide { max-width: none; }
.mb-title { margin: 0 0 var(--sp-4); font-size: var(--fs-24); font-weight: 600; letter-spacing: normal; }
.mb-tabs { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
.mb-tab { flex: 1; min-height: 44px; border: 1px solid var(--line); border-radius: var(--r-pill); background: transparent; color: var(--ink-2); cursor: pointer; font-size: var(--fs-14); }
.mb-tab[aria-selected='true'] { background: var(--ink); color: var(--on-ink, #f5f5f7); border-color: var(--ink); }
.mb-form { display: flex; flex-direction: column; gap: var(--sp-4); }
.mb-row { display: flex; gap: var(--sp-2); align-items: flex-end; }
.mb-row .modal__label { flex: 1; }
.mb-consent { display: flex; gap: var(--sp-2); align-items: flex-start; font-size: var(--fs-13); color: var(--ink-2); }
.mb-consent input { width: 18px; height: 18px; margin-top: 2px; }
.mb-note { margin: var(--sp-4) 0 0; font-size: var(--fs-13); color: var(--ink-2); text-align: center; }
.mb-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.mb-item { display: flex; flex-direction: column; gap: var(--sp-2); padding: 16px; }
.mb-item__title { font-size: var(--fs-16); font-weight: 600; color: var(--ink); text-decoration: none; }
.mb-item__meta { font-size: var(--fs-13); color: var(--ink-2); }
.mb-tag { display: inline-block; padding: 2px 8px; border-radius: var(--r-pill); background: var(--bg); font-size: var(--fs-12); color: var(--ink-2); }
.mb-empty { text-align: center; color: var(--ink-2); padding: var(--pad) 0; }
@media (max-width: 767px) { .mb-card { padding: 20px; } }
```

若某个 token 名（`--on-ink`、`--fs-24`、`--fs-12`、`--shadow-focus`、`--line`）在 `styles.css` §1.1 里不存在，用 `rg -n "^\s+--fs-|^\s+--line|^\s+--shadow" src/app/\(frontend\)/styles.css` 查出实际名称替换，不要新造 token。

- [ ] **Step 8: 更新既有测试**

`tests/frontend-shell-hydration.test.ts` 与 `tests/city-switcher.test.ts` 在现有 `vi.mock` 之后各加：

```ts
vi.mock('@/domain/member/current-member', () => ({
  getCurrentMember: async () => null,
  getCurrentMemberDto: async () => null,
}))
```

hydration 用例追加断言：`expect(html).toContain('member-login')`（未登录桌面态渲染了登录链接）、`expect(html).toContain('员工入口')`（页脚，若该用例也渲染 SiteFooter）。

- [ ] **Step 9: 验证**

```bash
pnpm exec vitest run tests/member-menu.test.ts tests/frontend-shell-hydration.test.ts tests/city-switcher.test.ts tests/site-nav-current.test.ts
pnpm typecheck
pnpm lint
```

预期：PASS。

- [ ] **Step 10: 提交**

```bash
git add src/components/frontend/member "src/app/(frontend)/styles/member.css" src/components/frontend/SiteHeader.tsx src/components/frontend/SiteNav.tsx src/components/frontend/SiteFooter.tsx "src/app/(frontend)/layout.tsx" src/lib/frontend/saved-details.ts tests/member-menu.test.ts tests/frontend-shell-hydration.test.ts tests/city-switcher.test.ts
git commit -m "feat(frontend): 顶栏与抽屉的登录入口、会员上下文、页脚员工入口（OPT-088）"
```

---

### Task 10：登录页、账户页、收藏页与收藏按钮联动

**Files:**
- Create: `src/app/(frontend)/login/page.tsx`、`src/app/(frontend)/login/reset/page.tsx`、`src/app/(frontend)/account/page.tsx`、`src/app/(frontend)/account/favorites/page.tsx`
- Create: `src/components/frontend/member/LoginForm.tsx`、`src/components/frontend/member/SmsCodeField.tsx`、`src/components/frontend/member/PasswordResetForm.tsx`、`src/components/frontend/member/AccountSettings.tsx`、`src/components/frontend/member/FavoriteRemoveButton.tsx`
- Create: `src/domain/member/return-to.ts`
- Modify: `src/components/frontend/ShareSaveActions.tsx`（会员分支）
- Test: `tests/member-return-to.test.ts`

**Interfaces:**
- Produces：`export function safeReturnTo(value: unknown, fallback?: string): string`（站内路径才接受：以 `/` 开头、不以 `//` 开头、不含 `\`；否则回落 `/account`）。

- [ ] **Step 1: 写失败测试** `tests/member-return-to.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '@/domain/member/return-to'

describe('safeReturnTo', () => {
  it('只接受站内路径', () => {
    expect(safeReturnTo('/listings?type=coworking')).toBe('/listings?type=coworking')
    expect(safeReturnTo('//evil.example')).toBe('/account')
    expect(safeReturnTo('https://evil.example')).toBe('/account')
    expect(safeReturnTo('/\\evil')).toBe('/account')
    expect(safeReturnTo(undefined)).toBe('/account')
    expect(safeReturnTo('/x', '/')).toBe('/x')
    expect(safeReturnTo(null, '/')).toBe('/')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**，然后写 `src/domain/member/return-to.ts`：

```ts
/** 登录后回跳只认站内路径（OPT-088 §8.3）：开放重定向是登录页最常见的漏洞。 */
export function safeReturnTo(value: unknown, fallback = '/account'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  if (value.length > 500) return fallback
  return value
}
```

- [ ] **Step 3: 写表单基元 `SmsCodeField.tsx`**

```tsx
'use client'

import React, { useEffect, useState } from 'react'
import { memberPost } from './member-api'

/** 验证码输入 + 60 秒倒计时发送按钮。发送恒返回 200，不据此判断号码是否已注册。 */
export default function SmsCodeField({ phone, purpose, code, onCodeChange, idPrefix }: Readonly<{
  phone: string
  purpose: 'login' | 'set-password' | 'bind-wechat'
  code: string
  onCodeChange: (v: string) => void
  idPrefix: string
}>) {
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (seconds <= 0) return
    const t = window.setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [seconds])

  const send = async () => {
    setError(null)
    const result = await memberPost('/api/member/sms/send', { phone, purpose })
    if (!result.ok) { setError(result.message); return }
    setSeconds(60)
  }

  const phoneReady = /^1[3-9]\d{9}$/.test(phone.replace(/[\s-]/g, ''))

  return (
    <div className="mb-row">
      <label className="modal__label" htmlFor={`${idPrefix}-code`}>
        验证码
        <input id={`${idPrefix}-code`} className="modal__input" value={code} onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
      </label>
      <button type="button" className="btn btn--ghost" onClick={send} disabled={!phoneReady || seconds > 0}>
        {seconds > 0 ? `${seconds} 秒后重发` : '获取验证码'}
      </button>
      {error ? <p className="modal__error" role="alert">{error}</p> : null}
    </div>
  )
}
```

- [ ] **Step 4: 写 `LoginForm.tsx`**

```tsx
'use client'

import Link from 'next/link'
import React, { useState } from 'react'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import SmsCodeField from './SmsCodeField'
import { memberPost } from './member-api'

type Tab = 'sms' | 'password'

/** /login 的两个 tab（OPT-088 §8.3）。成功后整页跳转 returnTo，让服务端重新渲染登录态。 */
export default function LoginForm({ returnTo }: Readonly<{ returnTo: string }>) {
  const [tab, setTab] = useState<Tab>('sms')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const result = tab === 'sms'
      ? await memberPost('/api/member/login/sms', { phone, code, consent: consent ? { accepted: true, policyVersion: PRIVACY_POLICY_VERSION } : null })
      : await memberPost('/api/member/login/password', { phone, password })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    window.location.assign(returnTo)
  }

  return (
    <div className="mb-card">
      <h1 className="mb-title">登录</h1>
      <div className="mb-tabs" role="tablist" aria-label="登录方式">
        <button type="button" role="tab" className="mb-tab" aria-selected={tab === 'sms'} onClick={() => setTab('sms')}>验证码登录</button>
        <button type="button" role="tab" className="mb-tab" aria-selected={tab === 'password'} onClick={() => setTab('password')}>密码登录</button>
      </div>
      <form className="mb-form" onSubmit={submit} noValidate>
        <label className="modal__label" htmlFor="login-phone">
          手机号
          <input id="login-phone" className="modal__input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={20} required />
        </label>
        {tab === 'sms' ? (
          <>
            <SmsCodeField phone={phone} purpose="login" code={code} onCodeChange={setCode} idPrefix="login" />
            <label className="mb-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>我已阅读并同意<Link href="/pages/privacy" target="_blank" rel="noopener">隐私政策</Link>；首次登录即注册</span>
            </label>
          </>
        ) : (
          <label className="modal__label" htmlFor="login-password">
            密码
            <input id="login-password" className="modal__input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={64} required />
          </label>
        )}
        {error ? <p className="modal__error" role="alert" aria-live="polite">{error}</p> : null}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{busy ? '正在登录…' : '登录'}</button>
      </form>
      {tab === 'password' ? <p className="mb-note"><Link href="/login/reset">忘记密码</Link></p> : null}
      <p className="mb-note">员工请从<a href="/admin/login" rel="nofollow">员工入口</a>登录</p>
    </div>
  )
}
```

- [ ] **Step 5: 写 `PasswordResetForm.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import SmsCodeField from './SmsCodeField'
import { memberPost } from './member-api'

/** 设置 / 找回密码（OPT-088 §6.4）。initialPhone 给已登录的账户中心用；未登录时用户自填。 */
export default function PasswordResetForm({ initialPhone, phoneLocked, onDone, submitLabel }: Readonly<{
  initialPhone?: string
  phoneLocked?: boolean
  onDone: () => void
  submitLabel: string
}>) {
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(newPassword)) { setError('密码需 8 到 64 位，且同时包含字母和数字'); return }
    setBusy(true)
    const result = await memberPost('/api/member/password', { phone, code, newPassword })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    onDone()
  }

  return (
    <form className="mb-form" onSubmit={submit} noValidate>
      <label className="modal__label" htmlFor="reset-phone">
        手机号
        <input id="reset-phone" className="modal__input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={20} readOnly={phoneLocked} required />
      </label>
      <SmsCodeField phone={phone} purpose="set-password" code={code} onCodeChange={setCode} idPrefix="reset" />
      <label className="modal__label" htmlFor="reset-password">
        新密码
        <input id="reset-password" className="modal__input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" maxLength={64} required />
      </label>
      {error ? <p className="modal__error" role="alert" aria-live="polite">{error}</p> : null}
      <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{busy ? '提交中…' : submitLabel}</button>
    </form>
  )
}
```

已登录账户中心传的 `initialPhone` 是**完整手机号吗**？不是——DTO 只有脱敏值。账户中心的表单让手机号字段只读显示脱敏值，但提交要完整号：改为在 `AccountSettings` 里**不传 initialPhone、不锁定**，由用户自己输入本机号（服务端会按 code 所属号码校验，填错号码只会得到验证码错误）。这是刻意取舍：DTO 不带完整手机号比少填一次号更重要。

- [ ] **Step 6: 写 `AccountSettings.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import type { MemberDto } from '@/domain/member/member-dto'
import PasswordResetForm from './PasswordResetForm'
import { memberPost } from './member-api'
import { useMember } from './MemberProvider'

export default function AccountSettings({ member }: Readonly<{ member: MemberDto }>) {
  const { logout } = useMember()
  const [nickname, setNickname] = useState(member.nickname ?? '')
  const [nickMsg, setNickMsg] = useState<string | null>(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [pwDone, setPwDone] = useState(false)

  const saveNickname = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await memberPost('/api/member/profile', { nickname }, 'PATCH')
    setNickMsg(result.ok ? '已保存' : result.message)
  }

  return (
    <div className="mb-card">
      <h1 className="mb-title">账号设置</h1>
      <p className="mb-item__meta">手机号 {member.phoneMasked}</p>
      <form className="mb-form" onSubmit={saveNickname} noValidate>
        <label className="modal__label" htmlFor="acct-nickname">
          昵称
          <input id="acct-nickname" className="modal__input" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={30} />
        </label>
        {nickMsg ? <p className="mb-item__meta" role="status" aria-live="polite">{nickMsg}</p> : null}
        <button type="submit" className="btn btn--ghost">保存昵称</button>
      </form>
      <hr />
      <h2 className="mb-title">{member.hasPassword ? '修改密码' : '设置密码'}</h2>
      {pwDone ? <p className="mb-item__meta" role="status">密码已更新，其它设备已下线</p> : null}
      {pwOpen ? (
        <PasswordResetForm submitLabel={member.hasPassword ? '修改密码' : '设置密码'} onDone={() => { setPwOpen(false); setPwDone(true) }} />
      ) : (
        <button type="button" className="btn btn--ghost" onClick={() => setPwOpen(true)}>{member.hasPassword ? '修改密码' : '设置密码'}</button>
      )}
      <hr />
      <button type="button" className="btn btn--ghost btn--block" onClick={() => { void logout() }}>退出登录</button>
    </div>
  )
}
```

- [ ] **Step 7: 写四个页面**

`src/app/(frontend)/login/page.tsx`：

```tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import LoginForm from '@/components/frontend/member/LoginForm'
import { getCurrentMember } from '@/domain/member/current-member'
import { safeReturnTo } from '@/domain/member/return-to'
import { buildPageMetadata } from '@/lib/frontend/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({ title: '登录', canonicalPath: '/login', robots: 'noindex' })
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams
  const target = safeReturnTo(returnTo, '/account')
  if (await getCurrentMember()) redirect(target)
  return (
    <div className="mb-page">
      <LoginForm returnTo={target} />
    </div>
  )
}
```

`src/app/(frontend)/login/reset/page.tsx`：

```tsx
import type { Metadata } from 'next'
import ResetClient from '@/components/frontend/member/ResetClient'
import { buildPageMetadata } from '@/lib/frontend/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({ title: '找回密码', canonicalPath: '/login/reset', robots: 'noindex' })
}

export default function ResetPage() {
  return (
    <div className="mb-page">
      <div className="mb-card">
        <h1 className="mb-title">找回 / 设置密码</h1>
        <p className="mb-item__meta">仅限已注册手机号；未注册请先用验证码登录。</p>
        <ResetClient />
      </div>
    </div>
  )
}
```

`src/components/frontend/member/ResetClient.tsx`：

```tsx
'use client'

import React from 'react'
import PasswordResetForm from './PasswordResetForm'

export default function ResetClient() {
  return <PasswordResetForm submitLabel="设置密码并登录" onDone={() => { window.location.assign('/account') }} />
}
```

`src/app/(frontend)/account/page.tsx`：

```tsx
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import AccountSettings from '@/components/frontend/member/AccountSettings'
import { getCurrentMemberDto } from '@/domain/member/current-member'
import { buildPageMetadata } from '@/lib/frontend/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({ title: '账号设置', canonicalPath: '/account', robots: 'noindex' })
}

export default async function AccountPage() {
  const member = await getCurrentMemberDto()
  if (!member) redirect('/login?returnTo=%2Faccount')
  return (
    <div className="mb-page">
      <AccountSettings member={member} />
    </div>
  )
}
```

`src/app/(frontend)/account/favorites/page.tsx`：

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import FavoriteRemoveButton from '@/components/frontend/member/FavoriteRemoveButton'
import { cityAwareHref } from '@/components/frontend/CitySwitcher'
import { getCurrentMember } from '@/domain/member/current-member'
import { listFavorites, type FavoriteItem } from '@/domain/member/favorites'
import {
  assertEffectiveBuilding, assertEffectiveListing, resolveBuildingRouteIdentity, resolveListingRouteIdentity,
} from '@/domain/public-catalog'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({ title: '我的收藏', canonicalPath: '/account/favorites', robots: 'noindex' })
}

type Row = { item: FavoriteItem; href: string | null }

/** 仍在有效供给内才给链接；判据复用统一供给服务（母文档 §9）。 */
async function resolveRow(item: FavoriteItem, multiCity: boolean): Promise<Row> {
  const ctx = { asOf: new Date().toISOString(), timezone: 'Asia/Shanghai' as const, channel: 'public-web' as const, city: '' }
  if (item.type === 'listing') {
    const identity = await resolveListingRouteIdentity(item.slug)
    if (!identity) return { item, href: null }
    const effective = await assertEffectiveListing(item.slug, { ...ctx, city: identity.citySlug })
    return { item, href: effective ? cityAwareHref(`/listings/${item.slug}`, identity.citySlug, multiCity) : null }
  }
  const identity = await resolveBuildingRouteIdentity(item.slug)
  if (!identity) return { item, href: null }
  const effective = await assertEffectiveBuilding(item.slug, { ...ctx, city: identity.citySlug })
  return { item, href: effective ? cityAwareHref(`/buildings/${item.slug}`, identity.citySlug, multiCity) : null }
}

export default async function FavoritesPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/login?returnTo=%2Faccount%2Ffavorites')
  const payload = await getPayload({ config })
  const items = await listFavorites(payload, member.id)
  const multiCity = getMultiCityRoutingEnabled()
  const rows = await Promise.all(items.map((item) => resolveRow(item, multiCity)))

  return (
    <div className="mb-page">
      <div className="mb-card mb-card--wide">
        <h1 className="mb-title">我的收藏</h1>
        {rows.length === 0 ? (
          <p className="mb-empty">还没有收藏。去<Link href="/listings">找办公室</Link>看看吧</p>
        ) : (
          <ul className="mb-list">
            {rows.map(({ item, href }) => (
              <li key={`${item.type}:${item.id}`} className="sf-card mb-item">
                {href ? <Link href={href} className="mb-item__title">{item.title}</Link> : <span className="mb-item__title">{item.title}</span>}
                <span className="mb-item__meta">
                  {item.type === 'listing' ? '房源' : '楼盘'} · 收藏于 {new Date(item.savedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                  {href ? null : <> · <span className="mb-tag">已下架</span></>}
                </span>
                <FavoriteRemoveButton type={item.type} id={item.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

`SearchContext` 若还有本页没列的必填字段，按 `src/domain/public-catalog/types.ts:101` 补齐，不要用 `as`。

`src/components/frontend/member/FavoriteRemoveButton.tsx`：

```tsx
'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FavoriteType } from '@/domain/member/favorites'
import { useMember } from './MemberProvider'

export default function FavoriteRemoveButton({ type, id }: Readonly<{ type: FavoriteType; id: number }>) {
  const { removeFavorite } = useMember()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { const err = await removeFavorite({ type, id }); if (err) setError(err); else router.refresh() }}>移除</button>
      {error ? <span className="modal__error" role="alert">{error}</span> : null}
    </>
  )
}
```

- [ ] **Step 8: `ShareSaveActions.tsx` 加会员分支**

在文件顶部 import：`import { useMember } from '@/components/frontend/member/MemberProvider'`。组件内：

```tsx
const { member, isFavorite, addFavorite, removeFavorite, favoritesReady } = useMember()
const memberSaved = member ? isFavorite(savedDetail.type, savedDetail.id) : false
const [memberError, setMemberError] = useState<string | null>(null)
const effectiveSaved = member ? memberSaved : saved
const canToggle = member ? favoritesReady : lsAvailable

const handleToggleSave = async () => {
  if (member) {
    setMemberError(null)
    const err = effectiveSaved
      ? await removeFavorite({ type: savedDetail.type, id: savedDetail.id })
      : await addFavorite({ type: savedDetail.type, id: savedDetail.id, slug: savedDetail.slug })
    if (err) setMemberError(err)
    return
  }
  if (!lsAvailable) return
  if (saved) removeDetail(savedDetail.type, savedDetail.id)
  else saveDetail({ type: savedDetail.type, id: savedDetail.id, slug: savedDetail.slug, savedAt: new Date().toISOString() })
}
```

收藏按钮改用 `effectiveSaved` / `canToggle`；`!lsAvailable` 的提示只在 `!member` 时渲染；新增 `memberError` 的 `<span className="share-save-actions__hint" role="alert">`。原 localStorage 分支代码一行不删。

- [ ] **Step 9: 验证**

```bash
pnpm exec vitest run tests/member-return-to.test.ts tests/share-save-actions.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

预期：PASS，`next build` 成功（`tests/share-save-actions.test.ts` 若不存在则略过；若存在且渲染组件，需在其顶部 mock `@/components/frontend/member/MemberProvider` 的 `useMember` 返回 `member: null`）。

- [ ] **Step 10: 提交**

```bash
git add "src/app/(frontend)/login" "src/app/(frontend)/account" src/components/frontend/member src/domain/member/return-to.ts src/components/frontend/ShareSaveActions.tsx tests/member-return-to.test.ts
git commit -m "feat(frontend): 登录页、账号设置、收藏页与收藏按钮的会员分支（OPT-088）"
```

### Task 11：seed 夹具、CI 环境变量、E2E

**Files:**
- Modify: `scripts/seed.ts`（E2E 用户块之后追加会员夹具）
- Modify: `../.github/workflows/quality.yml`（E2E 作业 `env` 加 `SMS_PROVIDER: fixture`）
- Create: `tests/e2e/member-auth.spec.ts`

**Interfaces:**
- 夹具会员：手机号 `13800009999`、密码 `Member1234!`、昵称 `E2E 会员`、`hasPassword: true`。E2E 里注册新号用 `13800008888`（每次跑前由 spec 自己清理不掉，所以「首次注册」用例先尝试登录，若已存在则断言 `isNew=false` 也算通过）。

- [ ] **Step 1: seed 追加会员夹具**（放在 `E2E 用户 ... 创建完成` 那个循环之后）

```ts
  // === OPT-088：E2E 会员夹具（前台登录用；生产不跑 seed）===
  const e2eMemberPhone = '13800009999'
  const existingMember = await payload.find({
    collection: 'members',
    where: { username: { equals: e2eMemberPhone } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existingMember.docs[0]) {
    await payload.update({
      collection: 'members',
      id: existingMember.docs[0].id,
      data: { status: 'active', hasPassword: true, password: 'Member1234!' },
      overrideAccess: true,
      context: { memberFlow: 'seed' },
    })
    payload.logger.info('E2E 会员已存在，已重置密码与状态')
  } else {
    await payload.create({
      collection: 'members',
      data: {
        username: e2eMemberPhone,
        password: 'Member1234!',
        nickname: 'E2E 会员',
        hasPassword: true,
        status: 'active',
        consentPolicyVersion: 'MVP-R2',
        consentAcceptedAt: new Date().toISOString(),
      },
      overrideAccess: true,
      context: { memberFlow: 'seed' },
    })
    payload.logger.info('E2E 会员创建完成')
  }
```

`consentPolicyVersion` 用 `PRIVACY_POLICY_VERSION` 常量更好：文件顶部 `import { PRIVACY_POLICY_VERSION } from '../src/lib/frontend/site-config'`，把字面量换掉。

- [ ] **Step 2: quality.yml**

E2E 作业（`Run E2E against next start` 所在 job）的 `env:` 块（约第 115 行）追加一行：

```yaml
      # OPT-088：会员验证码 E2E 用固定码 123456；生产 config-guard 拒绝该取值，只在 CI/本地用
      SMS_PROVIDER: fixture
```

`Run multi-city E2E` 那一步的 `env` 不需要（它只跑三个多城市 spec）。

- [ ] **Step 3: 写 `tests/e2e/member-auth.spec.ts`**

```ts
/**
 * OPT-088 会员登录 E2E。前置：pnpm seed（会员夹具 13800009999 / Member1234!）、SMS_PROVIDER=fixture。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const BASE = (process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3717}`).replace(/\/$/, '')
const ORIGIN_HEADERS = { origin: BASE, 'content-type': 'application/json' }
const FIXTURE_CODE = '123456'
const SEEDED = { phone: '13800009999', password: 'Member1234!' }
const NEW_PHONE = '13800008888'

async function post(request: APIRequestContext, path: string, data: unknown) {
  return request.post(`${BASE}${path}`, { data, headers: ORIGIN_HEADERS, failOnStatusCode: false })
}

test.describe('Payload 自带的会员 auth 端点已封', () => {
  for (const p of ['login', 'logout', 'refresh-token', 'me', 'first-register', 'forgot-password', 'reset-password', 'unlock']) {
    test(`POST /api/members/${p} → 404`, async ({ request }) => {
      const res = await post(request, `/api/members/${p}`, {})
      expect(res.status()).toBe(404)
    })
  }
  test('匿名 POST /api/members 被拒', async ({ request }) => {
    const res = await post(request, '/api/members', { username: '13800007777', password: 'Whatever123' })
    expect([401, 403]).toContain(res.status())
  })
})

test.describe('验证码登录', () => {
  test('未勾同意 → CONSENT_REQUIRED；勾选后登录并进入账户页', async ({ page, request }) => {
    const send = await post(request, '/api/member/sms/send', { phone: NEW_PHONE, purpose: 'login' })
    expect(send.status()).toBe(200)
    const noConsent = await post(request, '/api/member/login/sms', { phone: NEW_PHONE, code: FIXTURE_CODE, consent: null })
    // 号码若已被上次运行注册，则不需要同意，直接 200
    expect([200, 400]).toContain(noConsent.status())
    if (noConsent.status() === 400) {
      expect((await noConsent.json()).code).toBe('CONSENT_REQUIRED')
    }

    await page.goto('/login?returnTo=%2Faccount')
    await page.getByLabel('手机号').fill(NEW_PHONE)
    await page.getByRole('button', { name: '获取验证码' }).click()
    await page.getByLabel('验证码').fill(FIXTURE_CODE)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForURL('**/account')
    await expect(page.getByRole('heading', { name: '账号设置' })).toBeVisible()
    await expect(page.getByRole('button', { name: '账号菜单' })).toBeVisible()
  })

  test('60 秒内重复发码 → 429', async ({ request }) => {
    await post(request, '/api/member/sms/send', { phone: '13800006666', purpose: 'login' })
    const again = await post(request, '/api/member/sms/send', { phone: '13800006666', purpose: 'login' })
    expect(again.status()).toBe(429)
    expect(again.headers()['retry-after']).toBeTruthy()
  })
})

test.describe('密码登录与会话', () => {
  async function loginByPassword(page: Page) {
    await page.goto('/login')
    await page.getByRole('tab', { name: '密码登录' }).click()
    await page.getByLabel('手机号').fill(SEEDED.phone)
    await page.getByLabel('密码').fill(SEEDED.password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.waitForURL('**/account')
  }

  test('错密码统一文案；对密码登录；退出后 me 为 null', async ({ page, request }) => {
    const bad = await post(request, '/api/member/login/password', { phone: SEEDED.phone, password: 'nope-nope-1' })
    expect(bad.status()).toBe(401)
    expect((await bad.json()).message).toBe('手机号或密码错误')

    await loginByPassword(page)
    const me = await page.request.get(`${BASE}/api/member/me`)
    expect((await me.json()).member.phoneMasked).toBe('138****9999')

    await page.getByRole('button', { name: '退出登录' }).click()
    await page.waitForURL(`${BASE}/`)
    const after = await page.request.get(`${BASE}/api/member/me`)
    expect((await after.json()).member).toBeNull()
  })

  test('未登录访问账户页跳登录并带 returnTo', async ({ page }) => {
    await page.goto('/account/favorites')
    await expect(page).toHaveURL(/\/login\?returnTo=%2Faccount%2Ffavorites$/)
  })

  test('页脚员工入口指向后台登录', async ({ page }) => {
    await page.goto('/')
    const link = page.getByRole('link', { name: '员工入口' })
    await expect(link).toHaveAttribute('href', '/admin/login')
    await expect(link).toHaveAttribute('rel', 'nofollow')
  })

  test('本地收藏在登录后合并到账号', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      window.localStorage.setItem('sbh:saved-details:v1', JSON.stringify([
        { type: 'building', id: 1, slug: 'placeholder', savedAt: new Date().toISOString() },
      ]))
    })
    await loginByPassword(page)
    await page.goto('/account/favorites')
    // id=1 的楼盘在 seed 库里存在则出现一条；不存在会被合并跳过 → 空态。两种都断言 localStorage 已清空。
    await expect(page.getByRole('heading', { name: '我的收藏' })).toBeVisible()
    const local = await page.evaluate(() => window.localStorage.getItem('sbh:saved-details:v1'))
    expect(local).toBeNull()
  })
})
```

`placeholder` slug 与 `id: 1`：seed 里第一条楼盘的 id 通常是 1，但 slug 不是 placeholder；合并时服务端按 id 读标题、按 slug 存链接，链接可能 404 但本用例不点它。若想断言真出现一条，先 `GET /api/buildings?limit=1` 拿真实 `id`/`slug` 再写入 localStorage。

- [ ] **Step 4: 本地跑 CI 等价 E2E（按 `.agent/testing.md`「CI 等价」段）**

```bash
cd E:/wt-088/payload-office-platform
pnpm seed
CI=1 NEXT_PUBLIC_SITE_URL=https://sbh-e2e.example.com MULTI_CITY_ROUTING_ENABLED=false SMS_PROVIDER=fixture pnpm build
CI=1 MULTI_CITY_ROUTING_ENABLED=false SMS_PROVIDER=fixture PORT=3722 pnpm exec next start -p 3722 &
sleep 8 && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3722/login
E2E_PROD_SERVER=1 PORT=3722 MULTI_CITY_ROUTING_ENABLED=false pnpm exec playwright test tests/e2e/member-auth.spec.ts
```

预期：`/login` 200；spec 全绿。跑完 `kill` 掉 3722 的 server。会员路由的同源校验是 `isSameOriginHost`（Origin 与 Host 自洽即可），所以 `next start` 下 `http://localhost:3722` 自然通过，不需要为 CI 放宽任何东西。

- [ ] **Step 5: 提交**

```bash
git add scripts/seed.ts ../.github/workflows/quality.yml tests/e2e/member-auth.spec.ts
git commit -m "test(members): 会员 seed 夹具、CI fixture 短信与登录 E2E（OPT-088）"
```

---

### Task 12：全量闸门、证据、交付

**Files:**
- Create: `../artifacts/verification/OPT-088/README.md`（证据索引）
- Modify: `../specs/work-items/OPT-088-member-auth-foundation.md`（勾选已完成的验收项）

- [ ] **Step 1: 全量闸门**

```bash
cd E:/wt-088/payload-office-platform
pnpm generate:types && pnpm payload generate:importmap
git status --short src/app/(payload)/admin/importMap.js   # 应无变化（本期没注册后台组件）
pnpm typecheck && pnpm lint && pnpm test
pnpm migrate:dry-run
pnpm build
```

预期：全部通过；`pnpm test` 含 T1–T10 全部新测试与既有 3800+ 用例。

- [ ] **Step 2: 生产守卫自检**

```bash
pnpm exec vitest run tests/member-sms-provider.test.ts tests/config-guard.test.ts
```

「生产拒绝 `console` / `fixture`、`tencent` 缺凭据拒绝」已由这两个测试锁定，不必手工起生产进程验证。

- [ ] **Step 3: 写证据索引** `../artifacts/verification/OPT-088/README.md`

```markdown
# OPT-088 验证证据

- migrate-dry-run.txt：两条迁移的 dry-run 输出（Task 3）
- pg-structure.txt：`\d members`、`\d member_sms_codes`、`\d member_favorites`、`\d members_sessions`（本地 PG）
- e2e-member-auth.txt：`playwright test tests/e2e/member-auth.spec.ts` 的 list 报告
- gates.txt：typecheck / lint / test / build 的末尾摘要
- 浏览器走查（控制者补）：screens/ 下四断点截图；payloads/ 下登录与设密码的 Request Payload 与响应
```

用 `psql "$DATABASE_URL" -c '\d members'` 等命令把结构输出存进 `pg-structure.txt`。

- [ ] **Step 4: 回写 Task Packet**

在 `OPT-088-member-auth-foundation.md` §5 里只勾选**已由本地闸门、单测、E2E 证明**的项；浏览器走查相关（四断点截图、三重铁证、后台会员页深浅色）留给控制者，不勾。

- [ ] **Step 5: 提交并停下**

```bash
git add ../artifacts/verification/OPT-088 ../specs/work-items/OPT-088-member-auth-foundation.md
git commit -m "docs(opt-088): 验证证据索引与 Task Packet 回写"
git log --oneline origin/master..HEAD
```

**不要 push、不要开 PR、不要合并**：合并到 master 即上线。把 `git log` 输出、未勾选的验收项、任何跳过的步骤如实报告给控制者，由控制者做浏览器走查后决定推送。

---

## 自审记录（写计划时逐条对照母文档）

| 母文档要求 | 对应任务 |
|---|---|
| §3.2 全部 088 模块 | T1–T10 文件结构表逐一对应 |
| §4.1–4.3 字段、`targetKey`、null 不写空串 | T3 集合定义；`wechatUnionId` 仅在 089 写入，本期恒 null |
| §4.5 权限码、夹具、迁移、导航 | T2、T3 Step 7 |
| §5 cookie / claims / 校验步骤 / 撤销 / 30 天 | T6 |
| §6.1 四条限流与 fail 策略 | T5 rate-limits + T7 `checkRateLimit` |
| §6.2 短信恒 200、无适配器 503、三种 provider、模板占位 | T5、T7 |
| §6.3 短信登录、同意、密码登录统一文案、me、logout | T7 |
| §6.4 密码规则、只留当前 sid、忘记密码同入口 | T7 `setPasswordWithSms`、T10 `/login/reset` |
| §6.5 收藏四个端点、200 上限、合并裁剪 | T8 |
| §6.5.1 资料 | T7 profile 路由 |
| §7.1 REST 封口、graphQL false | T4、T3 |
| §7.2 access 矩阵、§7.3 钩子 | T3 |
| §7.4 全后台守卫、公开读白名单 | T3 Step 9–10 |
| §8.1 顶栏 / 抽屉、§8.2 页脚 | T9 |
| §8.3 四个页面、noindex、returnTo 校验 | T10 |
| §8.4 视觉基元、44px、reduced-motion | T9 member.css、T10 表单 |
| §9 收藏同步与合并、本地清空 | T9 MemberProvider、T10 ShareSaveActions |
| §11 环境变量与 config-guard | T5 |
| §12.1 单测清单 | T1–T10 各自 Step 1；`member-routes.test.ts` 由 `member-http.test.ts` + `member-service.test.ts` 覆盖 |
| §12.2 E2E | T11 |
| §13.1 验收 | T12 回写 |

已知未闭合项（交给控制者）：
1. `tencentcloud-sdk-nodejs-sms` 的导出形态以安装版本的 `.d.ts` 为准（T5 Step 4 已写明查法）；真实发送只能在生产配好凭据后验证。
2. `SearchContext` 已核对：`asOf` / `timezone` / `channel` / `city` 必填，`businessType` 可选，T10 收藏页的写法与之一致。
3. 浏览器走查、四断点截图、三重铁证、后台会员页深浅色由控制者完成后再决定推送。

<!-- END -->
