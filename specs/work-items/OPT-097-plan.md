# OPT-097 页脚 ICP 备案号 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「站点设置 → 页脚」新增「ICP 备案号」字段，C 端页脚底栏在版权后渲染为指向 `https://beian.miit.gov.cn/` 的链接；留空不渲染；格式错误保存被拒。规格：`specs/work-items/OPT-097-footer-icp-record.md`。

**Architecture:** 一个零依赖纯函数 `normalizeIcpRecordNumber` 同时给后台字段 `validate` 与前台 `toView` 映射用（口径只有一份）。Global 加一个 text 字段 + 一条只加列的迁移；`SiteSettingsView` 加 `icpRecordNumber: string | null`；`SiteFooter` 底栏按 null 与否条件渲染 `<a>`。

**Tech Stack:** Next.js 16 / React 19 / Payload 3.86（postgres adapter）/ Vitest 4 / Playwright / pnpm。工作树 `E:\wt-097`，分支 `feat/opt-097-footer-icp-record-a26d`（基于 `origin/master` 73f1643），dev 端口 **3729**，任务库 `sbh_dev_097`（Task 1 从夹具库 `postgres` 克隆）。

## Global Constraints

- 所有命令在 `E:\wt-097\payload-office-platform` 下用 **pnpm**。
- 禁止 `any` / `as any` / `@ts-ignore`；外部输入 `unknown` 收窄。
- 提交只用**显式** `git add <路径>`；提交信息简体中文、类型前缀；**不加署名行**。
- `src/payload-types.ts` 生成物不入库；改 `SiteSettings.ts` 后必须 `pnpm generate:types`（生成后 `grep -c "prefix" src/payload-types.ts` 必须是 2——类型文件里是 `prefix?:`，不带引号）。迁移 `.ts` + `.json` 成对入库，`src/migrations/index.ts` 由 `migrate:create` 自动更新。
- 备案链接固定 `https://beian.miit.gov.cn/`；字段名 `icpRecordNumber`；列名 `icp_record_number`；页脚节点 class `site-footer__icp`。
- **不做**：公安备案号、链接地址可配、按城市区分、任何默认备案号。
- 校验正则（唯一事实源在 `icp-record.ts`）：`^[\u4e00-\u9fa5]{1,3}ICP(备|证)\d{6,12}号(-\d{1,3})?$`，对 trim 后的值判定。
- 中文文案简体。

---

### Task 1: 任务库 + 纯函数 `normalizeIcpRecordNumber`

**Files:**
- Create: `src/lib/frontend/icp-record.ts`
- Test: `tests/opt097-icp-record.test.ts`
- Modify（不入库）: `.env.local` 的 `DATABASE_URL` 库名 → `sbh_dev_097`

**Interfaces:**
- Produces: `normalizeIcpRecordNumber(raw: unknown): string | null`、`isValidIcpRecordNumber(raw: unknown): boolean`、`ICP_RECORD_URL = 'https://beian.miit.gov.cn/'`

- [x] **Step 1: 克隆任务库并指向它**

PowerShell（psql 不在 PATH，且 Git Bash 下会挂住）：

```powershell
$env:PATH = "C:\Program Files\PostgreSQL\16\bin;" + $env:PATH
$line = (Get-Content E:\wt-097\payload-office-platform\.env.local | Where-Object { $_ -like "DATABASE_URL=*" })
$url = $line.Substring(13).Trim()
$env:PGCONNECT_TIMEOUT = "5"
& psql -A -t -c "select count(*) from pg_stat_activity where datname='postgres' and pid<>pg_backend_pid()" $url
& psql -A -t -c "CREATE DATABASE sbh_dev_097 TEMPLATE postgres" $url
```

第一条计数必须是 0（否则 TEMPLATE 被拒，先停掉占着 `postgres` 库的 dev server）。然后把 `.env.local` 里 `DATABASE_URL` 末尾的 `/postgres` 改成 `/sbh_dev_097`（`sed -i 's#/postgres$#/sbh_dev_097#' .env.local`），并 `pnpm migrate:status 2>&1 | tail -3` 确认全部已应用。

