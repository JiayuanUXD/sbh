# 委托找房 / 投放房源 双落地页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上线 `/entrust`（委托找房，单手机号留电）与 `/publish`（投放房源，6 字段含佣金悬赏），并把主导航的「服务式办公」换成这两个入口。

**Architecture:** 委托找房复用现有 `/api/inquiries` → `Leads` 链路，只加 `entrust` 来源枚举与"无姓名"兜底；投放房源新建 `SupplySubmissions` 集合与 `/api/supply-submissions` 端点，**严格照抄 `InformationCorrections` + `/api/corrections` 这一对现成的"公开提交"实现**（同源校验 → Content-Type → body 上限 → 纯函数 schema 白名单 → 幂等键 → 限流 → Local API 写入）。两页共用一组落地页骨架组件，全静态（不读 DB），配色沿用站内奶油+金色。

**Tech Stack:** Next.js 16（App Router, RSC）+ Payload 3.86 + PostgreSQL（`push: false`，只走显式迁移）+ Vitest（纯函数单测）+ Playwright（E2E）。包管理器 **pnpm**。

**Spec:** `docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md`（v2）

## 执行进度

逐任务派发实现者 + 每任务 review 门禁（详细记账见 `.superpowers/sdd/2026-08-09-entrust-supply-pages/progress.md`）。

| 任务 | 状态 | commit / 备注 |
|---|---|---|
| Task 1 导航与页脚 | ✅ 完成 | `3b29379`，review 通过，5/5 单测 |
| Task 2 投放房源纯函数 | ✅ 完成 | `73d30fc`，1 轮修复（控制字符正则），19/19 单测 |
| Task 3 集合 + 迁移 | ✅ 完成 | `5836f1c`，迁移 `20260809_142444_supply_submissions_and_entrust_source`，2418 单测全绿 |
| Task 4 提交端点 | ✅ 完成 | `dac9e79` + `c00a8bf`，1 轮安全修复，review 通过 |
| Task 5 entrust 链路 | ✅ 完成 | `f30f808` + `469f08d`，1 轮 update-delta 修复，review 通过 |
| Task 6 骨架组件 | ⬜ 未开始 | |
| Task 7 `/entrust` 页 | ⬜ 未开始 | |
| Task 8 `/publish` 页 | ⬜ 未开始 | |
| Task 9 站内通知 | ⬜ 未开始 | |
| Task 10 埋点 | ⬜ 未开始 | |
| Task 11 sitemap | ⬜ 未开始 | |
| Task 12 E2E 与验证 | ⬜ 未开始 | |

执行期已修的两处**计划自身缺陷**（均已 commit 并回写本文档）：

1. `3d254cf` — 控制字符正则原文含字面控制字节，转写会静默丢失导致过滤失效，改为 `/[\x00-\x1F\x7F]/` 转义写法并补 DEL。
2. `db97ded` — 操作权限编码 `supply-submission:*` 违反 `permission-codes.ts` 的 `/^[a-z_]+:[a-z_]+$/` 约定，改为 `supply_submission:*`（MENU 编码与 collection slug 仍为 kebab-case）。

## Global Constraints

- 包管理器是 **pnpm**，不用 npm/yarn。
- **所有 schema 变更必须 `pnpm payload migrate:create` 生成迁移并提交 `src/migrations/`；迁移文件正文绝不手改。** 本地 `DATABASE_URL` 必须是 postgres，且用本工作树独立库（如 `sbh_dev_entrust`），不共用 `sbh_dev`、不指向生产 TencentDB。
- 本工作树用独立 dev 端口（**不要抢 3717**，用 `PORT=3719 pnpm dev`）。
- C 端 Server Component 读数据只走 Local API（`getPayload()`），不调 REST `/api/*`。
- 新增 UI 只用 `(frontend)/styles.css` 的既有 CSS 变量（`--ink --muted --line --paper --cream --gold --deep --green`）与既有 class；**不引任何新 UI 库**，**不引入阿里红**。
- 纯函数（schema / 幂等 / 日志）严格 TDD：先写失败测试 → 跑红 → 实现 → 跑绿 → 提交。
- 提交只用**显式 `git add <具体路径>`**；禁用 `git add -A` / `git add .` / `git commit -am`。仓库里 `payload-office-platform/public/prd/*.md` 处于已删除状态，是用户有意搁置的，**别恢复、别提交**。
- 所有中文文案用**简体中文**。
- 品牌名固定为 `商办租赁`（与 `(frontend)/layout.tsx:15` 一致），**不要出现"阿里"字样**。
- 待确认项已按 PRD §13 的建议值定稿：`/entrust` + `/publish` 路由；不做短信验证码；不做 §4.6 的可选补充需求表单；三个数字背书走 `site-config` 静态常量；投放房源页按"首屏即全部"实现（无卡片下方区块）。

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `src/lib/frontend/public-nav.ts` | C 端主导航与页脚导航的**唯一数据源**（现在两处各写一份，本次要改的正是这份数据） |
| `src/lib/frontend/landing-config.ts` | 两个落地页的文案与数字背书常量（运营改文案只碰这一个文件） |
| `src/domain/supply-submission/schema.ts` | 投放房源请求体白名单收窄（纯函数） |
| `src/domain/supply-submission/idempotency.ts` | 幂等键计算（纯函数） |
| `src/domain/supply-submission/privacy-log.ts` | 安全日志条目 + IP 哈希（纯函数） |
| `src/domain/supply-submission/submission-protect.ts` | beforeChange 保护 hook（事实字段 append-only） |
| `src/domain/supply-submission/index.ts` | 桶文件 |
| `src/collections/SupplySubmissions.ts` | 新集合 |
| `src/app/api/supply-submissions/route.ts` | 公开提交端点 |
| `src/app/(frontend)/entrust/page.tsx` | 委托找房页 |
| `src/app/(frontend)/publish/page.tsx` | 投放房源页 |
| `src/components/frontend/landing/LandingHero.tsx` | Hero（`split` / `centered` 两变体） |
| `src/components/frontend/landing/ProcessSteps.tsx` | 带 `›` 的流程条（`card` / `compact` 两尺寸） |
| `src/components/frontend/landing/StatHighlights.tsx` | 3 列数字背书 |
| `src/components/frontend/landing/BottomCtaBar.tsx` | 底部 CTA 条 |
| `src/components/frontend/landing/EntrustForm.tsx` | 单手机号表单（客户端） |
| `src/components/frontend/landing/SupplySubmissionForm.tsx` | 6 字段卡片表单（客户端） |
| `tests/supply-submission-domain.test.ts` | 纯函数单测 |
| `tests/public-nav.test.ts` | 导航数据单测 |
| `tests/e2e/landing-pages.spec.ts` | 两页 E2E |

**修改**

| 文件 | 改动 |
|---|---|
| `src/components/frontend/SiteNav.tsx:22-28` | 改为从 `public-nav.ts` 读 `MAIN_NAV_ITEMS` |
| `src/components/frontend/SiteFooter.tsx:20-37` | 改为从 `public-nav.ts` 读 `FOOTER_COLUMNS` |
| `src/collections/Leads.ts:19-25` | `INQUIRY_SOURCE_PAGE_TYPES` 加 `'entrust'`；`hooks` 加 `beforeValidate` |
| `src/domain/inquiry/schema.ts:21-23, 159-161` | `SOURCE_PAGE_TYPES` 加 `'entrust'`；entrust 渠道放宽 `name` |
| `src/domain/auth/permission-codes.ts` | 注册 1 个 MENU + 3 个 OPERATION 编码 |
| `src/domain/admin-navigation/navigation-config.ts` | 「房源运营」组下加一个叶子 |
| `src/collections/Notifications.ts` | `NOTIFICATION_TYPES` / `NOTIFICATION_SOURCE_TYPES` 各加 1 个值 |
| `src/payload.config.ts:153-` | 注册 `SupplySubmissions` |
| `src/lib/rate-limit-config.ts` | 新增 `SUPPLY_SUBMISSION_RATE_LIMIT_CONFIG` |
| `src/app/(frontend)/sitemap.ts:109-111` | 加两条静态项 |
| `src/app/(frontend)/styles.css` | 追加落地页样式 |

**决定：为什么新建 `public-nav.ts`** —— 「服务式办公」这一条现在在 `SiteNav.tsx:27` 和 `SiteFooter.tsx:32` 各写了一份。本次要同时改两处，如果不收敛，下次改导航还会漏一处（这次就是页脚差点被漏掉）。收敛后导航数据可被单测锁定。

---

## Task 1: 导航与页脚收敛 + 入口调整

> **状态：** ✅ 已完成（commits ed5f7cd..3b29379，review 通过，5/5 单测）

> **状态：** ✅ 已完成（commits ed5f7cd..3b29379，review 通过，5/5 单测）

**Files:**
- Create: `src/lib/frontend/public-nav.ts`
- Modify: `src/components/frontend/SiteNav.tsx`（删除 `NAV_ITEMS` 常量，改为 import）
- Modify: `src/components/frontend/SiteFooter.tsx`（删除 `COLUMNS` 常量，改为 import）
- Test: `tests/public-nav.test.ts`

**Interfaces:**
- Consumes: 无（本任务可独立先合）
- Produces:
  - `export type PublicNavItem = { href: string; label: string }`
  - `export const MAIN_NAV_ITEMS: readonly PublicNavItem[]`
  - `export const FOOTER_COLUMNS: readonly { title: string; links: readonly PublicNavItem[] }[]`

- [x] **Step 1: 写失败测试**

创建 `tests/public-nav.test.ts`：

```ts
/**
 * 单测：C 端公开导航数据（委托找房 / 投放房源 入口调整）
 *
 * 守护不变量：
 *   - 主导航为 6 项，顺序固定，「委托找房」「投放房源」紧跟「共享办公」之后、「资讯」之前；
 *   - 主导航与页脚都不再出现「服务式办公」入口；
 *   - 页脚「服务」分组包含两个新入口。
 */

import { describe, expect, it } from 'vitest'
import { FOOTER_COLUMNS, MAIN_NAV_ITEMS } from '@/lib/frontend/public-nav'

describe('MAIN_NAV_ITEMS', () => {
  it('按固定顺序暴露 6 个入口', () => {
    expect(MAIN_NAV_ITEMS.map((i) => i.label)).toEqual([
      '找办公室',
      '找楼盘',
      '共享办公',
      '委托找房',
      '投放房源',
      '资讯',
    ])
  })

  it('委托找房与投放房源指向独立路由', () => {
    const byLabel = new Map(MAIN_NAV_ITEMS.map((i) => [i.label, i.href]))
    expect(byLabel.get('委托找房')).toBe('/entrust')
    expect(byLabel.get('投放房源')).toBe('/publish')
  })

  it('不再包含服务式办公导航入口', () => {
    expect(MAIN_NAV_ITEMS.some((i) => i.label === '服务式办公')).toBe(false)
    expect(MAIN_NAV_ITEMS.some((i) => i.href.includes('serviced-office'))).toBe(false)
  })
})

describe('FOOTER_COLUMNS', () => {
  it('页脚不再包含服务式办公链接', () => {
    const allLinks = FOOTER_COLUMNS.flatMap((c) => c.links)
    expect(allLinks.some((l) => l.href.includes('serviced-office'))).toBe(false)
  })

  it('页脚「服务」分组包含两个新入口', () => {
    const service = FOOTER_COLUMNS.find((c) => c.title === '服务')
    expect(service).toBeDefined()
    expect(service?.links.map((l) => l.href)).toEqual(['/entrust', '/publish'])
  })
})
```

- [x] **Step 2: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm vitest run tests/public-nav.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/frontend/public-nav"`

- [x] **Step 3: 创建 `src/lib/frontend/public-nav.ts`**

```ts
/**
 * C 端公开站导航数据（主导航 + 页脚）
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §2.1
 *
 * 守护不变量：
 *   - 导航数据只有这一处定义；SiteNav 与 SiteFooter 都从此读取，
 *     避免"改了导航忘了页脚"（本次调整前「服务式办公」正是两处各写一份）；
 *   - 主导航顺序即产品定义顺序，由 tests/public-nav.test.ts 锁定；
 *   - 只删导航入口，不动 Listings.listingType 的 serviced-office 枚举
 *     （房源类型仍存在，筛选器里仍可选）。
 */

export type PublicNavItem = Readonly<{ href: string; label: string }>

export type PublicNavColumn = Readonly<{
  title: string
  links: readonly PublicNavItem[]
}>

/** 主导航：logo 即回首页，故不设「首页」项。 */
export const MAIN_NAV_ITEMS: readonly PublicNavItem[] = [
  { href: '/listings', label: '找办公室' },
  { href: '/buildings', label: '找楼盘' },
  { href: '/listings?type=coworking', label: '共享办公' },
  { href: '/entrust', label: '委托找房' },
  { href: '/publish', label: '投放房源' },
  { href: '/news', label: '资讯' },
] as const

/** 页脚导航分组。 */
export const FOOTER_COLUMNS: readonly PublicNavColumn[] = [
  {
    title: '浏览',
    links: [
      { href: '/listings', label: '在租房源' },
      { href: '/buildings', label: '找写字楼' },
      { href: '/news', label: '资讯中心' },
    ],
  },
  {
    title: '按类型',
    links: [
      { href: '/listings?type=traditional-office', label: '传统办公' },
      { href: '/listings?type=coworking', label: '联合办公' },
      { href: '/listings?type=full-floor', label: '整层办公' },
    ],
  },
  {
    title: '服务',
    links: [
      { href: '/entrust', label: '委托找房' },
      { href: '/publish', label: '投放房源' },
    ],
  },
] as const
```

- [x] **Step 4: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm vitest run tests/public-nav.test.ts
```

Expected: PASS（5 个测试）

- [x] **Step 5: 改 `SiteNav.tsx` 用共享数据**

删除文件内的 `type NavItem` 与 `const NAV_ITEMS = [...] as const` 整块（原 `:22-28`，含其上方那段"对齐 homepage-preview.html"注释），在 import 区加：

```ts
import { MAIN_NAV_ITEMS } from '@/lib/frontend/public-nav'
```

然后把文件里**两处** `NAV_ITEMS.map(...)`（桌面 `<nav>` 与移动抽屉各一处）改成 `MAIN_NAV_ITEMS.map(...)`。`isCurrent()` 函数与其余逻辑**不动**——`/entrust` 与 `/publish` 无 query，走"无 query 分支"，`!searchParams.has('type')` 对这两个路径恒为真，高亮正确。

- [x] **Step 6: 改 `SiteFooter.tsx` 用共享数据**

删除文件顶部的 `COLUMNS` 常量整块（原 `:20-37`），加 import 并把 `COLUMNS.map` 改为 `FOOTER_COLUMNS.map`：

```ts
import { FOOTER_COLUMNS } from '@/lib/frontend/public-nav'
```

- [x] **Step 7: 类型检查 + 全量单测**

```bash
cd payload-office-platform && pnpm typecheck && pnpm test
```

Expected: 类型检查无输出（通过）；单测全绿。

- [x] **Step 8: 提交**

```bash
git add payload-office-platform/src/lib/frontend/public-nav.ts payload-office-platform/src/components/frontend/SiteNav.tsx payload-office-platform/src/components/frontend/SiteFooter.tsx payload-office-platform/tests/public-nav.test.ts
git commit -m "feat(frontend): 导航去掉服务式办公，新增委托找房/投放房源入口

导航与页脚数据收敛到 lib/frontend/public-nav.ts 单一来源，
单测锁定 6 项顺序与两个新路由。只删入口，不动 listingType 枚举。"
```

---

## Task 2: 投放房源纯函数（schema / 幂等 / 日志）

> **状态：** ✅ 已完成（commits 3b29379..73d30fc，含 1 轮修复，review 通过，19/19 单测）

> **状态：** ✅ 已完成（commits 3b29379..73d30fc，含 1 轮修复，review 通过，19/19 单测）

**Files:**
- Create: `src/domain/supply-submission/schema.ts`
- Create: `src/domain/supply-submission/idempotency.ts`
- Create: `src/domain/supply-submission/privacy-log.ts`
- Create: `src/domain/supply-submission/index.ts`
- Test: `tests/supply-submission-domain.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` / `isValidCnMobile`（`@/domain/shared/phone`）、`PRICE_UNITS` / `InquiryPriceUnit`（`@/domain/inquiry/schema`）、`PRIVACY_POLICY_VERSION`（`@/lib/frontend/site-config`）
- Produces:
  - `COMMISSION_MONTHS: readonly ['none','0.5','1','1.5','2']`、`CommissionMonths`、`COMMISSION_MONTHS_LABELS: Record<CommissionMonths, string>`
  - `SUPPLY_LIMITS`（长度/数值上限常量）
  - `SupplySubmissionRequest`（含 `phoneNormalized`）
  - `validateSupplySubmission(input: unknown): { ok: true; data: SupplySubmissionRequest } | { ok: false; errors: readonly string[] }`
  - `computeSupplyIdempotencyKey(requestId, phoneNormalized, buildingName): Promise<string>`
  - `computeSupplyIdempotencyKeySync(requestId, phoneNormalized, buildingName): string`
  - `buildSupplyLogEntry(req, opts): SupplySubmissionLogEntry`
  - `hashIpForLog(ip, salt): string`

- [x] **Step 1: 写失败测试**

创建 `tests/supply-submission-domain.test.ts`：

```ts
/**
 * 单测：domain/supply-submission 纯函数
 *
 * 守护不变量：
 *   - 输入视为 unknown，白名单收窄后才落库；
 *   - 必填：buildingName / address / areaSqm / contactPhone / consent.accepted=true
 *     / consent.policyVersion / source.path / requestId；
 *   - 选填：rentAmount / rentUnit / commissionMonths（缺省 none）；
 *   - 流程字段（status/assignee/matchedBuilding...）即使传入也必须被丢弃；
 *   - source.path 只接受同源 pathname，query/hash 被剥离，绝对 URL 被拒；
 *   - 幂等键 = sha256(requestId | phoneNormalized | buildingName)；
 *   - 安全日志不含手机号原文、楼盘名、地址、原始 IP。
 */