- [x] **Step 2: 生成类型并确认基线干净**

```bash
cd /e/wt-097/payload-office-platform && pnpm generate:types && grep -c "prefix" src/payload-types.ts && pnpm typecheck
```

Expected: `2`、typecheck 0 错。

- [x] **Step 3: 写失败的单测**

`tests/opt097-icp-record.test.ts`：

```ts
import { describe, expect, it } from 'vitest'

import { ICP_RECORD_URL, isValidIcpRecordNumber, normalizeIcpRecordNumber } from '@/lib/frontend/icp-record'

/**
 * OPT-097：页脚 ICP 备案号。后台字段校验与前台映射共用 normalizeIcpRecordNumber，
 * 这里锁的是它的口径：三种常见形态放行，明显不是备案号的串拒绝。
 */
describe('normalizeIcpRecordNumber', () => {
  it('三种常见形态放行，首尾空白去掉', () => {
    expect(normalizeIcpRecordNumber('沪ICP备2026037944号')).toBe('沪ICP备2026037944号')
    expect(normalizeIcpRecordNumber('京ICP证030173号')).toBe('京ICP证030173号')
    expect(normalizeIcpRecordNumber('粤ICP备12345678号-1')).toBe('粤ICP备12345678号-1')
    expect(normalizeIcpRecordNumber('  沪ICP备2026037944号  ')).toBe('沪ICP备2026037944号')
  })

  it('空串 / null / undefined / 非字符串 → null', () => {
    expect(normalizeIcpRecordNumber('')).toBeNull()
    expect(normalizeIcpRecordNumber('   ')).toBeNull()
    expect(normalizeIcpRecordNumber(null)).toBeNull()
    expect(normalizeIcpRecordNumber(undefined)).toBeNull()
    expect(normalizeIcpRecordNumber(2026037944)).toBeNull()
  })

  it('缺省份 / 缺「号」/ 中间带空格 / 纯数字 / 英文 → null', () => {
    expect(normalizeIcpRecordNumber('ICP备2026037944号')).toBeNull()
    expect(normalizeIcpRecordNumber('沪ICP备2026037944')).toBeNull()
    expect(normalizeIcpRecordNumber('沪ICP备 2026037944号')).toBeNull()
    expect(normalizeIcpRecordNumber('2026037944')).toBeNull()
    expect(normalizeIcpRecordNumber('abc')).toBeNull()
    expect(normalizeIcpRecordNumber('沪ICP备2026037944号-abc')).toBeNull()
  })
})

describe('isValidIcpRecordNumber（后台字段 validate）', () => {
  it('留空合法', () => {
    expect(isValidIcpRecordNumber(undefined)).toBe(true)
    expect(isValidIcpRecordNumber(null)).toBe(true)
    expect(isValidIcpRecordNumber('')).toBe(true)
    expect(isValidIcpRecordNumber('  ')).toBe(true)
  })

  it('填了就必须能归一化', () => {
    expect(isValidIcpRecordNumber('沪ICP备2026037944号')).toBe(true)
    expect(isValidIcpRecordNumber('abc')).toBe(false)
  })
})

it('备案链接固定指向工信部备案系统', () => {
  expect(ICP_RECORD_URL).toBe('https://beian.miit.gov.cn/')
})
```

- [x] **Step 4: 跑测试确认失败**

```bash
cd /e/wt-097/payload-office-platform && pnpm vitest run tests/opt097-icp-record.test.ts
```

Expected: FAIL，`Failed to resolve import "@/lib/frontend/icp-record"`。

- [x] **Step 5: 实现纯函数**

`src/lib/frontend/icp-record.ts`：

```ts
/**
 * 页脚 ICP 备案号（OPT-097）。
 *
 * 备案编号必须展示在网站底部并链接到工信部备案管理系统，所以这里不只是一段文案：
 * 后台字段 `validate` 与 C 端 `toView` 映射共用本函数，填错格式的号在保存时就被拒，
 * 不会挂到线上。校验故意宽松——只认「省份简称 + ICP备/证 + 数字 + 号（-序号）」这个骨架，
 * 不猜数字位数（老号 8 位、新号 10 位都见过）。
 *
 * 纯函数、零依赖：本文件会被 'use client' 组件间接引用，不能 import payload。
 */

/** 工信部备案管理系统首页。备案编号展示要求链接到这里，没有第二个合理值。 */
export const ICP_RECORD_URL = 'https://beian.miit.gov.cn/'

/**
 * 「沪ICP备2026037944号」「京ICP证030173号」「粤ICP备12345678号-1」都过；
 * 省份简称 1–3 个汉字，数字 6–12 位，可选 `-序号`。
 */
const ICP_RECORD_PATTERN = /^[\u4e00-\u9fa5]{1,3}ICP(备|证)\d{6,12}号(-\d{1,3})?$/

export function normalizeIcpRecordNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return ICP_RECORD_PATTERN.test(value) ? value : null
}

/** 后台字段校验用：留空合法，填了就必须能归一化。 */
export function isValidIcpRecordNumber(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true
  if (typeof raw === 'string' && raw.trim() === '') return true
  return normalizeIcpRecordNumber(raw) !== null
}
```

- [x] **Step 6: 跑测试确认通过**

```bash
cd /e/wt-097/payload-office-platform && pnpm vitest run tests/opt097-icp-record.test.ts
```

Expected: 5 passed。

- [x] **Step 7: 提交**

```bash
cd /e/wt-097 && git add payload-office-platform/src/lib/frontend/icp-record.ts payload-office-platform/tests/opt097-icp-record.test.ts && git commit -m "feat(site-settings): ICP 备案号归一化与校验纯函数（OPT-097）"
```

---

### Task 2: Global 字段 + 迁移

**Files:**
- Modify: `src/globals/SiteSettings.ts:166-171`（「版权主体」之后插入）
- Create（由 CLI 生成）: `src/migrations/<时间戳>_opt_097_icp_record.ts` + `.json`；`src/migrations/index.ts` 自动更新

**Interfaces:**
- Consumes: Task 1 的 `isValidIcpRecordNumber`
- Produces: `SiteSetting.icpRecordNumber?: string | null`（`generate:types` 生成）；表 `site_settings` 列 `icp_record_number varchar`

- [x] **Step 1: 加字段**

在 `src/globals/SiteSettings.ts` 顶部 import 区加：

```ts
import { isValidIcpRecordNumber } from '@/lib/frontend/icp-record'
```

（对照文件里 `isValidServicePhone` 的 import 写法与位置。）在「页脚」tab 的 `copyrightHolder` 对象之后、`footerTaglineSuffix` 之前插入：

```ts
            {
              name: 'icpRecordNumber',
              label: 'ICP 备案号',
              type: 'text',
              validate: (value: unknown) =>
                isValidIcpRecordNumber(value) ||
                '格式应为「沪ICP备2026037944号」（省份简称 + ICP备/证 + 数字 + 号，可带 -序号）',
              admin: {
                description:
                  '按备案通知书原样填（如 沪ICP备2026037944号）。渲染在页脚版权之后，自动链接到工信部备案管理系统；留空不显示。保存后最长 60 秒全站生效。',
              },
            },
```

- [x] **Step 2: 生成类型、生成迁移**

```bash
cd /e/wt-097/payload-office-platform && pnpm generate:types && grep -c "prefix" src/payload-types.ts && pnpm exec payload migrate:create opt_097_icp_record 2>&1 | tail -5 && ls src/migrations | tail -3
```

Expected: `2`；新出现 `<时间戳>_opt_097_icp_record.ts` 与 `.json`。打开 `.ts`，`up()` 应**只**含 `ALTER TABLE "site_settings" ADD COLUMN "icp_record_number" varchar;`，`down()` 只含对应 `DROP COLUMN`。**若 diff 里出现与本任务无关的 DDL，停下核对 `sbh_dev_097` 的迁移状态，不要把无关变更带进本迁移。**

- [x] **Step 3: 应用迁移、跑闸门**

```bash
cd /e/wt-097/payload-office-platform && pnpm exec payload migrate 2>&1 | tail -3 && pnpm migrate:dry-run 2>&1 | tail -4 && pnpm typecheck && pnpm vitest run tests/opt083-detail-spec-settings-coverage.test.ts tests/admin-navigation-config.test.ts
```