import { describe, expect, it } from 'vitest'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import {
  COMMISSION_MONTHS,
  SUPPLY_LIMITS,
  validateSupplySubmission,
} from '@/domain/supply-submission/schema'
import { computeSupplyIdempotencyKeySync } from '@/domain/supply-submission/idempotency'
import { buildSupplyLogEntry, hashIpForLog } from '@/domain/supply-submission/privacy-log'

/** 最小合法请求体 */
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: 'req-0001',
    buildingName: '静安嘉里中心',
    address: '3 号楼 12 层 1203 室',
    areaSqm: 260,
    contactPhone: '13800001111',
    consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
    source: { path: '/publish' },
    ...overrides,
  }
}

describe('validateSupplySubmission - 成功路径', () => {
  it('最小合法请求体通过，佣金缺省为 none', () => {
    const r = validateSupplySubmission(validBody())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.buildingName).toBe('静安嘉里中心')
    expect(r.data.areaSqm).toBe(260)
    expect(r.data.commissionMonths).toBe('none')
    expect(r.data.phoneNormalized).toBe('13800001111')
    expect(r.data.rentAmount).toBeNull()
    expect(r.data.rentUnit).toBeNull()
  })

  it('接受租金与单位，并保留佣金枚举', () => {
    const r = validateSupplySubmission(
      validBody({ rentAmount: 8.5, rentUnit: 'rmb-sqm-day', commissionMonths: '1.5' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.rentAmount).toBe(8.5)
    expect(r.data.rentUnit).toBe('rmb-sqm-day')
    expect(r.data.commissionMonths).toBe('1.5')
  })

  it('剥离 source.path 的 query 与 hash', () => {
    const r = validateSupplySubmission(
      validBody({ source: { path: '/publish?utm_source=wechat#form' } }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.source.path).toBe('/publish')
  })

  it('丢弃外部传入的流程字段', () => {
    const r = validateSupplySubmission(
      validBody({ status: 'converted', assignee: 1, matchedBuilding: 9, reviewNote: 'x' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data as Record<string, unknown>).not.toHaveProperty('status')
    expect(r.data as Record<string, unknown>).not.toHaveProperty('assignee')
    expect(r.data as Record<string, unknown>).not.toHaveProperty('matchedBuilding')
    expect(r.data as Record<string, unknown>).not.toHaveProperty('reviewNote')
  })

  it('全部佣金枚举值都被接受', () => {
    for (const value of COMMISSION_MONTHS) {
      const r = validateSupplySubmission(validBody({ commissionMonths: value }))
      expect(r.ok).toBe(true)
    }
  })
})

describe('validateSupplySubmission - 失败路径', () => {
  it('非对象输入返回 invalid_body', () => {
    expect(validateSupplySubmission(null)).toEqual({ ok: false, errors: ['invalid_body'] })
    expect(validateSupplySubmission('x')).toEqual({ ok: false, errors: ['invalid_body'] })
    expect(validateSupplySubmission([])).toEqual({ ok: false, errors: ['invalid_body'] })
  })

  it('缺楼盘名 / 地址 / 面积 / 手机号各自报错', () => {
    const r = validateSupplySubmission({
      requestId: 'req-1',
      consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
      source: { path: '/publish' },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('building_name_required')
    expect(r.errors).toContain('address_required')
    expect(r.errors).toContain('area_required')
    expect(r.errors).toContain('phone_invalid')
  })

  it('手机号非中国大陆 11 位被拒', () => {
    const r = validateSupplySubmission(validBody({ contactPhone: '12345' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('phone_invalid')
  })

  it('面积非正数或超上限被拒', () => {
    for (const bad of [0, -1, SUPPLY_LIMITS.AREA_MAX + 1]) {
      const r = validateSupplySubmission(validBody({ areaSqm: bad }))
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.errors).toContain('area_invalid')
    }
  })

  it('楼盘名 / 地址超长被拒', () => {
    const r = validateSupplySubmission(
      validBody({
        buildingName: 'A'.repeat(SUPPLY_LIMITS.BUILDING_NAME_MAX + 1),
        address: 'B'.repeat(SUPPLY_LIMITS.ADDRESS_MAX + 1),
      }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('building_name_too_long')
    expect(r.errors).toContain('address_too_long')
  })

  it('未同意隐私政策或版本不匹配被拒', () => {
    const notAccepted = validateSupplySubmission(
      validBody({ consent: { accepted: false, policyVersion: PRIVACY_POLICY_VERSION } }),
    )
    expect(notAccepted.ok).toBe(false)
    if (!notAccepted.ok) expect(notAccepted.errors).toContain('consent_required')

    const wrongVersion = validateSupplySubmission(
      validBody({ consent: { accepted: true, policyVersion: 'BOGUS' } }),
    )
    expect(wrongVersion.ok).toBe(false)
    if (!wrongVersion.ok) expect(wrongVersion.errors).toContain('consent_version_mismatch')
  })

  it('佣金非枚举值被拒', () => {
    const r = validateSupplySubmission(validBody({ commissionMonths: '3' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('commission_invalid')
  })

  it('租金单位非枚举、租金为负被拒', () => {
    const unit = validateSupplySubmission(validBody({ rentAmount: 5, rentUnit: 'usd-month' }))
    expect(unit.ok).toBe(false)
    if (!unit.ok) expect(unit.errors).toContain('rent_unit_invalid')

    const amount = validateSupplySubmission(validBody({ rentAmount: -3, rentUnit: 'rmb-month' }))
    expect(amount.ok).toBe(false)
    if (!amount.ok) expect(amount.errors).toContain('rent_amount_invalid')
  })

  it('绝对 URL / 协议相对 URL / 非同源路径作为 source.path 被拒', () => {
    for (const bad of ['https://evil.com/publish', '//evil.com/publish', 'publish']) {
      const r = validateSupplySubmission(validBody({ source: { path: bad } }))
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.errors).toContain('source_path_invalid')
    }
  })
})

describe('computeSupplyIdempotencyKeySync', () => {
  it('同输入同键，64 位 hex', () => {
    const a = computeSupplyIdempotencyKeySync('req-1', '13800001111', '静安嘉里中心')
    const b = computeSupplyIdempotencyKeySync('req-1', '13800001111', '静安嘉里中心')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('楼盘名或手机号不同则键不同', () => {
    const base = computeSupplyIdempotencyKeySync('req-1', '13800001111', '静安嘉里中心')
    expect(computeSupplyIdempotencyKeySync('req-1', '13800001111', '恒隆广场')).not.toBe(base)
    expect(computeSupplyIdempotencyKeySync('req-1', '13900002222', '静安嘉里中心')).not.toBe(base)
  })
})

describe('buildSupplyLogEntry', () => {
  it('不含手机号原文、楼盘名、地址', () => {
    const r = validateSupplySubmission(validBody({ rentAmount: 8, rentUnit: 'rmb-sqm-day' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const entry = buildSupplyLogEntry(r.data, {
      idempotent: false,
      errorCode: null,
      durationMs: 12,
    })
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain('13800001111')
    expect(serialized).not.toContain('静安嘉里中心')
    expect(serialized).not.toContain('1203')
    expect(entry.hasRent).toBe(true)
    expect(entry.commissionMonths).toBe('none')
    expect(entry.durationMs).toBe(12)
  })
})

describe('hashIpForLog', () => {
  it('同盐同 IP 稳定，换盐即变，返回 32 位 hex', () => {
    const a = hashIpForLog('1.2.3.4', '2026-08-09')
    expect(a).toBe(hashIpForLog('1.2.3.4', '2026-08-09'))
    expect(a).not.toBe(hashIpForLog('1.2.3.4', '2026-08-10'))
    expect(a).toMatch(/^[0-9a-f]{32}$/)
  })
})
```

- [x] **Step 2: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm vitest run tests/supply-submission-domain.test.ts
```

Expected: FAIL — 无法解析 `@/domain/supply-submission/schema`

- [x] **Step 3: 实现 `src/domain/supply-submission/schema.ts`**

```ts
/**
 * 投放房源提交 schema 校验与白名单收窄
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.2 / §5.3 / §5.5
 *
 * 守护不变量：
 *   - 输入视为 unknown，白名单收窄后才落库；
 *   - 必填：buildingName (1-100)、address (1-200)、areaSqm (>0)、contactPhone (中国大陆 11 位)、
 *     consent.accepted=true、consent.policyVersion 与当前版本一致、source.path、requestId；
 *   - 选填：rentAmount (≥0) / rentUnit (PRICE_UNITS 枚举) / commissionMonths（缺省 none）；
 *   - 后台字段与流程字段（status/assignee/matchedBuilding/reviewNote/...）一律不接收；
 *   - source.path 只接受同源 pathname；query/hash 剥离，绝对 URL、协议相对 URL、控制字符被拒；
 *   - 错误返回稳定安全错误码字符串数组（不抛异常、不泄露内部对象）。
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { isValidCnMobile, normalizePhone } from '@/domain/shared/phone'
import { PRICE_UNITS, type InquiryPriceUnit } from '@/domain/inquiry/schema'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

/** 佣金悬赏（单位：月租金）。存枚举而非浮点数，避免"0 与未填"歧义。 */
export const COMMISSION_MONTHS = ['none', '0.5', '1', '1.5', '2'] as const
export type CommissionMonths = (typeof COMMISSION_MONTHS)[number]

export const COMMISSION_MONTHS_LABELS: Record<CommissionMonths, string> = {
  none: '无',
  '0.5': '0.5个月',
  '1': '1个月',
  '1.5': '1.5个月',
  '2': '2个月',
}

/** 提交人身份（后台补录，前台不采集） */
export const SUBMITTER_ROLES = ['owner', 'property', 'agency', 'operator'] as const
export type SubmitterRole = (typeof SUBMITTER_ROLES)[number]

export const SUBMITTER_ROLE_LABELS: Record<SubmitterRole, string> = {
  owner: '业主',
  property: '物业方',
  agency: '中介',
  operator: '联合办公运营方',
}

/** 出租方式（后台补录，前台不采集） */
export const LEASE_MODES = ['whole-floor', 'office', 'seat', 'sale'] as const
export type LeaseMode = (typeof LEASE_MODES)[number]

export const LEASE_MODE_LABELS: Record<LeaseMode, string> = {
  'whole-floor': '整层',
  office: '独立办公室',
  seat: '工位',
  sale: '出售',
}

/** 装修状况（后台补录，前台不采集） */
export const FITOUT_STATUSES = ['bare', 'simple', 'full', 'furnished'] as const
export type FitoutStatus = (typeof FITOUT_STATUSES)[number]

export const FITOUT_STATUS_LABELS: Record<FitoutStatus, string> = {
  bare: '毛坯',
  simple: '简装',
  full: '精装',
  furnished: '带家具',
}

/** 审单流程状态 */
export const SUPPLY_SUBMISSION_STATUSES = [
  'pending',
  'contacted',
  'converted',
  'rejected',
  'duplicate',
] as const
export type SupplySubmissionStatus = (typeof SUPPLY_SUBMISSION_STATUSES)[number]

export const SUPPLY_SUBMISSION_STATUS_LABELS: Record<SupplySubmissionStatus, string> = {
  pending: '待处理',
  contacted: '已联系',
  converted: '已转房源',
  rejected: '已拒绝',
  duplicate: '重复',
}

/** 字段限制 */
export const SUPPLY_LIMITS = {
  BUILDING_NAME_MAX: 100,
  ADDRESS_MAX: 200,
  REQUEST_ID_MAX: 100,
  SOURCE_PATH_MAX: 300,
  /** 单个物业可租面积上限（㎡）：只限制外部输入幅度，非业务上限 */
  AREA_MAX: 1_000_000,
  /** 报价上限：同上，仅防异常数值 */
  RENT_MAX: 10_000_000,
} as const

/** 校验通过后的投放房源请求 */
export type SupplySubmissionRequest = Readonly<{
  requestId: string
  buildingName: string
  address: string
  areaSqm: number
  rentAmount: number | null
  rentUnit: InquiryPriceUnit | null
  commissionMonths: CommissionMonths
  contactPhone: string
  phoneNormalized: string
  consent: Readonly<{ accepted: true; policyVersion: string }>
  source: Readonly<{ path: string }>
}>

export type SupplyValidationResult =
  | { ok: true; data: SupplySubmissionRequest }
  | { ok: false; errors: readonly string[] }

/**
 * 校验并标准化投放房源请求体（unknown 输入）。
 *
 * 错误码：
 *   - invalid_body
 *   - request_id_required / request_id_too_long
 *   - building_name_required / building_name_too_long
 *   - address_required / address_too_long
 *   - area_required / area_invalid
 *   - rent_amount_invalid / rent_unit_invalid
 *   - commission_invalid
 *   - phone_invalid
 *   - consent_required / consent_version_mismatch
 *   - source_required / source_path_required / source_path_too_long / source_path_invalid
 */
export function validateSupplySubmission(input: unknown): SupplyValidationResult {
  if (!isObject(input)) {
    return { ok: false, errors: ['invalid_body'] }
  }

  const errors: string[] = []

  const requestId = trimString(input.requestId)
  if (!requestId) errors.push('request_id_required')
  else if (requestId.length > SUPPLY_LIMITS.REQUEST_ID_MAX) errors.push('request_id_too_long')

  const buildingName = trimString(input.buildingName)
  if (!buildingName) errors.push('building_name_required')
  else if (buildingName.length > SUPPLY_LIMITS.BUILDING_NAME_MAX) {
    errors.push('building_name_too_long')
  }

  const address = trimString(input.address)
  if (!address) errors.push('address_required')
  else if (address.length > SUPPLY_LIMITS.ADDRESS_MAX) errors.push('address_too_long')

  // 面积：必填正数
  const areaSqm = toFiniteNumber(input.areaSqm)
  if (input.areaSqm === undefined || input.areaSqm === null || input.areaSqm === '') {
    errors.push('area_required')
  } else if (areaSqm === null || areaSqm <= 0 || areaSqm > SUPPLY_LIMITS.AREA_MAX) {
    errors.push('area_invalid')
  }

  // 租金：选填，给了金额就必须给合法单位
  let rentAmount: number | null = null
  let rentUnit: InquiryPriceUnit | null = null
  const hasRentAmount =
    input.rentAmount !== undefined && input.rentAmount !== null && input.rentAmount !== ''
  if (hasRentAmount) {
    const parsed = toFiniteNumber(input.rentAmount)
    if (parsed === null || parsed < 0 || parsed > SUPPLY_LIMITS.RENT_MAX) {
      errors.push('rent_amount_invalid')
    } else {
      rentAmount = parsed
    }
  }
  const rentUnitRaw = trimString(input.rentUnit)
  if (rentUnitRaw) {
    if (!isPriceUnit(rentUnitRaw)) errors.push('rent_unit_invalid')
    else rentUnit = rentUnitRaw
  } else if (rentAmount !== null) {
    // 有金额无单位：默认元/㎡/天（与表单默认选项一致）
    rentUnit = 'rmb-sqm-day'
  }

  // 佣金：选填，缺省 none
  const commissionRaw = trimString(input.commissionMonths)
  let commissionMonths: CommissionMonths = 'none'
  if (commissionRaw) {
    if (!isCommissionMonths(commissionRaw)) errors.push('commission_invalid')
    else commissionMonths = commissionRaw
  }

  const contactPhoneRaw = trimString(input.contactPhone)
  const phoneNormalized = contactPhoneRaw ? normalizePhone(contactPhoneRaw) : ''
  if (!phoneNormalized || !isValidCnMobile(phoneNormalized)) {
    errors.push('phone_invalid')
  }

  // 隐私同意（前台为"提交即授权"隐式形态，仍必须留痕政策版本）
  if (!isObject(input.consent)) {
    errors.push('consent_required')
  } else {
    if (input.consent.accepted !== true) errors.push('consent_required')
    const version = trimString(input.consent.policyVersion)
    if (!version) errors.push('consent_required')
    else if (version !== PRIVACY_POLICY_VERSION) errors.push('consent_version_mismatch')
  }

  // 来源路径
  let sourcePath = ''
  if (!isObject(input.source)) {
    errors.push('source_required')
  } else {
    const rawPath = trimString(input.source.path)
    if (!rawPath) errors.push('source_path_required')
    else if (rawPath.length > SUPPLY_LIMITS.SOURCE_PATH_MAX) errors.push('source_path_too_long')
    else {
      const normalized = normalizeSamePath(rawPath)
      if (!normalized) errors.push('source_path_invalid')
      else sourcePath = normalized
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    data: {
      requestId,
      buildingName,
      address,
      areaSqm: areaSqm as number,
      rentAmount,
      rentUnit,
      commissionMonths,
      contactPhone: contactPhoneRaw,
      phoneNormalized,
      consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
      source: { path: sourcePath },
    },
  }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function trimString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function isPriceUnit(v: string): v is InquiryPriceUnit {
  return (PRICE_UNITS as readonly string[]).includes(v)
}

function isCommissionMonths(v: string): v is CommissionMonths {
  return (COMMISSION_MONTHS as readonly string[]).includes(v)
}

/**
 * 归一化同源路径：必须以单个 '/' 开头，剥离 query/hash，拒绝控制字符与
 * 协议相对 URL（'//host'）。不合法返回 null。
 */
function normalizeSamePath(raw: string): string | null {
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(raw)) return null
  const withoutHash = raw.split('#')[0] ?? ''
  const pathname = withoutHash.split('?')[0] ?? ''
  if (!pathname.startsWith('/')) return null
  return pathname
}
```

- [x] **Step 4: 实现 `src/domain/supply-submission/idempotency.ts`**

```ts
/**
 * 投放房源幂等键计算
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.5
 *
 * 守护不变量：
 *   - 幂等键 = sha256(requestId | phoneNormalized | buildingName)；
 *   - 同一人重复提交同一楼盘（双击 / 刷新 / 网络重试）→ 同键 → 只建一条；
 *   - 同一人提交不同楼盘 → 不同键 → 各建一条（业主可能有多处房源）。
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { createHash } from 'node:crypto'

/** 异步版本（Web Crypto），路由中使用。返回 64 字符 hex。 */
export async function computeSupplyIdempotencyKey(
  requestId: string,
  phoneNormalized: string,
  buildingName: string,
): Promise<string> {
  const raw = `${requestId}|${phoneNormalized}|${buildingName}`
  const buf = new TextEncoder().encode(raw)
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  return bufferToHex(hashBuf)
}

/** 同步版本（node:crypto），测试与非异步上下文使用。 */
export function computeSupplyIdempotencyKeySync(
  requestId: string,
  phoneNormalized: string,
  buildingName: string,
): string {
  const raw = `${requestId}|${phoneNormalized}|${buildingName}`
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}
```

- [x] **Step 5: 实现 `src/domain/supply-submission/privacy-log.ts`**

```ts
/**
 * 投放房源隐私安全日志
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.5
 *
 * 守护不变量：
 *   - 日志不含手机号（原文或标准化）、楼盘名、详细地址；
 *   - 日志不含原始 IP（限流键与 submitterIpHash 都用哈希）；
 *   - 仅记 requestId、枚举、字段完整度布尔、错误码、耗时。
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { createHash } from 'node:crypto'
import type { SupplySubmissionRequest } from './schema'

export type SupplySubmissionLogEntry = Readonly<{
  requestId: string
  /** 面积区间桶（不记精确值也足以分析供给结构） */
  areaBucket: string
  /** 是否填了租金 */
  hasRent: boolean
  /** 租金单位枚举（无则 null） */
  rentUnit: string | null
  /** 佣金悬赏枚举 */
  commissionMonths: string
  /** 来源路径（同源 pathname，无 query） */
  sourcePath: string
  idempotent: boolean
  errorCode: string | null
  durationMs: number
}>

/** 面积分桶：避免精确面积间接定位具体物业。 */
function areaBucketOf(areaSqm: number): string {
  if (areaSqm < 100) return '<100'
  if (areaSqm < 300) return '100-300'
  if (areaSqm < 1000) return '300-1000'
  if (areaSqm < 3000) return '1000-3000'
  return '>=3000'
}

export function buildSupplyLogEntry(
  req: SupplySubmissionRequest,
  opts: Readonly<{ idempotent: boolean; errorCode: string | null; durationMs: number }>,
): SupplySubmissionLogEntry {
  return {
    requestId: req.requestId,
    areaBucket: areaBucketOf(req.areaSqm),
    hasRent: req.rentAmount !== null,
    rentUnit: req.rentUnit,
    commissionMonths: req.commissionMonths,
    sourcePath: req.source.path,
    idempotent: opts.idempotent,
    errorCode: opts.errorCode,
    durationMs: opts.durationMs,
  }
}

/**
 * 清洗 IP：返回带日级盐的哈希（不保存原始 IP）。
 * 算法与 domain/inquiry、domain/corrections 的同名函数一致（sha256(salt|ip).slice(0,32)）。
 */
export function hashIpForLog(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}|${ip}`, 'utf8').digest('hex').slice(0, 32)
}
```

- [x] **Step 6: 实现 `src/domain/supply-submission/index.ts`**

```ts
/**
 * domain/supply-submission 桶文件（投放房源提交）
 *
 * 对外只暴露纯函数与类型；集合 hook 由 collections/SupplySubmissions.ts 直接引用。
 */

export {
  COMMISSION_MONTHS,
  COMMISSION_MONTHS_LABELS,
  FITOUT_STATUS_LABELS,
  FITOUT_STATUSES,
  LEASE_MODE_LABELS,
  LEASE_MODES,
  SUBMITTER_ROLE_LABELS,
  SUBMITTER_ROLES,
  SUPPLY_LIMITS,
  SUPPLY_SUBMISSION_STATUS_LABELS,
  SUPPLY_SUBMISSION_STATUSES,
  validateSupplySubmission,
  type CommissionMonths,
  type FitoutStatus,
  type LeaseMode,
  type SubmitterRole,
  type SupplySubmissionRequest,
  type SupplySubmissionStatus,
  type SupplyValidationResult,
} from './schema'

export {
  computeSupplyIdempotencyKey,
  computeSupplyIdempotencyKeySync,
} from './idempotency'

export {
  buildSupplyLogEntry,
  hashIpForLog,
  type SupplySubmissionLogEntry,
} from './privacy-log'
```

- [x] **Step 7: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm vitest run tests/supply-submission-domain.test.ts
```

Expected: PASS（全部用例）

- [x] **Step 8: 类型检查并提交**

```bash
cd payload-office-platform && pnpm typecheck
```

```bash
git add payload-office-platform/src/domain/supply-submission payload-office-platform/tests/supply-submission-domain.test.ts
git commit -m "feat(supply): 投放房源提交 schema/幂等/日志纯函数

白名单收窄 6 个前台字段，流程字段一律丢弃；佣金存枚举避免 0 与未填歧义；
日志按面积分桶且不含手机号/楼盘名/地址/原始 IP。"
```

---

## Task 3: `SupplySubmissions` 集合 + 权限编码 + 全部 schema 变更与迁移

> **状态：** ✅ 已完成（commit 5836f1c，含 1 轮修复，review 通过，2418 单测全绿）

**Files:**
- Create: `src/collections/SupplySubmissions.ts`
- Create: `src/domain/supply-submission/submission-protect.ts`
- Modify: `src/domain/auth/permission-codes.ts`
- Modify: `src/domain/admin-navigation/navigation-config.ts`
- Modify: `src/collections/Leads.ts`（`INQUIRY_SOURCE_PAGE_TYPES` 加 `'entrust'`）
- Modify: `src/collections/Notifications.ts`（两个枚举各加 1 值）
- Modify: `src/payload.config.ts`
- Create: `src/migrations/<generated>.ts` + `.json`（CLI 生成）

**Interfaces:**
- Consumes: Task 2 的 `SUPPLY_SUBMISSION_STATUSES` / `SUBMITTER_ROLES` / `LEASE_MODES` / `FITOUT_STATUSES` / `COMMISSION_MONTHS` 及各 `*_LABELS`、`PRICE_UNITS`
- Produces:
  - Collection slug `'supply-submissions'`
  - `protectSupplySubmission: CollectionBeforeChangeHook`
  - 权限编码 `supply-submissions`(MENU)、`supply_submission:read` / `supply_submission:manage` / `supply_submission:convert`(OPERATION)
  - `Notifications` 新增 `type` 值 `supply-submission-created`、`sourceType` 值 `supply-submission`

- [x] **Step 1: 实现保护 hook `src/domain/supply-submission/submission-protect.ts`**

```ts
/**
 * 投放房源申请保护 hook
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.3 / §5.5
 *
 * 守护不变量：
 *   - create：强制 status='pending'、handledAt=null，忽略外部传入；
 *   - update：提交事实字段（楼盘名/地址/面积/租金/佣金/手机号/溯源/同意）不可改，恢复原值；
 *     只允许后台补录字段与流程字段变更；
 *   - status 流转到终态（converted/rejected/duplicate）时自动补 handledAt。
 *
 * 与 access 叠加：access.create 公开、access.update 需 supply_submission:manage、
 * access.delete=false；protect 在 beforeChange 兜底，挡 Local API overrideAccess 绕过。
 */

import type { CollectionBeforeChangeHook } from 'payload'

/** 提交事实字段：创建后不可改 */
const IMMUTABLE_FIELDS = [
  'buildingName',
  'address',
  'areaSqm',
  'rentAmount',
  'rentUnit',
  'commissionMonths',
  'contactPhone',
  'requestId',
  'idempotencyKey',
  'sourcePath',
  'sourceUrl',
  'consentAccepted',
  'consentPolicyVersion',
  'submitterIpHash',
] as const

/** 需要写 handledAt 的终态 */
const TERMINAL_STATUSES = new Set(['converted', 'rejected', 'duplicate'])

export const protectSupplySubmission: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
}) => {
  const next = (data ?? {}) as Record<string, unknown>

  if (operation === 'create') {
    return { ...next, status: 'pending', handledAt: null }
  }

  const prev = (originalDoc ?? null) as Record<string, unknown> | null
  const fixed: Record<string, unknown> = { ...next }
  if (prev) {
    for (const field of IMMUTABLE_FIELDS) {
      if (field in prev) fixed[field] = prev[field]
    }
  }

  const nextStatus = typeof fixed.status === 'string' ? fixed.status : null
  const prevStatus = prev && typeof prev.status === 'string' ? prev.status : null
  if (nextStatus && nextStatus !== prevStatus && TERMINAL_STATUSES.has(nextStatus)) {
    fixed.handledAt = new Date().toISOString()
  }

  return fixed
}
```

- [x] **Step 2: 注册权限编码**

在 `src/domain/auth/permission-codes.ts` 的 `MENU_CODES` 里，`'reports'` 一行之后加：

```ts
  // 供给投放（委托找房/投放房源 PRD §5.6）
  'supply-submissions',
```

在 `OPERATION_CODES` 里，`'correction:manage',` 之后加：

```ts
  // 投放房源审单（委托找房/投放房源 PRD §5.6）
  'supply_submission:read', // 读取投放申请列表 / 详情
  'supply_submission:manage', // 流转状态 / 补录字段
  'supply_submission:convert', // 转为房源草稿
```

- [x] **Step 3: 创建集合 `src/collections/SupplySubmissions.ts`**

```ts
import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import { PRICE_UNITS } from '@/domain/inquiry/schema'
import { protectSupplySubmission } from '@/domain/supply-submission/submission-protect'
import {
  COMMISSION_MONTHS,
  COMMISSION_MONTHS_LABELS,
  FITOUT_STATUS_LABELS,
  FITOUT_STATUSES,
  LEASE_MODE_LABELS,
  LEASE_MODES,
  SUBMITTER_ROLE_LABELS,
  SUBMITTER_ROLES,
  SUPPLY_LIMITS,
  SUPPLY_SUBMISSION_STATUS_LABELS,
  SUPPLY_SUBMISSION_STATUSES,
} from '@/domain/supply-submission/schema'

/** 价格单位中文标签（与 C 端展示口径一致） */
const PRICE_UNIT_LABELS: Record<(typeof PRICE_UNITS)[number], string> = {
  'rmb-sqm-day': '元/㎡/天',
  'rmb-month': '元/月',
  'rmb-seat-month': '元/工位/月',
  'rmb-total': '元/总价',
}

/**
 * 房源投放申请（委托找房/投放房源 PRD §5.3）
 *
 * 业务不变量：
 *   - 提交事实字段 append-only：创建后不可改（protect hook 兜底）、不可删除（access.delete=false）；
 *   - 前台只能写 6 个提交字段 + 溯源/同意；后台补录字段与流程字段外部不可写；
 *   - 幂等键唯一索引兜底：同 requestId + 手机号 + 楼盘名只留一条；
 *   - 审单动作（转房源草稿 / 拒绝）由后台 supply_submission:manage / :convert 操作。
 *
 * 权限：
 *   - read：supply_submission:read
 *   - create：公开（任何人都可提交投放申请）
 *   - update：supply_submission:manage
 *   - delete：禁止（审计轨迹）
 */
export const SupplySubmissions: CollectionConfig = {
  slug: 'supply-submissions',
  labels: {
    singular: '投放申请',
    plural: '房源投放申请',
  },
  admin: {
    group: false,
    useAsTitle: 'buildingName',
    defaultColumns: [
      'buildingName',
      'address',
      'areaSqm',
      'rentAmount',
      'commissionMonths',
      'status',
      'createdAt',
    ],
    description:
      '业主/物业/中介从 /publish 提交的房源投放申请。提交事实不可改、不可删；status 由后台流转，可转为房源草稿。',
  },
  access: {
    ...createCollectionAccess({
      read: 'supply_submission:read',
      update: 'supply_submission:manage',
    }),
    // create 公开：任何人都可提交投放申请（字段白名单由端点 schema 收窄）
    create: () => true,
    // 只追加：禁止删除（审计轨迹）
    delete: () => false,
  },
  hooks: {
    beforeChange: [protectSupplySubmission],
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: '提交内容',
          description: '前台 /publish 提交的房源信息，创建后不可修改。',
          fields: [
            {
              name: 'buildingName',
              label: '楼盘名称',
              type: 'text',
              required: true,
              index: true,
              maxLength: SUPPLY_LIMITS.BUILDING_NAME_MAX,
            },
            {
              name: 'address',
              label: '详细地址',
              type: 'text',
              required: true,
              maxLength: SUPPLY_LIMITS.ADDRESS_MAX,
              admin: { description: '楼号/单元号/房间号。' },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'areaSqm',
                  label: '出租面积(㎡)',
                  type: 'number',
                  required: true,
                  min: 0,
                },
                {
                  name: 'commissionMonths',
                  label: '佣金悬赏',
                  type: 'select',
                  required: true,
                  defaultValue: 'none',
                  index: true,
                  options: COMMISSION_MONTHS.map((value) => ({
                    value,
                    label: COMMISSION_MONTHS_LABELS[value],
                  })),
                  admin: { description: '业主愿意悬赏的佣金月数，成交后支付。有悬赏的申请优先处理。' },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'rentAmount', label: '期望租金', type: 'number', min: 0 },
                {
                  name: 'rentUnit',
                  label: '租金单位',
                  type: 'select',
                  options: PRICE_UNITS.map((value) => ({
                    value,
                    label: PRICE_UNIT_LABELS[value],
                  })),
                },
              ],
            },
            {
              name: 'contactPhone',
              label: '联系手机号',
              type: 'text',
              required: true,
              index: true,
            },
          ],
        },
        {
          label: '审单与补录',
          description: '顾问电话确认后补录的信息，以及审单流程字段。',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'status',
                  label: '处理状态',
                  type: 'select',
                  required: true,
                  defaultValue: 'pending',
                  index: true,
                  options: SUPPLY_SUBMISSION_STATUSES.map((value) => ({
                    value,
                    label: SUPPLY_SUBMISSION_STATUS_LABELS[value],
                  })),
                },
                {
                  name: 'assignee',
                  label: '跟进人',
                  type: 'relationship',
                  relationTo: 'users',
                },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'contactName', label: '联系人', type: 'text', maxLength: 50 },
                { name: 'companyName', label: '公司名称', type: 'text', maxLength: 100 },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'submitterRole',
                  label: '提交人身份',
                  type: 'select',
                  options: SUBMITTER_ROLES.map((value) => ({
                    value,
                    label: SUBMITTER_ROLE_LABELS[value],
                  })),
                },
                {
                  name: 'leaseMode',
                  label: '出租方式',
                  type: 'select',
                  options: LEASE_MODES.map((value) => ({
                    value,
                    label: LEASE_MODE_LABELS[value],
                  })),
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'fitoutStatus',
                  label: '装修状况',
                  type: 'select',
                  options: FITOUT_STATUSES.map((value) => ({
                    value,
                    label: FITOUT_STATUS_LABELS[value],
                  })),
                },
                {
                  name: 'availableFrom',
                  label: '可入驻时间',
                  type: 'date',
                  admin: { date: { pickerAppearance: 'dayOnly' } },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'city',
                  label: '城市',
                  type: 'relationship',
                  relationTo: 'locations',
                  filterOptions: () => activeLocationFilter(['city']),
                },
                {
                  name: 'district',
                  label: '区域/商圈',
                  type: 'relationship',
                  relationTo: 'locations',
                },
              ],
            },
            { name: 'description', label: '房源补充说明', type: 'textarea', maxLength: 1000 },
            { name: 'reviewNote', label: '审核备注 / 拒绝原因', type: 'textarea' },
            {
              type: 'row',
              fields: [
                {
                  name: 'matchedBuilding',
                  label: '匹配到的楼盘',
                  type: 'relationship',
                  relationTo: 'buildings',
                },
                {
                  name: 'convertedListing',
                  label: '转出的房源',
                  type: 'relationship',
                  relationTo: 'listings',
                },
              ],
            },
            {
              name: 'handledAt',
              label: '处理时间',
              type: 'date',
              admin: { readOnly: true, description: '状态流转到终态时自动写入。' },
            },
          ],
        },
        {
          label: '溯源与合规',
          description: '服务端写入，前台不可指定，后台只读。',
          fields: [
            {
              name: 'requestId',
              label: '请求 ID',
              type: 'text',
              required: true,
              maxLength: SUPPLY_LIMITS.REQUEST_ID_MAX,
              admin: { readOnly: true },
            },
            {
              name: 'idempotencyKey',
              label: '幂等键',
              type: 'text',
              required: true,
              unique: true,
              index: true,
              admin: {
                readOnly: true,
                description: 'requestId + 标准化手机号 + 楼盘名 的哈希。唯一约束防并发重复。',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'sourcePath',
                  label: '入口路径',
                  type: 'text',
                  admin: { readOnly: true, description: '同源 pathname，不含查询参数。' },
                },
                {
                  name: 'sourceUrl',
                  label: '入口 URL',
                  type: 'text',
                  admin: { readOnly: true },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'consentAccepted',
                  label: '已同意隐私政策',
                  type: 'checkbox',
                  admin: { readOnly: true },
                },
                {
                  name: 'consentPolicyVersion',
                  label: '同意的政策版本',
                  type: 'text',
                  admin: { readOnly: true },
                },
              ],
            },
            {
              name: 'submitterIpHash',
              label: '提交 IP 哈希',
              type: 'text',
              admin: { readOnly: true, description: '反垃圾用，不存原始 IP。' },
            },
          ],
        },
      ],
    },
  ],
}
```

- [x] **Step 4: 注册到 `payload.config.ts`**

在 import 区 `import { InformationCorrections } from './collections/InformationCorrections'`（`:44`）之后加：

```ts
import { SupplySubmissions } from './collections/SupplySubmissions'
```

在 `collections: [...]` 数组里 `InformationCorrections,`（`:176`）之后加：

```ts
    SupplySubmissions,
```

- [x] **Step 5: 后台导航加入口**

在 `src/domain/admin-navigation/navigation-config.ts` 的 `group('supply', '房源运营', 'building', [...])` 数组里，`leaf('buildings', ...)` 之后加：

```ts
    leaf('supply-submissions', '房源投放申请', '/admin/collections/supply-submissions', [
      'supply-submissions',
    ], {
      collectionSlug: 'supply-submissions',
      requiredOperationCode: 'supply_submission:read',
    }),
```

- [x] **Step 6: `Leads` 来源枚举加 `entrust`**

在 `src/collections/Leads.ts` 的 `INQUIRY_SOURCE_PAGE_TYPES`（`:19-25`）里，`'content',` 之后加一行，并在其上方注释块补一行说明：

```ts
 * - entrust：委托找房落地页零门槛留电（只采集手机号）
```

```ts
  'entrust',
```

- [x] **Step 7: 通知枚举加值**

枚举定义在 `src/domain/workflow/notification-types.ts`（**不在集合文件内**，集合通过 map 自动跟随）。

`NOTIFICATION_TYPES`（`:26-33`）的 `'task-cancelled',` 之后加：

```ts
  'supply-submission-created',
```

`NOTIFICATION_TYPE_LABELS`（`:38-45`）里加：

```ts
  'supply-submission-created': '新的房源投放申请',
```

`NOTIFICATION_SOURCE_TYPES`（`:60-65`）的 `'task',` 之后加：

```ts
  'supply-submission',
```

`NOTIFICATION_SOURCE_TYPE_LABELS`（`:71-78`）里加：

```ts
  'supply-submission': '房源投放申请',
```

- [x] **Step 8: 生成迁移**

确认 `.env.local` 里 `DATABASE_URL` 指向本工作树独立库（如 `postgres://.../sbh_dev_entrust`），然后：

```bash
cd payload-office-platform && pnpm payload migrate:create supply_submissions_and_entrust_source
```

Expected: 在 `src/migrations/` 生成一对 `<timestamp>_supply_submissions_and_entrust_source.ts` / `.json`，内容包含 `supply_submissions` 建表、`idempotency_key` 唯一索引、`leads.source_page_type` 与两个 notifications 枚举的新值。**不要手改生成的文件正文。**

- [x] **Step 9: 应用迁移并验证可重放**

```bash
cd payload-office-platform && pnpm payload migrate && pnpm migrate:status
```

Expected: 迁移状态显示新迁移已应用，无 pending。

- [x] **Step 10: 类型检查 + 全量单测**

```bash
cd payload-office-platform && pnpm generate:types && pnpm typecheck && pnpm test
```

Expected: `payload-types.ts` 重新生成后类型检查通过；单测全绿（含权限编码注册表相关测试）。

> **注意**：`payload-types.ts` 是生成物且已取消 git 跟踪，**不要提交它**。若生成时报缺 COS 配置，先补齐 `.env.local` 的 COS 变量再生成，避免 `Media.prefix` 被误删。

- [x] **Step 11: 提交**

```bash
git add payload-office-platform/src/collections/SupplySubmissions.ts payload-office-platform/src/domain/supply-submission/submission-protect.ts payload-office-platform/src/domain/auth/permission-codes.ts payload-office-platform/src/domain/admin-navigation/navigation-config.ts payload-office-platform/src/collections/Leads.ts payload-office-platform/src/collections/Notifications.ts payload-office-platform/src/payload.config.ts payload-office-platform/src/migrations
git commit -m "feat(supply): 新增 SupplySubmissions 集合与投放审单权限

提交事实 append-only、幂等键唯一索引、后台三 tab（提交内容/审单补录/溯源合规）；
注册 1 个菜单 + 3 个操作编码并接入后台导航；
Leads 来源枚举加 entrust，Notifications 加投放申请通知枚举；一次迁移覆盖全部 schema 变更。"
```

---

## Task 4: `/api/supply-submissions` 公开端点

**Files:**
- Create: `src/app/api/supply-submissions/route.ts`
- Create: `src/app/api/supply-submissions/request-guards.ts`
- Create: `src/app/api/supply-submissions/rate-limit-state.ts`
- Create: `tests/supply-submission-api-guards.test.ts`
- Create: `tests/supply-submission-api-route.test.ts`
- Modify: `src/lib/rate-limit-config.ts`

**Interfaces:**
- Consumes: Task 2 的 `validateSupplySubmission` / `computeSupplyIdempotencyKey` / `buildSupplyLogEntry` / `hashIpForLog`、Task 3 的 collection slug `'supply-submissions'`
- Produces: `POST /api/supply-submissions`，响应形状 `{ ok: true }` | `{ ok: false, errors: string[] }` | `{ ok: false, error: string }`；`rate-limit-state.ts` 导出 `__resetRateStoreForTests()`，route 模块不额外导出测试 helper。

- [x] **Step 1: 加限流配置**

在 `src/lib/rate-limit-config.ts` 末尾追加：

```ts
/**
 * 投放房源端点限流配置：每 IP 每分钟 3 次。
 *
 * 业主提交频率天然很低（一处房源提交一次），配额与纠错端点一致。
 * 与 INQUIRY_RATE_LIMIT_CONFIG 共享 inquiry_rate_limit 表，但限流键加
 * 'supply:' 前缀（见 api/supply-submissions/route.ts），配额互不影响。
 */
export const SUPPLY_SUBMISSION_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,
  max: 3,
  maxKeys: 100_000,
  pruneIntervalMs: 5 * 60_000,
  failOpen: true,
}
```

- [x] **Step 2: 实现路由**

创建 `src/app/api/supply-submissions/route.ts`：

```ts
/**
 * 投放房源提交 API 路由（/api/supply-submissions）
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.5
 *
 * 守护不变量（与 /api/corrections、/api/inquiries 同构）：
 *   - 仅接受 POST + application/json + 同源请求；
 *   - 请求体视为 unknown，由 domain/supply-submission/schema 白名单收窄；
 *   - body 大小上限 16KB；
 *   - 幂等键 = sha256(requestId | phoneNormalized | buildingName)；命中 → 返回首次成功语义；
 *   - 限流：每 IP 每分钟 3 次，429 + Retry-After，不记录完整 IP；
 *   - 日志：buildSupplyLogEntry，不含手机号/楼盘名/地址/原始 IP；
 *   - 城市固定写入默认城市（MVP 单城，前台不采集）；
 *   - 不暴露记录 ID、内部错误。
 */

import { getPayload, type Payload } from 'payload'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import {
  buildSupplyLogEntry,
  computeSupplyIdempotencyKey,
  hashIpForLog,
  validateSupplySubmission,
  type SupplySubmissionRequest,
} from '@/domain/supply-submission'
import { runDistributedRateLimit, type PruneTimestampRef } from '@/lib/rate-limit-distributed'
import { createPgRateLimitDeps, type PoolLike } from '@/lib/rate-limit-pg'
import { SUPPLY_SUBMISSION_RATE_LIMIT_CONFIG as RATE_LIMIT_CONFIG } from '@/lib/rate-limit-config'
import { siteConfig } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 每请求 body 最大字节数 */
const MAX_BODY_BYTES = 16 * 1024

/** 跨请求共享的 TTL 清理时间戳（模块级）。 */
const ratePruneRef: PruneTimestampRef = { value: 0 }

/** 提取客户端 IP（CloudRun / 反代场景取首跳） */
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** 日级盐：UTC 日期字符串，同一天内进程内哈希稳定，跨天自动轮换。 */
function getDailySalt(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 同源校验：Origin 必须与 Host 同源 */
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (!origin || !host) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Content-Type 校验：必须为 application/json */
function isJsonContentType(req: Request): boolean {
  return (req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error
  for (let depth = 0; depth < 5 && candidate && typeof candidate === 'object'; depth += 1) {
    const record = candidate as Record<string, unknown>
    const marker = [record.constraint, record.detail, record.message]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
      .toLowerCase()
    if (
      record.code === '23505' &&
      (marker.includes('supply_submissions') || marker.includes('idempotency_key'))
    ) {
      return true
    }
    candidate = record.cause
  }
  return false
}

function logIdempotentSuccess(
  payload: Payload,
  submission: SupplySubmissionRequest,
  startedAt: number,
): Response {
  payload.logger.info(
    buildSupplyLogEntry(submission, {
      idempotent: true,
      errorCode: null,
      durationMs: Date.now() - startedAt,
    }),
    'supply_submission_idempotent_hit',
  )
  return NextResponse.json({ ok: true })
}

/** 解析默认城市 Location（MVP 单城；解析失败不阻断提交） */
async function resolveDefaultCityId(payload: Payload): Promise<number | string | null> {
  try {
    const result = await payload.find({
      collection: 'locations',
      where: { slug: { equals: siteConfig.defaultCity } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    return result.docs[0]?.id ?? null
  } catch {
    return null
  }
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now()
  const ip = clientIp(req)
  const ipHash = hashIpForLog(ip, getDailySalt())
  // 限流键加 'supply:' 前缀，与询盘/纠错配额隔离（共享 inquiry_rate_limit 表）
  const rateKey = `supply:${ipHash}`

  // ----- 1. 限流 -----
  const payload = await getPayload({ config })
  const pgDeps = createPgRateLimitDeps((payload.db as unknown as { pool: PoolLike }).pool)
  const rate = await runDistributedRateLimit(pgDeps, RATE_LIMIT_CONFIG, rateKey, ratePruneRef)
  if (rate.failedOpen) {
    payload.logger.warn({ rateKey }, 'rate_limit_store_unavailable_fail_open')
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    )
  }

  // ----- 2. 同源 / Content-Type / body 大小 -----
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  if (!isJsonContentType(req)) {
    return NextResponse.json({ ok: false, errors: ['invalid_content_type'] }, { status: 415 })
  }
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, errors: ['body_too_large'] }, { status: 413 })
  }

  // ----- 3. 解析 body -----
  let body: unknown
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, errors: ['body_too_large'] }, { status: 413 })
    }
    body = raw === '' ? null : JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, errors: ['invalid_json'] }, { status: 400 })
  }

  // ----- 4. schema 白名单校验 -----
  const result = validateSupplySubmission(body)
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 })
  }
  const submission: SupplySubmissionRequest = result.data

  // ----- 5. 幂等键 -----
  const idempotencyKey = await computeSupplyIdempotencyKey(
    submission.requestId,
    submission.phoneNormalized,
    submission.buildingName,
  )

  // ----- 6. 幂等检查 -----
  try {
    const existing = await payload.find({
      collection: 'supply-submissions',
      where: { idempotencyKey: { equals: idempotencyKey } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      return logIdempotentSuccess(payload, submission, startedAt)
    }
  } catch (e) {
    payload.logger.error({ err: e }, 'supply_submission_idempotency_check_failed')
    // 幂等检查失败时继续创建：unique 约束兜底
  }

  // ----- 7. 创建申请 -----
  try {
    const cityId = await resolveDefaultCityId(payload)
    await payload.create({
      collection: 'supply-submissions',
      data: {
        buildingName: submission.buildingName,
        address: submission.address,
        areaSqm: submission.areaSqm,
        rentAmount: submission.rentAmount ?? undefined,
        rentUnit: submission.rentUnit ?? undefined,
        commissionMonths: submission.commissionMonths,
        contactPhone: submission.contactPhone,
        status: 'pending',
        city: cityId ?? undefined,
        requestId: submission.requestId,
        idempotencyKey,
        sourcePath: submission.source.path,
        sourceUrl: `${siteConfig.siteOrigin}${submission.source.path}`,
        consentAccepted: submission.consent.accepted,
        consentPolicyVersion: submission.consent.policyVersion,
        submitterIpHash: ipHash,
      },
      overrideAccess: true,
    })

    payload.logger.info(
      buildSupplyLogEntry(submission, {
        idempotent: false,
        errorCode: null,
        durationMs: Date.now() - startedAt,
      }),
      'supply_submission_success',
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (isIdempotencyUniqueViolation(e)) {
      return logIdempotentSuccess(payload, submission, startedAt)
    }
    payload.logger.error({ err: e }, 'supply_submission_create_failed')
    payload.logger.info(
      buildSupplyLogEntry(submission, {
        idempotent: false,
        errorCode: 'server_error',
        durationMs: Date.now() - startedAt,
      }),
      'supply_submission_error',
    )
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 })
  }
}

/** 其他方法禁止 */
export function GET(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

export function PUT(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

export function DELETE(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

/** 测试专用：重置模块级限流清理时间戳。生产代码不调用。 */
export function __resetRateStoreForTests(): void {
  ratePruneRef.value = 0
}
```

- [x] **Step 3: 类型检查**

```bash
cd payload-office-platform && pnpm typecheck
```

Expected: 通过（无输出）

- [x] **Step 4: 起本地服务做烟测**

```bash
cd payload-office-platform && PORT=3719 pnpm dev
```

另开一个终端，先验证成功路径（`policyVersion` 用 `site-config.ts` 里的当前值 `MVP-R1`）：

```bash
curl -s -X POST http://localhost:3719/api/supply-submissions -H 'content-type: application/json' -d '{"requestId":"smoke-1","buildingName":"烟测楼盘","address":"1 号楼 5 层","areaSqm":180,"rentAmount":7.5,"rentUnit":"rmb-sqm-day","commissionMonths":"1","contactPhone":"13800001111","consent":{"accepted":true,"policyVersion":"MVP-R1"},"source":{"path":"/publish"}}'
```

Expected: `{"ok":true}`

再用同一 body 重发一次验证幂等（应仍返回 `{"ok":true}`，且后台只有一条记录）：

```bash
curl -s -X POST http://localhost:3719/api/supply-submissions -H 'content-type: application/json' -d '{"requestId":"smoke-1","buildingName":"烟测楼盘","address":"1 号楼 5 层","areaSqm":180,"rentAmount":7.5,"rentUnit":"rmb-sqm-day","commissionMonths":"1","contactPhone":"13800001111","consent":{"accepted":true,"policyVersion":"MVP-R1"},"source":{"path":"/publish"}}'
```

Expected: `{"ok":true}`

再验证校验失败与方法限制：

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3719/api/supply-submissions -H 'content-type: application/json' -d '{"requestId":"smoke-2","buildingName":"","address":"","contactPhone":"123","consent":{"accepted":false,"policyVersion":"MVP-R1"},"source":{"path":"/publish"}}'
```

Expected: `422`

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3719/api/supply-submissions
```

Expected: `405`

- [x] **Step 5: 提交**

```bash
git add payload-office-platform/src/app/api/supply-submissions/route.ts payload-office-platform/src/lib/rate-limit-config.ts
git commit -m "feat(supply): 新增 /api/supply-submissions 公开提交端点

与 /api/corrections 同构：同源+CT+16KB 上限、schema 白名单、幂等键唯一索引兜底、
每 IP 每分钟 3 次限流（supply: 前缀独立配额）、日志不含 PII；城市按 MVP 单城固定写入。"
```

---

## Task 5: 委托找房链路（`entrust` 来源 + 无姓名兜底）

**Files:**
- Modify: `src/domain/inquiry/schema.ts`
- Create: `src/domain/inquiry/entrust-name-fallback.ts`
- Modify: `src/collections/Leads.ts`（挂 `beforeValidate` hook）
- Test: `tests/inquiry-domain.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 3 已把 `'entrust'` 加进 `INQUIRY_SOURCE_PAGE_TYPES`（DB 枚举迁移已生成）
- Produces:
  - `SOURCE_PAGE_TYPES` 含 `'entrust'`
  - `validateInquiry` 在 `source.pageType === 'entrust'` 时允许省略 `name`（返回空串）
  - `fillEntrustLeadName: CollectionBeforeValidateHook`

- [x] **Step 1: 追加失败测试**

在 `tests/inquiry-domain.test.ts` 末尾追加（import 区按需补 `fillEntrustLeadName`）：

```ts
// ---------------------------------------------------------------------------
// 委托找房落地页（PRD §4.3 / §4.4）
// ---------------------------------------------------------------------------

describe('validateInquiry - entrust 渠道', () => {
  /** 委托找房首屏只采集手机号，没有姓名字段 */
  const entrustBody = {
    phone: '13800001111',
    requestId: 'entrust-1',
    targetType: 'none',
    consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
    source: { pageType: 'entrust', path: '/entrust' },
  }

  it('缺姓名也通过，name 归一化为空串', () => {
    const r = validateInquiry(entrustBody)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.name).toBe('')
    expect(r.data.source.pageType).toBe('entrust')
    expect(r.data.targetType).toBe('none')
  })

  it('其他渠道缺姓名仍报 name_required', () => {
    const r = validateInquiry({
      ...entrustBody,
      source: { pageType: 'home', path: '/' },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('name_required')
  })

  it('entrust 渠道手机号非法仍被拒', () => {
    const r = validateInquiry({ ...entrustBody, phone: '123' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toContain('phone_invalid')
  })

  it('entrust 渠道未同意隐私政策仍被拒', () => {
    const r = validateInquiry({
      ...entrustBody,
      consent: { accepted: false, policyVersion: PRIVACY_POLICY_VERSION },
    })
    expect(r.ok).toBe(false)
  })
})

describe('fillEntrustLeadName', () => {
  it('entrust 渠道且无姓名时填兜底姓名（含手机号后四位）', async () => {
    const data = await fillEntrustLeadName({
      data: { phone: '13800001111', sourcePageType: 'entrust' },
      operation: 'create',
      req: {} as never,
      collection: {} as never,
      context: {} as never,
    } as never)
    expect((data as { name: string }).name).toBe('未留姓名（1111）')
  })

  it('已有姓名时不覆盖', async () => {
    const data = await fillEntrustLeadName({
      data: { name: '张先生', phone: '13800001111', sourcePageType: 'entrust' },
      operation: 'create',
      req: {} as never,
      collection: {} as never,
      context: {} as never,
    } as never)
    expect((data as { name: string }).name).toBe('张先生')
  })

  it('非 entrust 渠道不填兜底姓名', async () => {
    const data = await fillEntrustLeadName({
      data: { phone: '13800001111', sourcePageType: 'listing' },
      operation: 'create',
      req: {} as never,
      collection: {} as never,
      context: {} as never,
    } as never)
    expect((data as { name?: string }).name).toBeUndefined()
  })

  it('手机号缺失时用固定兜底文案，不抛异常', async () => {
    const data = await fillEntrustLeadName({
      data: { sourcePageType: 'entrust' },
      operation: 'create',
      req: {} as never,
      collection: {} as never,
      context: {} as never,
    } as never)
    expect((data as { name: string }).name).toBe('未留姓名')
  })
})
```

在该测试文件的 import 区补：

```ts
import { fillEntrustLeadName } from '@/domain/inquiry/entrust-name-fallback'
```

（`PRIVACY_POLICY_VERSION` 与 `validateInquiry` 该文件已有 import；若没有则补 `import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'`。）

- [x] **Step 2: 跑测试确认失败**

```bash
cd payload-office-platform && pnpm vitest run tests/inquiry-domain.test.ts
```

Expected: FAIL — 无法解析 `@/domain/inquiry/entrust-name-fallback`；且 entrust 缺姓名用例报 `name_required`

- [x] **Step 3: 改 `src/domain/inquiry/schema.ts`**

3a. `SOURCE_PAGE_TYPES`（`:21-23` 附近）加 `'entrust'`，并更新其上方注释：

```ts
/** 入口页面类型（与 Leads Collection INQUIRY_SOURCE_PAGE_TYPES 对齐） */
export const SOURCE_PAGE_TYPES = [
  'home',
  'search',
  'listing',
  'building',
  'content',
  'entrust',
] as const
```

3b. 在 `validateInquiry` 里，把 `:159-161` 的姓名校验替换为（新增 `entrustChannel` 判定，其余不动）：

```ts
  // ----- 必填字段 -----
  // 委托找房落地页（source.pageType='entrust'）首屏只采集手机号，没有姓名输入框；
  // 该渠道允许省略姓名，落库时由 Leads 的 fillEntrustLeadName hook 兜底填充
  // （PRD §4.3 冲突 1：不放宽 Leads.name 的 required，后台视图依赖它非空）。
  const entrustChannel =
    isObject(input.source) && trimString((input.source as Record<string, unknown>).pageType) === 'entrust'

  const name = trimString(input.name)
  if (!name && !entrustChannel) errors.push('name_required')
  else if (name.length > LIMITS.NAME_MAX) errors.push('name_too_long')
```

3c. 更新文件顶部注释块的必填说明（`:8` 那行）：

```
 *   - 必填：phone (中国大陆 11 位), consent.accepted=true, consent.policyVersion, source.pageType, source.path, requestId；
 *     name (1-50) 除 pageType='entrust' 外必填
```

- [x] **Step 4: 实现 `src/domain/inquiry/entrust-name-fallback.ts`**

```ts
/**
 * 委托找房线索姓名兜底 hook
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §4.3（冲突 1）
 *
 * 守护不变量：
 *   - 只在 sourcePageType='entrust' 且姓名为空时填兜底值，不覆盖已有姓名；
 *   - 兜底值含手机号后四位，让后台一眼看出是零门槛渠道线索；
 *   - 不放宽 Leads.name 的 required（后台列表 / 跟进视图依赖它非空）；
 *   - beforeValidate 阶段执行，早于字段必填校验；
 *   - 手机号缺失时退化为固定文案，绝不抛异常阻塞提交。
 */

import type { CollectionBeforeValidateHook } from 'payload'
import { normalizePhone, phoneLast4 } from '@/domain/shared/phone'

export const fillEntrustLeadName: CollectionBeforeValidateHook = ({ data }) => {
  const next = (data ?? {}) as Record<string, unknown>
  if (next.sourcePageType !== 'entrust') return next

  const existing = typeof next.name === 'string' ? next.name.trim() : ''
  if (existing) return next

  const phone = typeof next.phone === 'string' ? normalizePhone(next.phone) : ''
  const last4 = phone ? phoneLast4(phone) : ''
  return { ...next, name: last4 ? `未留姓名（${last4}）` : '未留姓名' }
}
```

- [x] **Step 5: 在 `Leads` 挂 hook**

`src/collections/Leads.ts`：import 区加

```ts
import { fillEntrustLeadName } from '@/domain/inquiry/entrust-name-fallback'
```

`hooks` 块（`:69`）改为：

```ts
  hooks: {
    // 委托找房零门槛渠道（PRD §4.3）：无姓名线索填兜底姓名，早于必填校验
    beforeValidate: [fillEntrustLeadName],
    // 字段脱敏（tasks.md M1.4）：缺 phone:full 权限 → 返回 138****1111
    // 业务不变量：经纪人只能看自己负责线索的完整手机号（M5 进一步收窄）
    afterRead: createFieldMaskHooks(getLeadMaskRules()),
  },
```

- [x] **Step 6: 路由传姓名时容许空值**

`src/app/api/inquiries/route.ts` 的 `payload.create` 里，把 `name: inquiry.name,`（`:358`）改为：

```ts
        // entrust 渠道无姓名：传 undefined，交给 fillEntrustLeadName 兜底
        name: inquiry.name || undefined,
```

- [x] **Step 7: 跑测试确认通过**

```bash
cd payload-office-platform && pnpm vitest run tests/inquiry-domain.test.ts && pnpm test
```

Expected: 全绿（新增 8 个用例通过，原有询盘用例不回归）

- [x] **Step 8: 烟测 entrust 提交**

```bash
cd payload-office-platform && PORT=3719 pnpm dev
```

```bash
curl -s -X POST http://localhost:3719/api/inquiries -H 'content-type: application/json' -d '{"phone":"13800002222","requestId":"entrust-smoke-1","targetType":"none","consent":{"accepted":true,"policyVersion":"MVP-R1"},"source":{"pageType":"entrust","path":"/entrust"}}'
```

Expected: `{"ok":true,"targetResolution":"general"}`；后台 `/admin/collections/leads` 出现一条姓名为 `未留姓名（2222）`、来源为 `entrust` 的线索。

- [x] **Step 9: 提交**

```bash
cd .. && git add payload-office-platform/src/domain/inquiry/schema.ts payload-office-platform/src/domain/inquiry/entrust-name-fallback.ts payload-office-platform/src/collections/Leads.ts payload-office-platform/src/app/api/inquiries/route.ts payload-office-platform/tests/inquiry-domain.test.ts
git commit -m "feat(inquiry): 支持委托找房 entrust 渠道零门槛留电

SOURCE_PAGE_TYPES 加 entrust；该渠道允许省略姓名，
落库由 Leads beforeValidate 填「未留姓名（后四位）」，不放宽 name 的 required。"
```

---

## Task 6: 落地页骨架组件与样式

**Files:**
- Create: `src/lib/frontend/landing-config.ts`
- Create: `src/components/frontend/landing/LandingHero.tsx`
- Create: `src/components/frontend/landing/ProcessSteps.tsx`
- Create: `src/components/frontend/landing/StatHighlights.tsx`
- Create: `src/components/frontend/landing/BottomCtaBar.tsx`
- Modify: `src/app/(frontend)/styles.css`（追加）

**Interfaces:**
- Consumes: 无
- Produces:
  - `ENTRUST_COPY` / `PUBLISH_COPY` / `ENTRUST_STATS`（`landing-config.ts`）
  - `LandingHero({ variant, badge, title, subtitle, children })`，`variant: 'split' | 'centered'`
  - `ProcessSteps({ steps, size })`，`steps: readonly { label: string; icon: ProcessIconKey }[]`，`size: 'card' | 'compact'`
  - `StatHighlights({ items })`，`items: readonly { value: string; unit: string; caption: string }[]`
  - `BottomCtaBar({ text, ctaLabel, targetId })`

- [ ] **Step 1: 创建文案与数字配置 `src/lib/frontend/landing-config.ts`**

```ts
/**
 * 委托找房 / 投放房源 落地页文案与数字背书
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §4.1 / §5.1 / §13 Q3
 *
 * 守护不变量：
 *   - 两页所有营销文案与数字集中在此，运营改文案只碰这一个文件；
 *   - 数字背书是静态常量（不查库），保证两页可完全静态化、无 force-dynamic；
 *   - 数字必须是可辩护的真实值，禁止照搬对标站量级。
 */

/** 品牌名（与 (frontend)/layout.tsx 的 siteName 一致） */
export const BRAND_NAME = '商办租赁'

/** 品牌背书短标签（hero 徽标） */
export const BRAND_BADGE = '上海中高端办公租赁平台'

export const ENTRUST_COPY = {
  title: `${BRAND_NAME} | 找办公室 写字楼租赁`,
  subtitle: '全城海量真房源，价格透明，服务专业',
  formPlaceholder: '请输入手机号，开启您的定制选址服务',
  formSubmit: '免费委托',
  consentNote: '提交即表示同意《隐私政策》，并授权我们与您联系',
  processTitle: '选址服务流程',
  processSubtitle: '1 对 1 专属选址分析，全流程量身定制',
  statsTitle: '核心服务能力',
  statsSubtitle: '全城海量真房源，价格透明，服务专业',
  bottomCtaText: '现在，开始定制您的选址服务',
  bottomCtaLabel: '免费委托定制',
  successTitle: '已收到您的委托',
  successBody: '专属顾问将尽快与您联系，为您定制选址方案。',
} as const

/**
 * 数字背书。
 *
 * 待运营确认（PRD §13 Q3）：以下为占位口径，上线前必须替换为平台真实数据。
 * 换维度比夸大数量更可取——数字不好看时改说"覆盖商圈数"，不要抄对标站量级。
 */
export const ENTRUST_STATS = [
  { value: '全城', unit: '覆盖', caption: '上海核心商圈写字楼在租房源' },
  { value: '1', unit: '对1', caption: '专属顾问选址分析，省心省力' },
  { value: '2', unit: '小时', caption: '工作时间内响应，快速给出方案' },
] as const

export const PUBLISH_COPY = {
  title: `房源委托 ${BRAND_NAME} 帮您出租`,
  subtitle: '海量客源，快速成交',
  cardTitle: '免费投放房源',
  groupBuilding: '楼盘信息',
  groupCommission: '佣金',
  groupContact: '联系人信息',
  commissionNote: '悬赏一定比例佣金会更快促进成交，成交后支付。',
  contactNote: '提交即授权将联系方式提供给服务机构/人员，以便提供服务',
  consentNote: '提交即表示同意《隐私政策》',
  submit: '立即投放',
  cardFooter: BRAND_BADGE,
  successTitle: '已收到您的房源',
  successBody: '顾问将尽快与您联系，安排实勘与上架。',
} as const

/** 委托找房服务流程（4 步） */
export const ENTRUST_STEPS = [
  { label: '填写手机号', icon: 'form' },
  { label: '专属顾问回访', icon: 'advisor' },
  { label: '定制选址方案', icon: 'plan' },
  { label: '实地看房签约', icon: 'sign' },
] as const

/** 投放房源服务流程（4 步） */
export const PUBLISH_STEPS = [
  { label: '提交房源', icon: 'form' },
  { label: '实勘采集', icon: 'survey' },
  { label: '推广曝光', icon: 'promote' },
  { label: '签约成交', icon: 'sign' },
] as const
```

- [ ] **Step 2: 创建 `ProcessSteps.tsx`**

```tsx
import React from 'react'

/**
 * 落地页服务流程条
 *
 * 设计依据：PRD §4.1 ②、§5.1 ②
 * 守护不变量：
 *   - 语义化 <ol>，步骤顺序对读屏可感知；
 *   - 步骤之间的 › 是纯装饰（aria-hidden）；
 *   - size='card' 为委托找房的大卡片，size='compact' 为投放房源卡片内的紧凑条；
 *   - 图标为内联 SVG，currentColor 取色，不引图标库。
 */

export type ProcessIconKey = 'form' | 'advisor' | 'plan' | 'sign' | 'survey' | 'promote'

export type ProcessStep = Readonly<{ label: string; icon: ProcessIconKey }>

type Props = {
  steps: readonly ProcessStep[]
  size?: 'card' | 'compact'
}

const ICON_PATHS: Record<ProcessIconKey, string> = {
  form: 'M4 3h10l4 4v14H4zM14 3v4h4M8 12h6M8 16h6',
  advisor: 'M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM5 20a7 7 0 0 1 14 0',
  plan: 'M5 3h9l5 5v13H5zM9 13h6M9 17h4',
  sign: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
  survey: 'M4 5h16v12H4zM8 21h8M12 17v4',
  promote: 'M3 10h4l7-5v14l-7-5H3zM18 9a4 4 0 0 1 0 6',
}

function StepIcon({ icon }: { icon: ProcessIconKey }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[icon]} />
    </svg>
  )
}

export default function ProcessSteps({ steps, size = 'card' }: Props) {
  return (
    <ol className={`process-steps process-steps--${size}`} role="list">
      {steps.map((step, index) => (
        <li key={step.label} className="process-steps__item">
          <div className="process-steps__icon">
            <StepIcon icon={step.icon} />
          </div>
          <span className="process-steps__label">
            {size === 'card' && (
              <span className="process-steps__index" aria-hidden="true">
                {index + 1}
              </span>
            )}
            {step.label}
          </span>
          {index < steps.length - 1 && (
            <span className="process-steps__sep" aria-hidden="true">
              ›
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}
```

- [ ] **Step 3: 创建 `LandingHero.tsx`**

```tsx
import React from 'react'

/**
 * 落地页 Hero
 *
 * 设计依据：PRD §4.1 ①（split：左文案右插画）、§5.1 ①（centered：居中大标题）
 * 守护不变量：
 *   - 每页只有一个 <h1>；
 *   - 背景为 CSS 渐变 + 建筑剪影（PRD §3：不复刻对标站 3D 插画、不用阿里红）；
 *   - 装饰图形 aria-hidden，不干扰读屏；
 *   - children 是表单插槽（split 变体放输入框，centered 变体不放，卡片在 hero 之下）。
 */

type Props = {
  variant: 'split' | 'centered'
  badge?: string
  title: string
  subtitle: string
  children?: React.ReactNode
}

/** 建筑剪影装饰（纯 CSS 无法表达的轮廓用内联 SVG，取 currentColor） */
function SkylineDecor() {
  return (
    <svg
      className="landing-hero__decor"
      viewBox="0 0 320 200"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="12" y="96" width="34" height="104" rx="2" opacity="0.28" />
      <rect x="54" y="60" width="42" height="140" rx="2" opacity="0.42" />
      <rect x="104" y="118" width="30" height="82" rx="2" opacity="0.24" />
      <rect x="142" y="34" width="48" height="166" rx="3" opacity="0.55" />
      <rect x="198" y="84" width="38" height="116" rx="2" opacity="0.34" />
      <rect x="244" y="52" width="30" height="148" rx="2" opacity="0.4" />
      <rect x="282" y="110" width="26" height="90" rx="2" opacity="0.22" />
    </svg>
  )
}

export default function LandingHero({ variant, badge, title, subtitle, children }: Props) {
  return (
    <section className={`landing-hero landing-hero--${variant}`}>
      <div className="landing-hero__inner">
        <div className="landing-hero__copy">
          {badge && <p className="landing-hero__badge">{badge}</p>}
          <h1 className="landing-hero__title">{title}</h1>
          <p className="landing-hero__subtitle">{subtitle}</p>
          {children && <div className="landing-hero__slot">{children}</div>}
        </div>
        <div className="landing-hero__art" aria-hidden="true">
          <SkylineDecor />
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: 创建 `StatHighlights.tsx`**

```tsx
import React from 'react'

/**
 * 数字背书（3 列）
 *
 * 设计依据：PRD §4.1 ③
 * 守护不变量：
 *   - 数值与单位在同一行，单位小于数值（视觉对齐对标站排版）；
 *   - 数据来自 lib/frontend/landing-config.ts 静态常量，不查库，页面保持静态；
 *   - 用 <dl> 语义（数值为 <dd>，说明为 <dt>）。
 */

export type StatItem = Readonly<{ value: string; unit: string; caption: string }>

export default function StatHighlights({ items }: { items: readonly StatItem[] }) {
  return (
    <dl className="stat-highlights">
      {items.map((item) => (
        <div key={item.caption} className="stat-highlights__item">
          <dd className="stat-highlights__value">
            {item.value}
            <span className="stat-highlights__unit">{item.unit}</span>
          </dd>
          <dt className="stat-highlights__caption">{item.caption}</dt>
        </div>
      ))}
    </dl>
  )
}
```

- [ ] **Step 5: 创建 `BottomCtaBar.tsx`**

```tsx
'use client'

import React from 'react'
import { Button } from '@/components/frontend/ui'

/**
 * 页尾二次 CTA 条
 *
 * 设计依据：PRD §4.1 ④
 * 守护不变量：
 *   - 不重复渲染第二个表单，只把焦点送回首屏输入框（避免两个表单的埋点归因混乱）；
 *   - 目标元素不存在时静默无操作，不抛异常；
 *   - 移动端由 CSS 变为吸底条；触控目标 ≥44px。
 */

type Props = {
  text: string
  ctaLabel: string
  /** 首屏输入框 id */
  targetId: string
}

export default function BottomCtaBar({ text, ctaLabel, targetId }: Props) {
  const focusTarget = () => {
    const el = document.getElementById(targetId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // 滚动动画期间聚焦会被打断，延后一帧
    window.setTimeout(() => el.focus({ preventScroll: true }), 300)
  }

  return (
    <div className="bottom-cta">
      <p className="bottom-cta__text">{text}</p>
      <Button variant="primary" onClick={focusTarget}>
        {ctaLabel}
      </Button>
    </div>
  )
}
```

- [ ] **Step 6: 追加样式到 `src/app/(frontend)/styles.css`**

在文件末尾追加（只用既有 CSS 变量，不引入新色值；`--gold` / `--deep` 承接对标站的红色位置）：

```css
/* ===========================================================================
   落地页（委托找房 /entrust、投放房源 /publish）
   设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §3
   守护不变量：只用站内 CSS 变量；不引入对标站的红色；375/768/1280 三档无横向滚动。
   =========================================================================== */

.landing-hero {
  position: relative;
  overflow: hidden;
  background: linear-gradient(160deg, var(--cream) 0%, var(--paper) 100%);
  border-bottom: 1px solid var(--line);
}

.landing-hero__inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 56px 20px 64px;
  display: grid;
  gap: 32px;
  align-items: center;
}

.landing-hero--split .landing-hero__inner {
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
}

.landing-hero--centered .landing-hero__inner {
  grid-template-columns: 1fr;
  text-align: center;
  padding-bottom: 96px;
}

.landing-hero__badge {
  display: inline-block;
  margin: 0 0 16px;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--deep);
  color: var(--paper);
  font-size: 13px;
  line-height: 1.6;
}

.landing-hero__title {
  margin: 0 0 12px;
  font-size: clamp(28px, 5vw, 46px);
  line-height: 1.25;
  color: var(--ink);
}

.landing-hero__subtitle {
  margin: 0;
  color: var(--muted);
  font-size: clamp(14px, 2vw, 17px);
}

.landing-hero__slot {
  margin-top: 28px;
}

.landing-hero__art {
  position: relative;
  min-height: 180px;
  color: var(--gold);
}

.landing-hero--centered .landing-hero__art {
  position: absolute;
  inset: auto 0 0 0;
  min-height: 0;
  pointer-events: none;
}

.landing-hero__decor {
  width: 100%;
  height: auto;
  display: block;
}

/* 委托找房：首屏单手机号表单 */
.entrust-form {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  max-width: 560px;
}

.landing-hero--centered .entrust-form {
  margin-inline: auto;
}

.entrust-form__field {
  flex: 1 1 260px;
  min-width: 0;
}

.entrust-form__note {
  flex: 1 1 100%;
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--muted);
}

.entrust-form__success {
  max-width: 560px;
  padding: 20px 22px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
}

.entrust-form__success h2 {
  margin: 0 0 6px;
  font-size: 18px;
  color: var(--ink);
}

.entrust-form__success p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

/* 区块副标题（styles.css 原有 .section__header / .section__title，但没有副标题样式） */
.section__subtitle {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 14px;
  text-align: center;
}

/* 流程条 */
.process-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 16px;
}

.process-steps--card {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.process-steps--compact {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.process-steps__item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.process-steps--card .process-steps__item {
  padding: 26px 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--paper);
}

.process-steps__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--cream);
  color: var(--deep);
}

.process-steps--compact .process-steps__icon {
  width: 40px;
  height: 40px;
  background: transparent;
}

.process-steps__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--ink);
}

.process-steps__index {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--gold);
  color: var(--paper);
  font-size: 11px;
}

.process-steps__sep {
  position: absolute;
  top: 50%;
  right: -12px;
  transform: translateY(-50%);
  color: var(--line);
  font-size: 18px;
}

.process-steps--compact .process-steps__sep {
  top: 26px;
  right: -6px;
}

/* 数字背书 */
.stat-highlights {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  margin: 0;
  padding: 0;
}

.stat-highlights__item {
  text-align: center;
  padding: 0 12px;
}

.stat-highlights__item + .stat-highlights__item {
  border-left: 1px solid var(--line);
}

.stat-highlights__value {
  margin: 0 0 8px;
  font-size: clamp(30px, 5vw, 44px);
  line-height: 1.1;
  color: var(--deep);
  font-weight: 700;
}

.stat-highlights__unit {
  margin-left: 4px;
  font-size: 16px;
  font-weight: 500;
  color: var(--muted);
}

.stat-highlights__caption {
  color: var(--muted);
  font-size: 14px;
}

/* 页尾 CTA */
.bottom-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  justify-content: center;
  padding: 40px 20px 56px;
  background: var(--cream);
  border-top: 1px solid var(--line);
}

.bottom-cta__text {
  margin: 0;
  font-size: clamp(16px, 2.4vw, 20px);
  color: var(--ink);
}

/* 投放房源：浮起表单卡片 */
.publish-card {
  max-width: 700px;
  margin: -64px auto 56px;
  padding: 28px 24px 32px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 18px 44px rgb(0 0 0 / 8%);
}

.publish-card__title {
  margin: 0 0 20px;
  text-align: center;
  font-size: 20px;
  color: var(--ink);
}

.publish-card__group {
  margin-top: 24px;
}

.publish-card__group-title {
  margin: 0 0 4px;
  font-size: 15px;
  color: var(--ink);
}

.publish-card__group-note {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--muted);
}

.publish-card__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.publish-card__actions {
  margin-top: 28px;
  display: grid;
  place-items: center;
  gap: 10px;
}

.publish-card__footer {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

.publish-card__error {
  margin: 12px 0 0;
  color: #b3261e;
  font-size: 13px;
}

/* 面积/租金输入的单位后缀 */
.input-suffix {
  position: relative;
  display: block;
}

.input-suffix__unit {
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  color: var(--muted);
  font-size: 13px;
  pointer-events: none;
}

/* 佣金单选按钮组 */
.commission-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.commission-options__item {
  position: relative;
}

.commission-options__input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}

.commission-options__label {
  display: grid;
  place-items: center;
  min-width: 76px;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  font-size: 14px;
  cursor: pointer;
}

.commission-options__input:checked + .commission-options__label {
  border-color: var(--gold);
  background: var(--cream);
  color: var(--deep);
}

.commission-options__input:focus-visible + .commission-options__label {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

@media (max-width: 900px) {
  .landing-hero--split .landing-hero__inner {
    grid-template-columns: 1fr;
  }

  .landing-hero--split .landing-hero__art {
    order: -1;
    min-height: 120px;
  }

  .process-steps--card,
  .process-steps--compact {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .process-steps__sep {
    display: none;
  }

  .stat-highlights {
    grid-template-columns: 1fr;
  }

  .stat-highlights__item + .stat-highlights__item {
    border-left: 0;
    border-top: 1px solid var(--line);
    padding-top: 20px;
  }
}

@media (max-width: 640px) {
  .publish-card {
    margin: -40px 16px 40px;
    padding: 22px 16px 26px;
  }

  .publish-card__row {
    grid-template-columns: 1fr;
  }

  .bottom-cta {
    position: sticky;
    bottom: 0;
    z-index: 20;
    padding: 14px 16px;
    box-shadow: 0 -6px 18px rgb(0 0 0 / 8%);
  }
}
```

- [ ] **Step 7: 类型检查**

```bash
cd payload-office-platform && pnpm typecheck
```

Expected: 通过

- [ ] **Step 8: 提交**

```bash
git add payload-office-platform/src/lib/frontend/landing-config.ts payload-office-platform/src/components/frontend/landing payload-office-platform/src/app/\(frontend\)/styles.css
git commit -m "feat(frontend): 落地页骨架组件与样式

LandingHero(split/centered)、ProcessSteps(card/compact)、StatHighlights、BottomCtaBar；
文案与数字背书集中到 landing-config.ts；配色只用站内奶油+金色变量，剪影替代 3D 插画。"
```

---

## Task 7: `/entrust` 委托找房页

**Files:**
- Create: `src/components/frontend/landing/EntrustForm.tsx`
- Create: `src/app/(frontend)/entrust/page.tsx`

**Interfaces:**
- Consumes: Task 5 的 `entrust` 渠道端点行为、Task 6 的 `LandingHero` / `ProcessSteps` / `StatHighlights` / `BottomCtaBar` / `landing-config`
- Produces: 路由 `/entrust`；首屏输入框 id 固定为 `entrust-phone`（`BottomCtaBar` 依赖它）

- [ ] **Step 1: 创建 `EntrustForm.tsx`**

```tsx
'use client'

import React, { useId, useState } from 'react'
import Link from 'next/link'
import { Button, Field, Input } from '@/components/frontend/ui'
import { ENTRUST_COPY } from '@/lib/frontend/landing-config'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

/**
 * 委托找房首屏表单（只采集手机号）
 *
 * 设计依据：PRD §4.2 / §4.3 / §4.5
 * 守护不变量：
 *   - 只有一个手机号字段，没有姓名、没有需求字段、没有同意复选框；
 *   - 隐式授权：按钮下方明示授权文案 + 隐私政策链接，提交时带 policyVersion 留痕；
 *   - 提交成功后就地替换为成功态，URL 不变（保埋点归因）；
 *   - 输入框 id 固定 'entrust-phone'，供页尾 CTA 聚焦；
 *   - requestId 每次挂载生成一次，双击/重试命中服务端幂等键。
 */

/** 客户端手机号预校验：中国大陆 11 位，与服务端 isValidCnMobile 口径一致 */
function isCnMobile(raw: string): boolean {
  return /^1[3-9]\d{9}$/.test(raw.replace(/[\s-]/g, ''))
}

/** 生成请求 ID（crypto.randomUUID 不可用时退化为时间戳+随机数） */
function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `entrust-${crypto.randomUUID()}`
  }
  return `entrust-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export default function EntrustForm() {
  const inputId = 'entrust-phone'
  const noteId = useId()
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [requestId] = useState(newRequestId)

  if (done) {
    return (
      <div className="entrust-form__success" role="status" aria-live="polite">
        <h2>{ENTRUST_COPY.successTitle}</h2>
        <p>{ENTRUST_COPY.successBody}</p>
      </div>
    )
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting) return
    const trimmed = phone.trim()
    if (!isCnMobile(trimmed)) {
      setError('请输入正确的 11 位手机号')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phone: trimmed,
          requestId,
          targetType: 'none',
          consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
          source: { pageType: 'entrust', path: '/entrust' },
        }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null
      if (res.ok && data?.ok) {
        setDone(true)
        return
      }
      setError(res.status === 429 ? '提交过于频繁，请稍后再试' : '提交失败，请稍后重试')
    } catch {
      setError('网络异常，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="entrust-form" onSubmit={onSubmit} noValidate>
      <Field
        label="手机号"
        id={inputId}
        error={error}
        required
        className="entrust-form__field"
      >
        <Input
          type="tel"
          name="phone"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={13}
          placeholder={ENTRUST_COPY.formPlaceholder}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-describedby={noteId}
        />
      </Field>
      <Button type="submit" variant="primary" loading={submitting}>
        {ENTRUST_COPY.formSubmit}
      </Button>
      <p className="entrust-form__note" id={noteId}>
        提交即表示同意
        <Link href="/pages/privacy">《隐私政策》</Link>
        ，并授权我们与您联系
      </p>
    </form>
  )
}
```

> `Field` 会给子元素注入 `aria-describedby`，此处显式再传一次以确保授权文案也被关联；两者由 `Field` 合并逻辑取后者，不会重复朗读。

- [ ] **Step 2: 创建 `src/app/(frontend)/entrust/page.tsx`**

```tsx
import type { Metadata } from 'next'
import React from 'react'
import BottomCtaBar from '@/components/frontend/landing/BottomCtaBar'
import EntrustForm from '@/components/frontend/landing/EntrustForm'
import LandingHero from '@/components/frontend/landing/LandingHero'
import ProcessSteps from '@/components/frontend/landing/ProcessSteps'
import StatHighlights from '@/components/frontend/landing/StatHighlights'
import {
  BRAND_BADGE,
  ENTRUST_COPY,
  ENTRUST_STATS,
  ENTRUST_STEPS,
} from '@/lib/frontend/landing-config'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { siteConfig } from '@/lib/frontend/site-config'

/**
 * 委托找房落地页
 *
 * 设计依据：PRD §4.1
 * 守护不变量：
 *   - 全静态：不读 DB、不设 force-dynamic（数字背书走 landing-config 静态常量）；
 *   - 单一 <h1> 在 LandingHero 内；
 *   - 输出 Service JSON-LD，不输出 FAQPage（本页无 FAQ 区）。
 */

export const metadata: Metadata = buildPageMetadata({
  title: '委托找房 · 免费定制选址方案',
  description:
    '留下手机号，专属顾问 1 对 1 分析选址需求，免费定制上海写字楼、服务式办公与共享办公的选址方案。',
  canonicalPath: '/entrust',
})

const SERVICE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: '委托找房 · 定制选址服务',
  serviceType: '写字楼选址顾问服务',
  areaServed: { '@type': 'City', name: '上海' },
  provider: { '@type': 'Organization', name: '商办租赁', url: siteConfig.siteOrigin },
  url: `${siteConfig.siteOrigin}/entrust`,
} as const

export default function EntrustPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // JSON-LD 为构建期常量，无用户输入
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SERVICE_JSON_LD) }}
      />

      <LandingHero
        variant="split"
        badge={BRAND_BADGE}
        title={ENTRUST_COPY.title}
        subtitle={ENTRUST_COPY.subtitle}
      >
        <EntrustForm />
      </LandingHero>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">{ENTRUST_COPY.processTitle}</h2>
          <p className="section__subtitle">{ENTRUST_COPY.processSubtitle}</p>
        </div>
        <ProcessSteps steps={ENTRUST_STEPS} size="card" />
      </section>

      <section className="section">
        <div className="section__header">
          <h2 className="section__title">{ENTRUST_COPY.statsTitle}</h2>
          <p className="section__subtitle">{ENTRUST_COPY.statsSubtitle}</p>
        </div>
        <StatHighlights items={ENTRUST_STATS} />
      </section>

      <BottomCtaBar
        text={ENTRUST_COPY.bottomCtaText}
        ctaLabel={ENTRUST_COPY.bottomCtaLabel}
        targetId="entrust-phone"
      />
    </>
  )
}
```

> `.section` / `.section__header` / `.section__title` 是 `styles.css` 已有的 class（`:1577` / `:4719` / `:1581`）；`.section__subtitle` 原本不存在，已在 Task 6 的样式块里新增，无需再补。

- [ ] **Step 3: 类型检查 + 构建**

```bash
cd payload-office-platform && pnpm typecheck && pnpm build
```

Expected: 构建成功；构建输出中 `/entrust` 标记为静态（`○`），**不是** `ƒ`（动态）。若显示动态，检查是否误引入了读库调用。

- [ ] **Step 4: 浏览器人工核对**

```bash
cd payload-office-platform && PORT=3719 pnpm dev
```

打开 `http://localhost:3719/entrust`，逐条确认：

1. 导航高亮「委托找房」；
2. 首屏只有一个手机号输入框 + 「免费委托」按钮 + 授权文案；
3. 流程 4 步、数字 3 列、页尾 CTA 齐全；
4. 点页尾「免费委托定制」→ 平滑滚回首屏且输入框获得焦点；
5. 输入 `123` 提交 → 内联报「请输入正确的 11 位手机号」；
6. 输入合法手机号提交 → 表单区就地变成成功态，URL 仍是 `/entrust`；
7. 浏览器宽度切 375 / 768 / 1280 三档，均无横向滚动条。

- [ ] **Step 5: 提交**

```bash
git add payload-office-platform/src/components/frontend/landing/EntrustForm.tsx "payload-office-platform/src/app/(frontend)/entrust/page.tsx"
git commit -m "feat(frontend): 新增 /entrust 委托找房落地页

首屏单手机号零门槛留电 + 4 步流程 + 3 列数字背书 + 页尾 CTA；
全静态页面，Service JSON-LD，隐式授权带政策版本留痕。"
```

---

## Task 8: `/publish` 投放房源页

**Files:**
- Create: `src/components/frontend/landing/SupplySubmissionForm.tsx`
- Create: `src/app/(frontend)/publish/page.tsx`

**Interfaces:**
- Consumes: Task 4 的 `POST /api/supply-submissions`、Task 2 的 `COMMISSION_MONTHS` / `COMMISSION_MONTHS_LABELS`、Task 6 的骨架组件与 `PUBLISH_COPY` / `PUBLISH_STEPS`
- Produces: 路由 `/publish`

- [ ] **Step 1: 创建 `SupplySubmissionForm.tsx`**

```tsx
'use client'

import React, { useId, useState } from 'react'
import Link from 'next/link'
import { Button, Field, Input, Select } from '@/components/frontend/ui'
import {
  COMMISSION_MONTHS,
  COMMISSION_MONTHS_LABELS,
  type CommissionMonths,
} from '@/domain/supply-submission/schema'
import { PUBLISH_COPY } from '@/lib/frontend/landing-config'
import ProcessSteps from '@/components/frontend/landing/ProcessSteps'
import { PUBLISH_STEPS } from '@/lib/frontend/landing-config'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

/**
 * 投放房源表单卡片（6 字段）
 *
 * 设计依据：PRD §5.1 ② / §5.2 / §5.4 / §5.7
 * 守护不变量：
 *   - 字段与顺序严格照对标站：楼盘名称* / 详细地址* / 出租面积* / 租金+单位 / 佣金 / 手机号*；
 *   - 出租面积是单值（不是区间）；佣金默认「无」；租金单位默认元/㎡/天；
 *   - 隐式授权：联系人分组说明 + 隐私政策链接，提交时带 policyVersion；
 *   - 字段级错误内联展示，提交失败保留已填内容；
 *   - 成功后卡片就地替换为成功态。
 */

/** 租金单位选项（值域与服务端 PRICE_UNITS 一致） */
const RENT_UNIT_OPTIONS = [
  { value: 'rmb-sqm-day', label: '元/㎡/天' },
  { value: 'rmb-month', label: '元/月' },
  { value: 'rmb-seat-month', label: '元/工位/月' },
  { value: 'rmb-total', label: '元/总价' },
] as const

type FieldErrors = Partial<
  Record<'buildingName' | 'address' | 'areaSqm' | 'rentAmount' | 'contactPhone', string>
>

/** 服务端错误码 → 字段级中文提示 */
const ERROR_CODE_MAP: Record<string, { field: keyof FieldErrors; message: string }> = {
  building_name_required: { field: 'buildingName', message: '请输入楼盘名称' },
  building_name_too_long: { field: 'buildingName', message: '楼盘名称过长' },
  address_required: { field: 'address', message: '请输入详细地址' },
  address_too_long: { field: 'address', message: '详细地址过长' },
  area_required: { field: 'areaSqm', message: '请输入出租面积' },
  area_invalid: { field: 'areaSqm', message: '出租面积需为正数' },
  rent_amount_invalid: { field: 'rentAmount', message: '租金数值不合法' },
  phone_invalid: { field: 'contactPhone', message: '请输入正确的 11 位手机号' },
}

function isCnMobile(raw: string): boolean {
  return /^1[3-9]\d{9}$/.test(raw.replace(/[\s-]/g, ''))
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `publish-${crypto.randomUUID()}`
  }
  return `publish-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export default function SupplySubmissionForm() {
  const commissionName = useId()
  const [buildingName, setBuildingName] = useState('')
  const [address, setAddress] = useState('')
  const [areaSqm, setAreaSqm] = useState('')
  const [rentAmount, setRentAmount] = useState('')
  const [rentUnit, setRentUnit] = useState<string>('rmb-sqm-day')
  const [commissionMonths, setCommissionMonths] = useState<CommissionMonths>('none')
  const [contactPhone, setContactPhone] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [requestId] = useState(newRequestId)

  if (done) {
    return (
      <div className="publish-card" role="status" aria-live="polite">
        <h2 className="publish-card__title">{PUBLISH_COPY.successTitle}</h2>
        <p className="publish-card__footer">{PUBLISH_COPY.successBody}</p>
      </div>
    )
  }

  /** 客户端预校验：三个必填 + 手机号格式 */
  const validate = (): FieldErrors => {
    const next: FieldErrors = {}
    if (!buildingName.trim()) next.buildingName = '请输入楼盘名称'
    if (!address.trim()) next.address = '请输入详细地址'
    const area = Number(areaSqm)
    if (!areaSqm.trim()) next.areaSqm = '请输入出租面积'
    else if (!Number.isFinite(area) || area <= 0) next.areaSqm = '出租面积需为正数'
    if (rentAmount.trim()) {
      const rent = Number(rentAmount)
      if (!Number.isFinite(rent) || rent < 0) next.rentAmount = '租金数值不合法'
    }
    if (!isCnMobile(contactPhone.trim())) next.contactPhone = '请输入正确的 11 位手机号'
    return next
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submitting) return
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setFormError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/supply-submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId,
          buildingName: buildingName.trim(),
          address: address.trim(),
          areaSqm: Number(areaSqm),
          ...(rentAmount.trim() ? { rentAmount: Number(rentAmount), rentUnit } : {}),
          commissionMonths,
          contactPhone: contactPhone.trim(),
          consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
          source: { path: '/publish' },
        }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; errors?: string[] }
        | null
      if (res.ok && data?.ok) {
        setDone(true)
        return
      }
      if (res.status === 422 && Array.isArray(data?.errors)) {
        const mapped: FieldErrors = {}
        for (const code of data.errors) {
          const hit = ERROR_CODE_MAP[code]
          if (hit) mapped[hit.field] = hit.message
        }
        setErrors(mapped)
        setFormError(Object.keys(mapped).length === 0 ? '提交内容有误，请检查后重试' : null)
        return
      }
      setFormError(res.status === 429 ? '提交过于频繁，请稍后再试' : '提交失败，请稍后重试')
    } catch {
      setFormError('网络异常，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="publish-card" onSubmit={onSubmit} noValidate>
      <h2 className="publish-card__title">{PUBLISH_COPY.cardTitle}</h2>

      <ProcessSteps steps={PUBLISH_STEPS} size="compact" />

      <div className="publish-card__group">
        <h3 className="publish-card__group-title">{PUBLISH_COPY.groupBuilding}</h3>

        <Field label="楼盘名称" id="publish-building" required error={errors.buildingName}>
          <Input
            name="buildingName"
            autoComplete="off"
            maxLength={100}
            placeholder="请输入楼盘名称"
            value={buildingName}
            onChange={(e) => setBuildingName(e.target.value)}
          />
        </Field>

        <Field label="详细地址" id="publish-address" required error={errors.address}>
          <Input
            name="address"
            autoComplete="off"
            maxLength={200}
            placeholder="请输入楼号/单元号/房间号"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>

        <Field label="出租面积" id="publish-area" required error={errors.areaSqm}>
          <span className="input-suffix">
            <Input
              name="areaSqm"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="请输入出租面积"
              value={areaSqm}
              onChange={(e) => setAreaSqm(e.target.value)}
            />
            <span className="input-suffix__unit" aria-hidden="true">
              ㎡
            </span>
          </span>
        </Field>

        <div className="publish-card__row">
          <Field label="租金" id="publish-rent" error={errors.rentAmount}>
            <Input
              name="rentAmount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="请输入您希望出租的价格"
              value={rentAmount}
              onChange={(e) => setRentAmount(e.target.value)}
            />
          </Field>
          <Field label="租金单位" id="publish-rent-unit">
            <Select
              name="rentUnit"
              value={rentUnit}
              onChange={(e) => setRentUnit(e.target.value)}
            >
              {RENT_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <fieldset className="publish-card__group">
        <legend className="publish-card__group-title">{PUBLISH_COPY.groupCommission}</legend>
        <p className="publish-card__group-note">{PUBLISH_COPY.commissionNote}</p>
        <div className="commission-options">
          {COMMISSION_MONTHS.map((value) => (
            <span key={value} className="commission-options__item">
              <input
                className="commission-options__input"
                type="radio"
                id={`${commissionName}-${value}`}
                name={commissionName}
                value={value}
                checked={commissionMonths === value}
                onChange={() => setCommissionMonths(value)}
              />
              <label
                className="commission-options__label"
                htmlFor={`${commissionName}-${value}`}
              >
                {COMMISSION_MONTHS_LABELS[value]}
              </label>
            </span>
          ))}
        </div>
      </fieldset>

      <div className="publish-card__group">
        <h3 className="publish-card__group-title">{PUBLISH_COPY.groupContact}</h3>
        <p className="publish-card__group-note">
          {PUBLISH_COPY.contactNote}（
          <Link href="/pages/privacy">《隐私政策》</Link>）
        </p>
        <Field label="手机号" id="publish-phone" required error={errors.contactPhone}>
          <Input
            name="contactPhone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={13}
            placeholder="请输入手机号"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </Field>
      </div>

      {formError && (
        <p className="publish-card__error" role="alert">
          {formError}
        </p>
      )}

      <div className="publish-card__actions">
        <Button type="submit" variant="primary" loading={submitting}>
          {PUBLISH_COPY.submit}
        </Button>
        <p className="publish-card__footer">{PUBLISH_COPY.cardFooter}</p>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: 创建 `src/app/(frontend)/publish/page.tsx`**

```tsx
import type { Metadata } from 'next'
import React from 'react'
import LandingHero from '@/components/frontend/landing/LandingHero'
import SupplySubmissionForm from '@/components/frontend/landing/SupplySubmissionForm'
import { PUBLISH_COPY } from '@/lib/frontend/landing-config'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { siteConfig } from '@/lib/frontend/site-config'

/**
 * 投放房源落地页
 *
 * 设计依据：PRD §5.1（按"首屏即全部"实现，卡片下方无额外区块）
 * 守护不变量：
 *   - 全静态：不读 DB、不设 force-dynamic；
 *   - 单一 <h1> 在 LandingHero 内，卡片标题为 <h2>；
 *   - 输出 Service JSON-LD，不输出 FAQPage（本页无 FAQ 区）。
 */

export const metadata: Metadata = buildPageMetadata({
  title: '投放房源 · 免费委托出租',
  description:
    '业主、物业方与中介可免费提交写字楼房源，平台实勘采集、推广曝光、协助签约成交，可设置佣金悬赏加速出租。',
  canonicalPath: '/publish',
})

const SERVICE_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: '房源委托出租服务',
  serviceType: '写字楼房源委托代理',
  areaServed: { '@type': 'City', name: '上海' },
  provider: { '@type': 'Organization', name: '商办租赁', url: siteConfig.siteOrigin },
  url: `${siteConfig.siteOrigin}/publish`,
} as const

export default function PublishPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SERVICE_JSON_LD) }}
      />

      <LandingHero
        variant="centered"
        title={PUBLISH_COPY.title}
        subtitle={PUBLISH_COPY.subtitle}
      />

      <SupplySubmissionForm />
    </>
  )
}
```

- [ ] **Step 3: 类型检查 + 构建**

```bash
cd payload-office-platform && pnpm typecheck && pnpm build
```

Expected: 构建成功；`/publish` 为静态（`○`）。

- [ ] **Step 4: 浏览器人工核对**

```bash
cd payload-office-platform && PORT=3719 pnpm dev
```

打开 `http://localhost:3719/publish`，逐条确认：

1. 导航高亮「投放房源」；
2. 居中大标题 + 副标题，白卡片浮在 hero 下沿且不遮挡标题；
3. 卡片内顺序：标题「免费投放房源」→ 4 步流程条 → 楼盘信息（4 字段）→ 佣金（5 选项，默认「无」）→ 联系人信息（手机号）→ 「立即投放」→ 底部小字；
4. 空表单直接提交 → 三个必填与手机号内联报错，已填内容不丢；
5. 填合法内容提交 → 卡片就地变成成功态；
6. 后台 `/admin/collections/supply-submissions` 出现该条，佣金列显示所选值；
7. 375 / 768 / 1280 三档无横向滚动，移动端卡片不溢出。

- [ ] **Step 5: 提交**

```bash
git add payload-office-platform/src/components/frontend/landing/SupplySubmissionForm.tsx "payload-office-platform/src/app/(frontend)/publish/page.tsx"
git commit -m "feat(frontend): 新增 /publish 投放房源落地页

6 字段浮起卡片（楼盘名/地址/面积/租金+单位/佣金悬赏/手机号）+ 卡内 4 步流程条；
服务端 422 错误码映射为字段级中文提示，失败保留已填内容。"
```

---

## Task 9: 新投放申请站内通知

**Files:**
- Create: `src/domain/supply-submission/submission-notify.ts`
- Modify: `src/collections/SupplySubmissions.ts`（挂 `afterChange`）

**Interfaces:**
- Consumes: Task 3 的 `Notifications` 新枚举值（`supply-submission-created` / `supply-submission`）、`supply_submission:read` 操作编码
- Produces: `notifySupplySubmissionCreated: CollectionAfterChangeHook`

- [ ] **Step 1: 实现通知 hook**

```ts
/**
 * 新投放申请站内通知
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.5
 *
 * 守护不变量：
 *   - 只在 operation='create' 触发；
 *   - 收件人 = 拥有 supply_submission:read 操作权限的启用用户（按角色反查）；
 *   - 通知正文只含楼盘名与面积/佣金摘要，不含手机号；
 *   - 通知失败绝不影响申请落库（整段 try/catch，只记日志）；
 *   - 收件人为空时静默跳过（后台列表仍能看到 pending 申请）。
 */

import type { CollectionAfterChangeHook } from 'payload'

/** 单次通知的收件人上限，防角色配置异常导致海量写入 */
const MAX_RECIPIENTS = 50

export const notifySupplySubmissionCreated: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (operation !== 'create') return doc

  try {
    const submission = doc as {
      id: string | number
      buildingName?: string | null
      areaSqm?: number | null
      commissionMonths?: string | null
    }

    // 1. 找出拥有投放审单读权限的启用角色
    //    注：Roles 的操作权限字段名是 operationPermissions（见 collections/Roles.ts:151）
    const roles = await req.payload.find({
      collection: 'roles',
      where: {
        and: [
          { status: { equals: 'active' } },
          { operationPermissions: { contains: 'supply_submission:read' } },
        ],
      },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
    const roleIds = roles.docs.map((r) => r.id)
    if (roleIds.length === 0) return doc

    // 2. 找出这些角色下的启用用户
    const users = await req.payload.find({
      collection: 'users',
      where: { roles: { in: roleIds } },
      limit: MAX_RECIPIENTS,
      depth: 0,
      overrideAccess: true,
    })
    if (users.docs.length === 0) return doc

    const areaText = submission.areaSqm ? `${submission.areaSqm}㎡` : '面积未填'
    const commissionText =
      submission.commissionMonths && submission.commissionMonths !== 'none'
        ? `，悬赏 ${submission.commissionMonths} 个月佣金`
        : ''

    // 3. 逐个收件人写通知（Notifications.recipient 是单用户关系，无角色广播）
    await Promise.all(
      users.docs.map((user) =>
        req.payload.create({
          collection: 'notifications',
          data: {
            recipient: user.id,
            type: 'supply-submission-created',
            title: '新的房源投放申请',
            body: `${submission.buildingName ?? '未填楼盘名'}（${areaText}）${commissionText}`,
            sourceType: 'supply-submission',
            sourceId: String(submission.id),
            eventId: `supply-submission-created:${submission.id}:${user.id}`,
          },
          overrideAccess: true,
        }),
      ),
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    req.payload.logger?.error?.(`[supply-submission] notify failed: ${message}`)
  }

  return doc
}
```

> 字段名已核对：`Roles.operationPermissions`（`:151`）、`Roles.status`（`:107`，值 `active`/`inactive`）、`Users.roles`（`:149`，指向 roles 的数组关系）。`operationPermissions` 是字符串数组，用 `contains` 匹配单个编码。

- [ ] **Step 2: 挂到集合**

`src/collections/SupplySubmissions.ts` 的 `hooks` 改为：

```ts
  hooks: {
    beforeChange: [protectSupplySubmission],
    afterChange: [notifySupplySubmissionCreated],
  },
```

并补 import：

```ts
import { notifySupplySubmissionCreated } from '@/domain/supply-submission/submission-notify'
```

- [ ] **Step 3: 类型检查**

```bash
cd payload-office-platform && pnpm typecheck
```

Expected: 通过

- [ ] **Step 4: 烟测通知**

先在后台给自己的账号所属角色勾上 `supply_submission:read`，然后：

```bash
cd payload-office-platform && PORT=3719 pnpm dev
```

```bash
curl -s -X POST http://localhost:3719/api/supply-submissions -H 'content-type: application/json' -d '{"requestId":"notify-1","buildingName":"通知烟测楼盘","address":"2 号楼 8 层","areaSqm":320,"commissionMonths":"1","contactPhone":"13800003333","consent":{"accepted":true,"policyVersion":"MVP-R1"},"source":{"path":"/publish"}}'
```

Expected: `{"ok":true}`；`/admin/collections/notifications` 出现一条「新的房源投放申请」，正文含楼盘名与面积、悬赏，**不含手机号**。

再验证"通知失败不影响落库"：把角色的 `supply_submission:read` 取消（收件人为空），再提交一条不同楼盘名的申请，Expected: 仍 `{"ok":true}`，申请落库，无通知，无报错。

- [ ] **Step 5: 提交**

```bash
git add payload-office-platform/src/domain/supply-submission/submission-notify.ts payload-office-platform/src/collections/SupplySubmissions.ts
git commit -m "feat(supply): 新投放申请给审单角色发站内通知

按 supply_submission:read 反查角色与用户逐个投递；正文不含手机号；
通知失败只记日志、不影响申请落库；收件人为空时静默跳过。"
```

---

## Task 10: 埋点（两页转化漏斗）

**Files:**
- Modify: `src/lib/frontend/analytics/events.ts`
- Modify: `src/components/frontend/landing/EntrustForm.tsx`
- Modify: `src/components/frontend/landing/SupplySubmissionForm.tsx`
- Modify: `src/components/frontend/landing/BottomCtaBar.tsx`
- Modify: `src/app/(frontend)/entrust/page.tsx`、`src/app/(frontend)/publish/page.tsx`（挂曝光埋点）
- Create: `src/components/frontend/landing/LandingViewAnalytics.tsx`

**Interfaces:**
- Consumes: 现有 `track(name, props)`（`@/lib/frontend/analytics`）与事件白名单机制
- Produces:
  - `ANALYTICS_EVENTS` 新增 6 个事件：`landing_view` / `landing_form_start` / `landing_form_submit` / `landing_form_success` / `landing_form_error` / `landing_bottom_cta_click`
  - `LandingViewAnalytics({ pageType })` 客户端曝光埋点组件

> **重要（PII 白名单）**：`events.ts` 的 `assertSafeAnalyticsProps` 会对含 `name/phone/path/url/address/...` 的属性 key **抛错**。因此属性只能用 `page_type` / `error_code` / `commission_months` / `field_completeness` / `idempotent` 这类枚举与布尔，**绝不能传楼盘名、地址、手机号**。

- [ ] **Step 1: 注册事件白名单**

在 `src/lib/frontend/analytics/events.ts` 的 `ANALYTICS_EVENTS` 里，`related_building_click` 之后加：

```ts
  /** 落地页曝光（委托找房 / 投放房源），需去重 */
  landing_view: ['page_type'],
  /** 落地页表单首次交互（首个字段获得焦点） */
  landing_form_start: ['page_type'],
  /** 落地页表单提交尝试；commission_months 为枚举，不含任何字段值 */
  landing_form_submit: ['page_type', 'field_completeness', 'commission_months'],
  /** 落地页表单提交成功 */
  landing_form_success: ['page_type'],
  /** 落地页表单提交失败；error_code 为服务端安全错误码 */
  landing_form_error: ['page_type', 'error_code'],
  /** 落地页页尾二次 CTA 点击（验证该区块是否值得保留） */
  landing_bottom_cta_click: ['page_type'],
```

- [ ] **Step 2: 创建曝光埋点组件**

创建 `src/components/frontend/landing/LandingViewAnalytics.tsx`：

```tsx
'use client'

import { useEffect } from 'react'
import { track } from '@/lib/frontend/analytics'

/**
 * 落地页曝光埋点
 *
 * 设计依据：PRD §8
 * 守护不变量：
 *   - 每次挂载只上报一次（曝光类事件由 collector 的 deduper 再兜底）；
 *   - 只传 page_type 枚举，不传路径、不传任何用户输入。
 */
export default function LandingViewAnalytics({
  pageType,
}: {
  pageType: 'entrust' | 'publish'
}): null {
  useEffect(() => {
    track('landing_view', { page_type: pageType })
  }, [pageType])
  return null
}
```

- [ ] **Step 3: 在两页挂曝光埋点**

`src/app/(frontend)/entrust/page.tsx`：import 区加

```tsx
import LandingViewAnalytics from '@/components/frontend/landing/LandingViewAnalytics'
```

在 `<>` 内第一个子元素位置（JSON-LD `<script>` 之后）加：

```tsx
      <LandingViewAnalytics pageType="entrust" />
```

`src/app/(frontend)/publish/page.tsx` 同样处理，参数为 `pageType="publish"`。

- [ ] **Step 4: EntrustForm 加漏斗埋点**

`src/components/frontend/landing/EntrustForm.tsx`：

4a. import 区加

```tsx
import { track } from '@/lib/frontend/analytics'
```

4b. 组件内 `const [requestId] = useState(newRequestId)` 之后加：

```tsx
  const [startTracked, setStartTracked] = useState(false)

  /** 首个字段获得焦点时上报一次 form_start */
  const onFirstFocus = () => {
    if (startTracked) return
    setStartTracked(true)
    track('landing_form_start', { page_type: 'entrust' })
  }
```

4c. `<Input ... />` 加 `onFocus={onFirstFocus}`。

4d. `onSubmit` 里，在 `setSubmitting(true)` 之前加：

```tsx
    track('landing_form_submit', { page_type: 'entrust', field_completeness: 1 })
```

（本表单只有 1 个字段，提交时必然已填，故 `field_completeness` 恒为 1。保留该属性是为了与投放房源表单的口径一致。）

4e. 成功分支 `setDone(true)` 之前加：

```tsx
        track('landing_form_success', { page_type: 'entrust' })
```

4f. 两个失败分支（HTTP 非成功、catch）分别加：

```tsx
      track('landing_form_error', {
        page_type: 'entrust',
        error_code: res.status === 429 ? 'rate_limited' : 'submit_failed',
      })
```

```tsx
      track('landing_form_error', { page_type: 'entrust', error_code: 'network_error' })
```

- [ ] **Step 5: SupplySubmissionForm 加漏斗埋点**

`src/components/frontend/landing/SupplySubmissionForm.tsx`：

5a. import 区加 `import { track } from '@/lib/frontend/analytics'`。

5b. state 区加：

```tsx
  const [startTracked, setStartTracked] = useState(false)

  const onFirstFocus = () => {
    if (startTracked) return
    setStartTracked(true)
    track('landing_form_start', { page_type: 'publish' })
  }
```

5c. 6 个输入控件（楼盘名称 / 详细地址 / 出租面积 / 租金 / 租金单位 / 手机号）都加 `onFocus={onFirstFocus}`。

5d. `onSubmit` 里，在 `setSubmitting(true)` 之前加（统计 6 个字段里填了几个，只上报计数不上报值）：

```tsx
    const filledCount = [
      buildingName.trim(),
      address.trim(),
      areaSqm.trim(),
      rentAmount.trim(),
      rentUnit,
      contactPhone.trim(),
    ].filter(Boolean).length
    track('landing_form_submit', {
      page_type: 'publish',
      field_completeness: filledCount,
      commission_months: commissionMonths,
    })
```

5e. 成功分支 `setDone(true)` 之前加：

```tsx
        track('landing_form_success', { page_type: 'publish' })
```

5f. 422 分支、其他失败分支、catch 分支分别加：

```tsx
        track('landing_form_error', { page_type: 'publish', error_code: 'validation_failed' })
```

```tsx
      track('landing_form_error', {
        page_type: 'publish',
        error_code: res.status === 429 ? 'rate_limited' : 'submit_failed',
      })
```

```tsx
      track('landing_form_error', { page_type: 'publish', error_code: 'network_error' })
```

- [ ] **Step 6: BottomCtaBar 加点击埋点**

`src/components/frontend/landing/BottomCtaBar.tsx`：加 `pageType` prop 并上报。

props 类型改为：

```tsx
type Props = {
  text: string
  ctaLabel: string
  /** 首屏输入框 id */
  targetId: string
  pageType: 'entrust' | 'publish'
}
```

import 区加 `import { track } from '@/lib/frontend/analytics'`；`focusTarget` 首行加：

```tsx
    track('landing_bottom_cta_click', { page_type: pageType })
```

并在 `src/app/(frontend)/entrust/page.tsx` 的 `<BottomCtaBar ... />` 上补 `pageType="entrust"`。

- [ ] **Step 7: 类型检查 + 构建**

```bash
cd payload-office-platform && pnpm typecheck && pnpm test && pnpm build
```

Expected: 全绿。

- [ ] **Step 8: 验证埋点真的发出**

`.env.local` 里设 `NEXT_PUBLIC_ANALYTICS_ENABLED=true`，重启 dev：

```bash
cd payload-office-platform && PORT=3719 pnpm dev
```

打开 `http://localhost:3719/entrust`，开浏览器控制台（console adapter 会打印事件），依次确认：

1. 页面加载后出现 `landing_view` + `page_type: 'entrust'`；
2. 点进手机号输入框 → `landing_form_start`（再次点击**不重复**上报）；
3. 提交合法手机号 → 先 `landing_form_submit` 再 `landing_form_success`；
4. 点页尾 CTA → `landing_bottom_cta_click`；
5. 所有事件的属性里**没有手机号、没有路径、没有楼盘名**。

`/publish` 同样验证一遍，额外确认 `landing_form_submit` 带 `commission_months` 与 `field_completeness` 计数。

- [ ] **Step 9: 提交**

```bash
git add payload-office-platform/src/lib/frontend/analytics/events.ts payload-office-platform/src/components/frontend/landing "payload-office-platform/src/app/(frontend)/entrust/page.tsx" "payload-office-platform/src/app/(frontend)/publish/page.tsx"
git commit -m "feat(analytics): 两个落地页转化漏斗埋点

注册 landing_view/form_start/form_submit/form_success/form_error/bottom_cta_click；
属性只含 page_type/error_code/commission_months/field_completeness 枚举与计数，
不含手机号、楼盘名、地址、路径（受 assertSafeAnalyticsProps 白名单约束）。"
```

---

## Task 11: SEO 收口（sitemap 静态项）

**Files:**
- Modify: `src/app/(frontend)/sitemap.ts`

**Interfaces:**
- Consumes: Task 7 / Task 8 的两个路由
- Produces: sitemap 含 `/entrust` 与 `/publish`

- [ ] **Step 1: 加静态项**

在 `src/app/(frontend)/sitemap.ts` 的静态条目列表里（`:109-111` 附近，`/listings` 那条之后）加两条：

```ts
    {
      url: `${base}/entrust`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${base}/publish`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
```

优先级取 0.7：低于列表页（0.9）、高于内容页（0.6）——这两页是转化入口但内容量小。

- [ ] **Step 2: 烟测 sitemap**

```bash
cd payload-office-platform && PORT=3719 pnpm dev
```

```bash
curl -s http://localhost:3719/sitemap.xml | grep -c -e '/entrust' -e '/publish'
```

Expected: `2`

- [ ] **Step 3: 提交**

```bash
git add "payload-office-platform/src/app/(frontend)/sitemap.ts"
git commit -m "feat(seo): sitemap 收录 /entrust 与 /publish"
```

---

## Task 12: E2E 与整体验证

**Files:**
- Create: `tests/e2e/landing-pages.spec.ts`

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 两页的成功提交与校验失败 E2E 覆盖

- [ ] **Step 1: 写 E2E**

创建 `tests/e2e/landing-pages.spec.ts`（先看 `tests/e2e/inquiry-flow.spec.ts` 的 baseURL 与前置约定，保持一致）：

```ts
import { expect, test } from '@playwright/test'

/**
 * E2E：委托找房 / 投放房源 落地页
 *
 * 守护不变量：
 *   - 导航为 6 项且不含「服务式办公」；
 *   - /entrust 单手机号：非法内联报错、合法提交后就地成功态且 URL 不变；
 *   - /publish 6 字段：空提交内联报错且不丢已填内容、合法提交后成功态；
 *   - 375px 视口下两页均无横向滚动。
 */

/** 每次运行用不同手机号尾号，避免与历史数据的幂等键冲突 */
const uniqueSuffix = () => String(Date.now()).slice(-4)

test.describe('主导航入口调整', () => {
  test('导航为 6 项且不含服务式办公', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: '主导航' })
    await expect(nav.getByRole('link')).toHaveCount(6)
    await expect(nav.getByRole('link', { name: '服务式办公' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: '委托找房' })).toBeVisible()
    await expect(nav.getByRole('link', { name: '投放房源' })).toBeVisible()
  })
})

test.describe('/entrust 委托找房', () => {
  test('非法手机号内联报错', async ({ page }) => {
    await page.goto('/entrust')
    await page.getByLabel('手机号').fill('123')
    await page.getByRole('button', { name: '免费委托' }).click()
    await expect(page.getByRole('alert')).toContainText('11 位手机号')
  })

  test('合法提交后就地成功态，URL 不变', async ({ page }) => {
    await page.goto('/entrust')
    await page.getByLabel('手机号').fill(`1380000${uniqueSuffix()}`)
    await page.getByRole('button', { name: '免费委托' }).click()
    await expect(page.getByRole('status')).toContainText('已收到您的委托')
    expect(new URL(page.url()).pathname).toBe('/entrust')
  })

  test('页尾 CTA 把焦点送回首屏输入框', async ({ page }) => {
    await page.goto('/entrust')
    await page.getByRole('button', { name: '免费委托定制' }).click()
    await expect(page.getByLabel('手机号')).toBeFocused()
  })

  test('375px 视口无横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/entrust')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow).toBe(false)
  })
})

test.describe('/publish 投放房源', () => {
  test('空提交报必填错误且保留已填内容', async ({ page }) => {
    await page.goto('/publish')
    await page.getByLabel('楼盘名称').fill('E2E 测试楼盘')
    await page.getByRole('button', { name: '立即投放' }).click()
    await expect(page.getByText('请输入详细地址')).toBeVisible()
    await expect(page.getByText('请输入出租面积')).toBeVisible()
    await expect(page.getByLabel('楼盘名称')).toHaveValue('E2E 测试楼盘')
  })

  test('佣金默认选中「无」，可切换', async ({ page }) => {
    await page.goto('/publish')
    await expect(page.getByRole('radio', { name: '无' })).toBeChecked()
    await page.getByRole('radio', { name: '1个月' }).check()
    await expect(page.getByRole('radio', { name: '1个月' })).toBeChecked()
  })

  test('合法提交后卡片变成功态', async ({ page }) => {
    await page.goto('/publish')
    await page.getByLabel('楼盘名称').fill(`E2E 楼盘 ${uniqueSuffix()}`)
    await page.getByLabel('详细地址').fill('1 号楼 6 层 601')
    await page.getByLabel('出租面积').fill('200')
    await page.getByLabel('手机号').fill(`1390000${uniqueSuffix()}`)
    await page.getByRole('button', { name: '立即投放' }).click()
    await expect(page.getByRole('status')).toContainText('已收到您的房源')
  })

  test('375px 视口无横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/publish')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(overflow).toBe(false)
  })
})
```

- [ ] **Step 2: 跑 E2E**

```bash
cd payload-office-platform && pnpm test:e2e --grep "委托找房|投放房源|主导航入口调整"
```

Expected: 全部通过。若因 Playwright 的 webServer 端口与本工作树 dev 端口冲突，按 `playwright.config.ts` 的既有约定调整（**不要**改成 3717）。

- [ ] **Step 3: 全量验证**

```bash
cd payload-office-platform && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: 四项全绿。构建输出中 `/entrust` 与 `/publish` 均为静态。

- [ ] **Step 4: 迁移可重放验证**

```bash
cd payload-office-platform && pnpm migrate:status && pnpm migrate:dry-run
```

Expected: 无 pending，dry-run 无 BLOCK。

- [ ] **Step 5: 提交并推分支**

```bash
git add payload-office-platform/tests/e2e/landing-pages.spec.ts
git commit -m "test(e2e): 覆盖委托找房/投放房源两页与导航调整"
git push -u origin claude/delegated-search-listing-pages-7eeeef
```

- [ ] **Step 6: 开 draft PR**

```bash
gh pr create --draft --base master --title "feat: 委托找房 / 投放房源 双落地页" --body "实施 docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md（v2）。

- 导航去掉「服务式办公」，新增「委托找房」「投放房源」（数据收敛到 lib/frontend/public-nav.ts）
- /entrust：单手机号零门槛留电，复用 /api/inquiries，新增 entrust 来源与无姓名兜底
- /publish：6 字段卡片（含佣金悬赏），新建 SupplySubmissions 集合与 /api/supply-submissions
- 两页全静态，配色沿用站内奶油+金色

待运营确认：landing-config.ts 里 ENTRUST_STATS 三个数字为占位口径，上线前需替换为真实数据（PRD §13 Q3）。"
```

---

## 附：未纳入本计划的范围（与 PRD §12 一致）

- 房源图片/平面图上传（对标站靠"实勘采集"由平台拍摄）
- 短信验证码校验
- PRD §4.6 的"提交成功后可选补充需求表单"（P1，等电话接通率数据再决定）
- 业主自助登录管理房源
- 多城市（MVP 固定上海，服务端写入默认城市）
- 需求与房源自动匹配推荐
- 佣金的线上支付/结算（只采集悬赏意愿）
- 后台「转为房源草稿」的一键预填按钮：本计划只建立 `convertedListing` 关系字段与 `supply_submission:convert` 权限编码，**自定义后台按钮组件未包含**。当前审单动作是人工新建 Listing 后回填关系字段。若要一键转草稿，需单独一个任务写 admin 自定义组件。