Expected: 迁移应用成功；dry-run 报本迁移无禁用模式；typecheck 0 错；两份守卫仍绿。

- [x] **Step 4: 提交（迁移 .ts + .json + index.ts 一起）**

```bash
cd /e/wt-097 && git add payload-office-platform/src/globals/SiteSettings.ts payload-office-platform/src/migrations/index.ts payload-office-platform/src/migrations/*opt_097_icp_record.ts payload-office-platform/src/migrations/*opt_097_icp_record.json && git commit -m "feat(site-settings): 页脚新增「ICP 备案号」字段与迁移（OPT-097）"
```

---

### Task 3: 视图映射 + 页脚渲染 + 样式

**Files:**
- Modify: `src/lib/frontend/site-settings-view.ts:43-44`（类型）与 `:94-95`（FALLBACK）
- Modify: `src/lib/frontend/site-settings.ts:151-152`（`toView`）
- Modify: `src/components/frontend/SiteFooter.tsx:98-104`（底栏）
- Modify: `src/app/(frontend)/styles.css:1322`（`.site-footer__bar-inner` 之后）
- Test: `tests/opt097-icp-record.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `normalizeIcpRecordNumber`、`ICP_RECORD_URL`；Task 2 的 `SiteSetting.icpRecordNumber`
- Produces: `SiteSettingsView.icpRecordNumber: string | null`；页脚节点 `a.site-footer__icp[href="https://beian.miit.gov.cn/"][target=_blank][rel="noopener noreferrer"]`

- [x] **Step 1: 追加失败的测试**

在 `tests/opt097-icp-record.test.ts` 顶部 import 区加：

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/shanghai',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}))

import SiteFooter from '@/components/frontend/SiteFooter'
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings-view'
```

（`vi.mock` 必须在被 mock 模块被 import 之前——vitest 会提升，但为可读性保持这个顺序；`vi` 合并进已有的 vitest import。）文件末尾追加：

```ts
const CITIES = [{ slug: 'shanghai', name: '上海', serviceStatus: 'live' as const, sortOrder: 10 }]

function renderFooter(icpRecordNumber: string | null): string {
  return renderToStaticMarkup(
    React.createElement(SiteFooter, {
      cities: CITIES,
      defaultCity: 'shanghai',
      multiCityRoutingEnabled: true,
      settings: { ...SITE_SETTINGS_FALLBACK, icpRecordNumber },
    }),
  )
}

describe('SiteFooter 备案号', () => {
  it('兜底配置里没有备案号：代码不得替运营编一个', () => {
    expect(SITE_SETTINGS_FALLBACK.icpRecordNumber).toBeNull()
  })

  it('有值：版权之后渲染指向工信部的新窗口链接', () => {
    const html = renderFooter('沪ICP备2026037944号')
    expect(html).toMatch(
      /<a class="site-footer__icp" href="https:\/\/beian\.miit\.gov\.cn\/" target="_blank" rel="noopener noreferrer">沪ICP备2026037944号<\/a>/,
    )
    // 顺序：© 版权 → 备案号 → 城市副标题
    expect(html.indexOf('©')).toBeLessThan(html.indexOf('site-footer__icp'))
    expect(html.indexOf('site-footer__icp')).toBeLessThan(html.indexOf('商务办公租赁'))
  })

  it('无值：整个节点不渲染', () => {
    const html = renderFooter(null)
    expect(html).not.toContain('site-footer__icp')
    expect(html).not.toContain('beian.miit.gov.cn')
  })
})

describe('toView 映射契约', () => {
  it('site-settings.ts 用 normalizeIcpRecordNumber 映射 icpRecordNumber（非法值不得原样透传）', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/lib/frontend/site-settings.ts'), 'utf8')
    expect(src).toContain('icpRecordNumber: normalizeIcpRecordNumber(doc.icpRecordNumber)')
  })
})
```

- [x] **Step 2: 跑测试确认失败**

```bash
cd /e/wt-097/payload-office-platform && pnpm vitest run tests/opt097-icp-record.test.ts
```

Expected: 「兜底」「有值」「契约」三条 FAIL（`icpRecordNumber` 不存在于类型 / 页脚无该节点 / 源码无该行）。

- [x] **Step 3: 视图类型与兜底**

`src/lib/frontend/site-settings-view.ts`：在 `footerTaglineSuffix: string` 之后加

```ts
  /** ICP 备案号（OPT-097）。已归一化：非法 / 空一律 null，页脚据此决定渲不渲染。 */
  icpRecordNumber: string | null
```

在 `SITE_SETTINGS_FALLBACK` 的 `footerTaglineSuffix: '商务办公租赁',` 之后加

```ts
  // 备案号不能由代码编默认值：兜底就是「没有」
  icpRecordNumber: null,
```

- [x] **Step 4: `toView` 映射**

`src/lib/frontend/site-settings.ts`：import 区加

```ts
import { normalizeIcpRecordNumber } from './icp-record'
```

`toView` 里 `footerTaglineSuffix: text(...)` 那行之后加

```ts
    icpRecordNumber: normalizeIcpRecordNumber(doc.icpRecordNumber),
```

- [x] **Step 5: 页脚渲染**

`src/components/frontend/SiteFooter.tsx`：import 区加

```ts
import { ICP_RECORD_URL } from '@/lib/frontend/icp-record'
```

底栏 `<span>© {year} {settings.copyrightHolder}</span>` 之后插入：

```tsx
          {/* OPT-097：备案编号必须展示在底部并链到工信部备案系统；未配置时整个节点不渲染 */}
          {settings.icpRecordNumber ? (
            <a className="site-footer__icp" href={ICP_RECORD_URL} target="_blank" rel="noopener noreferrer">
              {settings.icpRecordNumber}
            </a>
          ) : null}
```

- [x] **Step 6: 样式**

`src/app/(frontend)/styles.css`，`.site-footer__bar-inner { … }` 块之后加：

```css
/* OPT-097：备案号链接与「员工入口」同一处理——继承底栏字色，hover 才下划线 */
.site-footer__icp {
  color: inherit;
  text-decoration: none;
}

.site-footer__icp:hover {
  text-decoration: underline;
}
```

- [x] **Step 7: 跑测试与类型**

```bash
cd /e/wt-097/payload-office-platform && pnpm vitest run tests/opt097-icp-record.test.ts tests/frontend-shell-hydration.test.ts tests/client-components-no-server-imports.test.ts && pnpm typecheck
```

Expected: 全绿（`client-components-no-server-imports` 守的是 client 组件不能拉进 payload——`icp-record.ts` 零 import，必须仍绿）。

- [x] **Step 8: 提交**

```bash
cd /e/wt-097 && git add payload-office-platform/src/lib/frontend/site-settings-view.ts payload-office-platform/src/lib/frontend/site-settings.ts payload-office-platform/src/components/frontend/SiteFooter.tsx "payload-office-platform/src/app/(frontend)/styles.css" payload-office-platform/tests/opt097-icp-record.test.ts && git commit -m "feat(footer): 页脚底栏渲染 ICP 备案号链接（OPT-097）"
```

---

### Task 4: E2E

**Files:**
- Create: `tests/e2e/footer-icp-record.spec.ts`

**Interfaces:**
- Consumes: 夹具管理员 `e2e-adm@example.com / Test1234!`（`scripts/seed.ts`）；`POST /api/globals/site-settings`；页脚节点 `a.site-footer__icp`

- [x] **Step 1: 写 spec**

```ts
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
  const res = await request.post(`${BASE}/api/globals/site-settings`, {
    data: { icpRecordNumber: value },
    headers: ORIGIN_HEADERS,
    failOnStatusCode: false,
  })
  return res
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
```

- [x] **Step 2: 本地单跑（dev server 复用）**

先在 `.claude/launch.json`（主仓 `E:\github\sbh\.claude\launch.json`，不入库）加：

```json
{ "name": "wt-097", "runtimeExecutable": "pnpm", "runtimeArgs": ["--dir", "E:/wt-097/payload-office-platform", "exec", "next", "dev", "-p", "3729"], "port": 3729 }
```

`preview_start { name: "wt-097" }` 起 server，确认 `/` 200 后：

```bash
cd /e/wt-097/payload-office-platform && PORT=3729 pnpm exec playwright test tests/e2e/footer-icp-record.spec.ts --reporter=line 2>&1 | tail -15
```

Expected: 2 passed。若「E2E 管理员账号应成功登录」失败，任务库缺夹具：`pnpm seed` 后重跑。

- [x] **Step 3: 提交**

```bash
cd /e/wt-097 && git add payload-office-platform/tests/e2e/footer-icp-record.spec.ts && git commit -m "test(e2e): 页脚 ICP 备案号配置、渲染与非法值拒绝（OPT-097）"
```

---

### Task 5: 全量闸门 + 浏览器走查 + 证据

**Files:**
- Create: `artifacts/verification/OPT-097/walkthrough-2026-09-14.md`（+ 截图、抓包 JSON）
- Modify: `specs/work-items/OPT-097-footer-icp-record.md`（勾验收、状态改「已实施，待合并」）

- [x] **Step 1: 全量闸门**

```bash
cd /e/wt-097/payload-office-platform && pnpm typecheck && pnpm lint 2>&1 | tail -3 && pnpm test 2>&1 | tail -6 && pnpm migrate:dry-run 2>&1 | tail -4
```

Expected: typecheck 0 错、lint 0 error、test 全绿、dry-run 无禁用模式。

- [x] **Step 2: 后台走查（Browser pane，dev 3729）**

先 `GET /admin/logout` 清掉别的 worktree 串过来的 cookie，再用页内 fetch 以 `e2e-adm@example.com / Test1234!` 登录。打开 `/admin/globals/site-settings` → 「页脚」tab：

| # | 动作 | 判据 |
|---|---|---|
| 1 | 「ICP 备案号」填 `abc` → 保存 | 响应 400；字段下红字含「格式应为」 |
| 2 | 改成 `沪ICP备2026037944号` → 保存 | `read_network_requests` 抓 `POST /api/globals/site-settings` 的 Request Payload 含 `"icpRecordNumber":"沪ICP备2026037944号"`；响应 200 |
| 3 | 强刷页面重进「页脚」tab | 输入框回显该值 |
| 4 | 切深色主题截图 | 输入框底色跟 `--theme-elevation-*`，无残留白底 |

- [x] **Step 3: C 端走查**

| # | 路由 / 视口 | 判据 |
|---|---|---|
| 5 | `/` 1440 | 底栏顺序「© 2026 商办租赁平台」「沪ICP备2026037944号」「上海 · 商务办公租赁」「员工入口」；`innerText` 核对文案（低分辨率截图会误读中文）；链接 `href` / `target` / `rel` 正确 |
| 6 | `/shanghai` 375（`resize_window` 后 **reload** 再量） | 同上，底栏换行不溢出（`document.documentElement.scrollWidth <= innerWidth`） |
| 7 | 后台清空字段保存 → `/` | `.site-footer__icp` 不存在 |
| 8 | 后台填回 `沪ICP备2026037944号` | 恢复 |

控制台无新增错误（`read_console_messages onlyErrors`）。

- [x] **Step 4: 写证据与更新工作项**

`artifacts/verification/OPT-097/walkthrough-2026-09-14.md` 记录上面 8 条的实测结果、截图文件名、抓包片段；`specs/work-items/OPT-097-footer-icp-record.md` §4 逐条勾选、状态改「已实施，待合并」。

```bash
cd /e/wt-097 && git add artifacts/verification/OPT-097 specs/work-items/OPT-097-footer-icp-record.md specs/work-items/OPT-097-plan.md && git commit -m "docs(opt-097): 走查证据与工作项状态"
```

- [x] **Step 5: 推送并开 PR**

```bash
cd /e/wt-097 && git push -u origin feat/opt-097-footer-icp-record-a26d
```

PR 正文：一句话 + 运营操作路径（后台 → 站点与内容 → 站点设置 → 页脚 → ICP 备案号）+ 证据目录链接。**合并即上线**，合并前向用户确认。
