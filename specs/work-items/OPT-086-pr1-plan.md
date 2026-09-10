# OPT-086 PR 1 实施计划：房源发布轴动作条（下架 / 标记已租 / 标记已售 / 重新上架）+ 列表单条下架

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 母文档：`OPT-086-listing-domain-workstation.md` §5.3（动作条）、§7 PR 1、§9（风险）
> 分支：`feat/opt-086-listing-unpublish-1e4e`（worktree `E:\wt-086`，基于 `origin/master` @ `868a45e`）
> 应用目录：`E:\wt-086\payload-office-platform`（下文路径均相对它）。**不要碰 `E:\github\sbh`**（主树在别的会话的分支上）。

**Goal:** 让运营能在后台把一套房源下架、标记已租 / 已售、重新上架——今天这三个动作只有端点没有界面。

**Architecture:** 端点 `POST /api/listings/:id/publish` 已完整（状态机、权限、原因必填、乐观锁、审计），本 PR **只加界面层**：一个纯函数按「当前发布态 × 租售类型 × 权限」算出可用动作；一个共享确认弹层负责「说明后果 → 填原因 → 带版本号提交 → 回执」；一个挂在编辑页 `beforeDocumentControls` 的动作条；房源列表操作列复用同一弹层做单条下架。顺带补端点一处不对称：`mark_sold` 与 `mark_leased` 同样撤销首页推荐。

**Tech Stack:** Payload 3.86（`beforeDocumentControls` 服务端组件槽 + `payload.findByID`）、Next.js 16、React 19、Arco Design（Modal / Button / Tag / Input.TextArea）、Vitest。

## Global Constraints

- **G1 不改端点契约**：`POST /api/listings/:id/publish` 的 body `{ action, reason?, expectedVersion? }` 与响应码 200/400/401/403/404/409/422 不变。唯一允许的行为变更：`mark_sold` 时 `isFeatured=false`（与 `mark_leased` 对称）。（终审追加的两处例外均由控制者批准：Task 5 的 422 `BUSINESS_TYPE_MISMATCH` 新增拒绝；终审修复波把 `unpublish` 的 `reason` 写入审计 `reason` 列——契约不变，只是原本被丢弃的字段开始落库。）
- **G2 不改状态机与权限**：`publication-status.ts` 的转移表、`permissionForAction`、权限码、角色数据、迁移一律不动。**没有 schema 变更**，本 PR 不新增迁移。
- **G3 客户端不复制业务规则**：可用动作只从 `canTransitionPublication` 派生（单测钉死「每个返回的动作都是合法转移」且「每个合法转移在有权限时都被返回」）；任何拒绝以服务端结论为准，客户端只展示。
- **G4 文案来源唯一**：动作名用 `PUBLISH_ACTION_LABELS`，状态名用 `PUBLICATION_STATUS_LABELS`，不另写一份。
- **G5 `mark_leased` / `mark_sold` 的确认文案必须明写「将同时撤销首页推荐」**；`unpublish` 的确认按钮在原因为空时禁用（不拿 422 当校验）；`publish` 的确认文案提示「需满足有效供给条件才会真正出现在前台」，422 时把端点返回的 `reasons` 逐条展示。
- **G6 乐观锁**：所有提交都带 `expectedVersion`（读取时的 `version`）；409 显示「本页数据已过期，请刷新后重试」并 `router.refresh()`。
- **G7 组件注册**：`Listings.ts` 的 `admin.components.edit.beforeDocumentControls` 追加 `'/components/admin/ListingPublicationActions'`（放在 `FormModifiedBridge` **之前**）；之后必须 `pnpm payload generate:importmap` 并把 `src/app/(payload)/admin/importMap.js` 一起提交（漏了 `/admin` 白屏）。该提交会被 pre-commit「改 collection 没带迁移」拦下——**仅这一个提交**使用 `SKIP_MIGRATION_CHECK=1`，且必须已获用户确认（控制者会在派发时写明）。
- **G8 不新增依赖**；图标只用 `@arco-design/web-react/icon`；不用 `any` / `as any` / `@ts-ignore`；注释简体中文说明「为什么」。
- **G9 提交纪律**：只用显式 `git add <路径>`；禁 `-A` / `.` / `-am`；禁 `--no-verify`；不碰 `public/prd/*`；不 push。提交前 `pnpm typecheck && pnpm lint && pnpm test` 全绿（开发中可跑局部）。
- **G10 不改文档**（`specs/`、`artifacts/`、`.agent/`、`CLAUDE.md`）；不改 `payload.config.ts`；不改 `tests/e2e/` 以外的 e2e（Task 4 只新增一个 spec）。
- **G11 浏览器验收由控制者做**（宪章：typecheck + 单测 + CI ≠ 可用）；实施代理不需要截图，但 Task 2/3 完成后要用 `curl` 确认 `/admin` 与 `/admin/login` 仍返回 200（importMap 没漏）。本树 dev server 由控制者按需起在 3721 端口（`launch.json` 的 `opt086-dev`），实施代理不要自己起 server。

## 文件结构

| 文件 | 职责 | 任务 |
|---|---|---|
| `src/domain/listing/publication-actions.ts`（新） | 纯函数：可用动作表 + 每个动作的确认文案元数据 | T1 |
| `tests/listing-publication-actions.test.ts`（新） | T1 的单测（含与状态机一致性的穷举） | T1 |
| `src/endpoints/listing-publish-endpoint.ts` | `mark_sold` 撤销推荐（4 行）+ 头注释补 `mark_sold` | T1 |
| `tests/listing-publish-endpoint.test.ts` | `mark_sold` 副作用用例 | T1 |
| `src/components/admin/ListingPublicationActionModal.tsx`（新，client） | 共享确认弹层：后果说明、原因输入、提交、回执 | T2 |
| `src/components/admin/ListingPublicationActionsClient.tsx`（新，client） | 编辑页动作条：状态标签 + 动作按钮，打开弹层 | T2 |
| `src/components/admin/ListingPublicationActions.tsx`（新，server） | 读文档 + 权限上下文 → 算可用动作 → 渲染客户端 | T2 |
| `src/collections/Listings.ts:196-198` | 注册 `beforeDocumentControls` | T2 |
| `src/app/(payload)/admin/importMap.js` | 重生成 | T2 |
| `tests/listing-publication-actions-registration.test.ts`（新） | 源码守卫：Listings.ts 注册了组件、importMap 含该组件 | T2 |
| `src/components/admin/ListingsListViewClient.tsx:343-366` | 操作列加「下架」，复用弹层 | T3 |
| `tests/e2e/listing-publication-actions.spec.ts`（新） | ADM 下架一套已上架房源 → 状态、审计、再上架恢复 | T4 |

---

### Task 1：可用动作纯函数 + 端点 `mark_sold` 对称

**Files:**
- Create: `src/domain/listing/publication-actions.ts`
- Create: `tests/listing-publication-actions.test.ts`
- Modify: `src/endpoints/listing-publish-endpoint.ts:17-18`（头注释）、`:166-177`（副作用）
- Modify: `tests/listing-publish-endpoint.test.ts`（新增用例）

**Interfaces:**
- Consumes: `canTransitionPublication`, `PUBLISH_ACTIONS`, `PUBLISH_ACTION_LABELS`, `PUBLICATION_STATUS_LABELS`, `PublicationStatus`, `PublishAction` from `@/domain/review/publication-status`。
- Produces（T2/T3 依赖，签名逐字）：

```ts
export type PublicationActionSpec = {
  action: PublishAction
  label: string                 // 来自 PUBLISH_ACTION_LABELS
  /** 按钮语义：primary=上架类，warning=下架，danger=成交终态（不可逆） */
  tone: 'primary' | 'warning' | 'danger'
  requiresReason: boolean       // 仅 unpublish 为 true
  /** 确认弹层标题与正文（正文逐段，客户端逐段渲染） */
  confirmTitle: string
  confirmBody: readonly string[]
}

export type PublicationActionInput = {
  publicationStatus: PublicationStatus
  /** 'lease' | 'sale'；缺省按 lease */
  businessType: string | null | undefined
  canPublish: boolean          // hasOperationPermission('listing:publish')
  canUnpublish: boolean        // hasOperationPermission('listing:unpublish')
}

export function availablePublicationActions(input: PublicationActionInput): readonly PublicationActionSpec[]
export function permissionForPublishAction(action: PublishAction): 'listing:publish' | 'listing:unpublish'
```

规则（写进函数注释）：
- 候选 = `PUBLISH_ACTIONS` 中满足 `canTransitionPublication(status, action)` 的动作；
- `mark_leased` 只在 `businessType !== 'sale'` 时出现，`mark_sold` 只在 `businessType === 'sale'` 时出现（租售分开，同一房源只给一个成交动作）；
- `unpublish` 需 `canUnpublish`，其余需 `canPublish`；
- 顺序固定：`publish` → `unpublish` → `mark_leased` → `mark_sold`；
- 文案：`publish` 标题 `重新上架` 若当前 `unpublished`，否则 `发布`；正文含「需满足有效供给条件才会真正出现在前台」；`unpublish` 正文含「下架后前台立即不可见」「必须填写下架原因」；`mark_leased` / `mark_sold` 正文含「将同时撤销首页推荐」和「成交为终态，不可撤销」。

- [ ] **Step 1: 写失败测试** `tests/listing-publication-actions.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  availablePublicationActions,
  permissionForPublishAction,
} from '@/domain/listing/publication-actions'
import {
  PUBLICATION_STATUSES,
  PUBLISH_ACTIONS,
  PUBLISH_ACTION_LABELS,
  canTransitionPublication,
} from '@/domain/review/publication-status'

const full = { canPublish: true, canUnpublish: true }

describe('availablePublicationActions', () => {
  it('已上架的租赁房源：下架 + 标记已租，顺序固定', () => {
    const actions = availablePublicationActions({
      publicationStatus: 'published', businessType: 'lease', ...full,
    }).map((a) => a.action)
    expect(actions).toEqual(['unpublish', 'mark_leased'])
  })

  it('已上架的出售房源：下架 + 标记已售，不给标记已租', () => {
    const actions = availablePublicationActions({
      publicationStatus: 'published', businessType: 'sale', ...full,
    }).map((a) => a.action)
    expect(actions).toEqual(['unpublish', 'mark_sold'])
  })

  it('已下架：重新上架 + 成交；标题写「重新上架」', () => {
    const specs = availablePublicationActions({
      publicationStatus: 'unpublished', businessType: 'lease', ...full,
    })
    expect(specs.map((a) => a.action)).toEqual(['publish', 'mark_leased'])
    expect(specs[0].confirmTitle).toContain('重新上架')
  })

  it('终态（leased / sold）没有任何动作', () => {
    for (const status of ['leased', 'sold'] as const) {
      expect(availablePublicationActions({ publicationStatus: status, businessType: null, ...full })).toEqual([])
    }
  })

  it('无 listing:unpublish 时不给下架；无 listing:publish 时不给上架与成交', () => {
    expect(
      availablePublicationActions({ publicationStatus: 'published', businessType: 'lease', canPublish: true, canUnpublish: false }).map((a) => a.action),
    ).toEqual(['mark_leased'])
    expect(
      availablePublicationActions({ publicationStatus: 'published', businessType: 'lease', canPublish: false, canUnpublish: true }).map((a) => a.action),
    ).toEqual(['unpublish'])
  })

  it('与状态机一致：返回的每个动作都是合法转移；有权限时每个合法转移都被返回（按租售各取一个成交动作）', () => {
    for (const status of PUBLICATION_STATUSES) {
      for (const businessType of ['lease', 'sale'] as const) {
        const returned = availablePublicationActions({ publicationStatus: status, businessType, ...full }).map((a) => a.action)
        for (const action of returned) expect(canTransitionPublication(status, action)).toBe(true)
        const expected = PUBLISH_ACTIONS.filter((action) => {
          if (!canTransitionPublication(status, action)) return false
          if (action === 'mark_leased') return businessType !== 'sale'
          if (action === 'mark_sold') return businessType === 'sale'
          return true
        })
        expect([...returned].sort()).toEqual([...expected].sort())
      }
    }
  })

  it('文案来自 PUBLISH_ACTION_LABELS；成交动作正文明写撤销推荐；下架要求原因', () => {
    const specs = availablePublicationActions({ publicationStatus: 'published', businessType: 'lease', ...full })
    for (const s of specs) expect(s.label).toBe(PUBLISH_ACTION_LABELS[s.action])
    const unpublish = specs.find((s) => s.action === 'unpublish')!
    expect(unpublish.requiresReason).toBe(true)
    expect(unpublish.tone).toBe('warning')
    const leased = specs.find((s) => s.action === 'mark_leased')!
    expect(leased.requiresReason).toBe(false)
    expect(leased.tone).toBe('danger')
    expect(leased.confirmBody.join('')).toContain('撤销首页推荐')
    expect(leased.confirmBody.join('')).toContain('不可撤销')
  })
})

describe('permissionForPublishAction', () => {
  it('unpublish → listing:unpublish，其余 → listing:publish（与端点 permissionForAction 同口径）', () => {
    expect(permissionForPublishAction('unpublish')).toBe('listing:unpublish')
    for (const a of ['publish', 'mark_leased', 'mark_sold'] as const) expect(permissionForPublishAction(a)).toBe('listing:publish')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/listing-publication-actions.test.ts`
Expected: FAIL，模块 `@/domain/listing/publication-actions` 不存在。

- [ ] **Step 3: 实现** `src/domain/listing/publication-actions.ts`

```ts
import {
  PUBLICATION_STATUS_LABELS,
  PUBLISH_ACTIONS,
  PUBLISH_ACTION_LABELS,
  canTransitionPublication,
  type PublicationStatus,
  type PublishAction,
} from '@/domain/review/publication-status'

export type PublicationActionSpec = {
  action: PublishAction
  label: string
  tone: 'primary' | 'warning' | 'danger'
  requiresReason: boolean
  confirmTitle: string
  confirmBody: readonly string[]
}

export type PublicationActionInput = {
  publicationStatus: PublicationStatus
  businessType: string | null | undefined
  canPublish: boolean
  canUnpublish: boolean
}

/** 与 listing-publish-endpoint.ts 的 permissionForAction 同口径；端点是唯一强制点，这里只用来决定按钮显隐。 */
export function permissionForPublishAction(action: PublishAction): 'listing:publish' | 'listing:unpublish' {
  return action === 'unpublish' ? 'listing:unpublish' : 'listing:publish'
}

/**
 * 房源编辑页动作条的可用动作。
 *
 * 候选只从 canTransitionPublication 派生——客户端绝不复制转移表，否则状态机改了
 * 这里不会红。租赁房源只给「标记已租」、出售房源只给「标记已售」：同一套房源给两个
 * 成交按钮，运营点错一个就是不可逆的口径错误（leased/sold 分开的理由见 publication-status.ts）。
 * 不可用的动作不返回（不渲染），不是禁用：一个灰按钮要解释「为什么灰」，不渲染不用解释。
 */
export function availablePublicationActions(
  input: PublicationActionInput,
): readonly PublicationActionSpec[] {
  const isSale = input.businessType === 'sale'
  const specs: PublicationActionSpec[] = []
  for (const action of PUBLISH_ACTIONS) {
    if (!canTransitionPublication(input.publicationStatus, action)) continue
    if (action === 'mark_leased' && isSale) continue
    if (action === 'mark_sold' && !isSale) continue
    const allowed = action === 'unpublish' ? input.canUnpublish : input.canPublish
    if (!allowed) continue
    specs.push(specFor(action, input.publicationStatus))
  }
  return specs
}

function specFor(action: PublishAction, status: PublicationStatus): PublicationActionSpec {
  const label = PUBLISH_ACTION_LABELS[action]
  const current = PUBLICATION_STATUS_LABELS[status]
  switch (action) {
    case 'publish':
      return {
        action, label, tone: 'primary', requiresReason: false,
        confirmTitle: status === 'unpublished' ? '重新上架' : label,
        confirmBody: [
          `当前状态：${current} → 已发布。`,
          '房源需满足有效供给条件（审核通过、楼盘与商户启用、商户资质有效等）才会真正出现在前台；不满足时会列出原因，不改状态。',
        ],
      }
    case 'unpublish':
      return {
        action, label, tone: 'warning', requiresReason: true,
        confirmTitle: label,
        confirmBody: [
          `当前状态：${current} → 已下架。下架后前台立即不可见。`,
          '必须填写下架原因，会记入审计。',
        ],
      }
    case 'mark_leased':
    case 'mark_sold':
      return {
        action, label, tone: 'danger', requiresReason: false,
        confirmTitle: label,
        confirmBody: [
          `当前状态：${current} → ${action === 'mark_leased' ? '已租' : '已售'}。`,
          '将同时撤销首页推荐，并收回前台可见。',
          '成交为终态，不可撤销；要重新出租或出售请新建房源。',
        ],
      }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/listing-publication-actions.test.ts`
Expected: PASS（8 用例）。

- [ ] **Step 5: 端点 `mark_sold` 对称——先写失败测试**

在 `tests/listing-publish-endpoint.test.ts` 里紧挨既有的 `mark_leased` 副作用用例（`rg "isFeatured" tests/listing-publish-endpoint.test.ts` 定位）追加：

```ts
it('mark_sold：与 mark_leased 对称，publicationStatus=sold 且 isFeatured=false', async () => {
  const { req, update } = makeReq({
    listing: makeEffectiveListing({ publicationStatus: 'published', businessType: 'sale', isFeatured: true }),
    body: { action: 'mark_sold' },
  })
  const res = await run(req)
  expect(res.status).toBe(200)
  expect(res.body).toEqual({ ok: true, publicationStatus: 'sold' })
  expect(update).toHaveBeenCalledTimes(1)
  expect(update.mock.calls[0][0].data).toEqual({ publicationStatus: 'sold', isFeatured: false })
})
```

Run: `pnpm exec vitest run tests/listing-publish-endpoint.test.ts -t mark_sold`
Expected: FAIL（`data` 只有 `publicationStatus`，没有 `isFeatured`）。

- [ ] **Step 6: 改端点**

`src/endpoints/listing-publish-endpoint.ts`：
- 头注释 `:18` 改为 `action ∈ publish | unpublish | mark_leased | mark_sold`，`:25` 后补一行 `- mark_sold 同 mark_leased（撤销推荐 + 收回可见，落 sold）。`
- `:166-177` 把两处 `action === 'mark_leased'` 改为 `action === 'mark_leased' || action === 'mark_sold'`，注释改为「成交（已租 / 已售）自动撤销推荐——已售房源留在首页推荐位是比已租更明显的错误」。

Run: `pnpm exec vitest run tests/listing-publish-endpoint.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 7: 提交**

```bash
git add src/domain/listing/publication-actions.ts tests/listing-publication-actions.test.ts src/endpoints/listing-publish-endpoint.ts tests/listing-publish-endpoint.test.ts
git commit -m "feat(listing): 发布轴可用动作纯函数；mark_sold 与 mark_leased 同样撤销推荐（OPT-086 PR1）"
```

（本提交不改 collection，pre-commit 不会拦。）

---

### Task 2：共享确认弹层 + 编辑页动作条 + 注册

**Files:**
- Create: `src/components/admin/ListingPublicationActionModal.tsx`
- Create: `src/components/admin/ListingPublicationActionsClient.tsx`
- Create: `src/components/admin/ListingPublicationActions.tsx`
- Modify: `src/collections/Listings.ts:196-198`
- Regenerate: `src/app/(payload)/admin/importMap.js`
- Create: `tests/listing-publication-actions-registration.test.ts`

**Interfaces:**
- Consumes（T1）：`availablePublicationActions`, `PublicationActionSpec` from `@/domain/listing/publication-actions`；`PUBLICATION_STATUS_LABELS`, `isPublicationStatus`, `PublicationStatus` from `@/domain/review/publication-status`；`buildPermissionContext`, `hasOperationPermission` from `@/domain/auth/permission-context`（用法照抄 `src/components/admin/ListingReviewQueue.tsx:43-60`）。
- Produces（T3 依赖，逐字）：

```ts
// ListingPublicationActionModal.tsx ('use client')
export type ListingPublicationActionModalProps = {
  listingId: string
  listingTitle: string
  spec: PublicationActionSpec | null   // null = 关闭
  /** 读取时的版本号，作为 expectedVersion；null 表示不带乐观锁 */
  version: number | null
  onClose: () => void
  /** 成功后调用（调用方负责 router.refresh() 或本地刷新） */
  onDone: (next: PublicationStatus) => void
}
export default function ListingPublicationActionModal(props: ListingPublicationActionModalProps): JSX.Element | null
```

- [ ] **Step 1: 源码守卫测试（先写，先红）** `tests/listing-publication-actions-registration.test.ts`

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const read = (p: string) => readFileSync(resolve(here, '..', p), 'utf8')

/**
 * 动作条是 beforeDocumentControls 服务端组件：注册漏了不会报错，页面只是没有按钮
 * （OPT-053「菜单渲染正常、点进去没有」同类事故）；importMap 漏重生成则 /admin 整站白屏。
 * 两条都是静默失效，所以钉在源码上。
 */
describe('ListingPublicationActions 注册', () => {
  it('Listings.ts 在 beforeDocumentControls 里注册了动作条，且排在 FormModifiedBridge 之前', () => {
    const src = read('src/collections/Listings.ts')
    const block = /beforeDocumentControls:\s*\[([\s\S]*?)\]/.exec(src)?.[1] ?? ''
    const actions = block.indexOf("'/components/admin/ListingPublicationActions'")
    const bridge = block.indexOf("'/components/admin/unsaved-changes/FormModifiedBridge'")
    expect(actions).toBeGreaterThanOrEqual(0)
    expect(bridge).toBeGreaterThan(actions)
  })

  it('importMap.js 已包含动作条服务端组件（否则 /admin 白屏）', () => {
    const map = read('src/app/(payload)/admin/importMap.js')
    expect(map).toContain('ListingPublicationActions')
  })
})
```

Run: `pnpm exec vitest run tests/listing-publication-actions-registration.test.ts`
Expected: FAIL（两条都红）。

- [ ] **Step 2: 共享弹层** `src/components/admin/ListingPublicationActionModal.tsx`

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Input, Message, Modal, Typography } from '@arco-design/web-react'

import type { PublicationActionSpec } from '@/domain/listing/publication-actions'
import { isPublicationStatus, type PublicationStatus } from '@/domain/review/publication-status'

const { Paragraph, Text } = Typography

export type ListingPublicationActionModalProps = {
  listingId: string
  listingTitle: string
  spec: PublicationActionSpec | null
  version: number | null
  onClose: () => void
  onDone: (next: PublicationStatus) => void
}

type PublishResponse = {
  ok?: boolean
  publicationStatus?: unknown
  error?: string
  code?: string
  reasons?: unknown
}

/**
 * 发布轴动作的共享确认弹层（编辑页动作条与列表「下架」共用）。
 *
 * 所有规则都在端点：这里只做三件事——把后果说清楚、下架时收原因、带 expectedVersion 提交。
 * 409（版本冲突 / 非法转移）与 422（前置不满足 / 缺原因）都把端点文案原样展示，
 * 不自己翻译成「操作失败」——运营需要知道是「别人改过了」还是「商户资质过期」。
 */
export default function ListingPublicationActionModal({
  listingId, listingTitle, spec, version, onClose, onDone,
}: ListingPublicationActionModalProps) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasons, setReasons] = useState<string[]>([])

  // 每次打开都从干净状态开始：上一次的原因与错误不该带进下一次确认
  useEffect(() => {
    if (spec) { setReason(''); setError(null); setReasons([]) }
  }, [spec])

  if (!spec) return null

  const reasonMissing = spec.requiresReason && reason.trim().length === 0

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    setReasons([])
    try {
      const res = await fetch(`/api/listings/${listingId}/publish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: spec.action,
          ...(spec.requiresReason ? { reason: reason.trim() } : {}),
          ...(version !== null ? { expectedVersion: version } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as PublishResponse
      if (res.ok && data.ok && isPublicationStatus(data.publicationStatus)) {
        Message.success(`已${spec.label}`)
        onDone(data.publicationStatus)
        onClose()
        return
      }
      if (res.status === 409 && data.code === 'VERSION_CONFLICT') {
        setError('本页数据已过期，请刷新后重试')
      } else if (res.status === 401 || res.status === 403) {
        setError('没有执行该动作的权限')
      } else {
        setError(data.error ?? `${spec.label}失败（HTTP ${res.status}）`)
      }
      if (Array.isArray(data.reasons)) {
        setReasons(data.reasons.filter((r): r is string => typeof r === 'string'))
      }
    } catch {
      setError('网络异常，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={`${spec.confirmTitle}${listingTitle ? `「${listingTitle}」` : ''}`}
      visible
      onCancel={onClose}
      onOk={submit}
      confirmLoading={submitting}
      okText={`确认${spec.label}`}
      cancelText="取消"
      okButtonProps={{
        status: spec.tone === 'primary' ? 'default' : spec.tone,
        disabled: reasonMissing,
      }}
    >
      {spec.confirmBody.map((line) => (
        <Paragraph key={line}>{line}</Paragraph>
      ))}
      {spec.requiresReason ? (
        <Input.TextArea
          value={reason}
          onChange={setReason}
          placeholder="下架原因（必填，记入审计）"
          autoSize={{ minRows: 2, maxRows: 5 }}
          maxLength={200}
          showWordLimit
        />
      ) : null}
      {error ? (
        <Paragraph style={{ marginTop: 12 }}>
          <Text type="error">{error}</Text>
        </Paragraph>
      ) : null}
      {reasons.length > 0 ? (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {reasons.map((r) => (
            <li key={r}><Text type="error">{r}</Text></li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}
```

> 端点 409 的 `code` 字段名以 `rg "code: '" src/endpoints/listing-publish-endpoint.ts` 为准（版本冲突与非法转移各有一个码）；若没有 `code`，按 `error` 文案原样展示。`okButtonProps.status` 只接受 `'warning' | 'danger' | 'success' | 'default'`。

- [ ] **Step 3: 动作条客户端** `src/components/admin/ListingPublicationActionsClient.tsx`

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Space, Tag, Typography } from '@arco-design/web-react'

import type { PublicationActionSpec } from '@/domain/listing/publication-actions'
import { PUBLICATION_STATUS_LABELS, type PublicationStatus } from '@/domain/review/publication-status'
import ListingPublicationActionModal from './ListingPublicationActionModal'

const { Text } = Typography

type Props = {
  listingId: string
  listingTitle: string
  publicationStatus: PublicationStatus
  version: number | null
  actions: readonly PublicationActionSpec[]
}

const STATUS_COLOR: Record<PublicationStatus, string> = {
  draft: 'gray', published: 'green', unpublished: 'orange', leased: 'blue', sold: 'purple',
}

/**
 * 编辑页顶部的发布轴动作条。可用动作由服务端算好传进来（按当前状态 × 租售 × 权限），
 * 这里只渲染；动作为空时只显示状态标签，不显示任何按钮——终态（已租 / 已售）就是这种情况。
 */
export default function ListingPublicationActionsClient({
  listingId, listingTitle, publicationStatus, version, actions,
}: Props) {
  const router = useRouter()
  const [active, setActive] = useState<PublicationActionSpec | null>(null)

  return (
    <div className="listing-publication-actions">
      <Space align="center" wrap>
        <Text type="secondary" style={{ fontSize: 12 }}>发布状态</Text>
        <Tag color={STATUS_COLOR[publicationStatus]}>{PUBLICATION_STATUS_LABELS[publicationStatus]}</Tag>
        {actions.map((spec) => (
          <Button
            key={spec.action}
            size="small"
            type={spec.tone === 'primary' ? 'primary' : 'outline'}
            status={spec.tone === 'primary' ? 'default' : spec.tone}
            onClick={() => setActive(spec)}
          >
            {spec.label}
          </Button>
        ))}
      </Space>
      <ListingPublicationActionModal
        listingId={listingId}
        listingTitle={listingTitle}
        spec={active}
        version={version}
        onClose={() => setActive(null)}
        onDone={() => router.refresh()}
      />
    </div>
  )
}
```

- [ ] **Step 4: 动作条服务端** `src/components/admin/ListingPublicationActions.tsx`

```tsx
import type { BeforeDocumentControlsServerProps } from 'payload'

import { availablePublicationActions } from '@/domain/listing/publication-actions'
import { buildPermissionContext, hasOperationPermission } from '@/domain/auth/permission-context'
import { isPublicationStatus } from '@/domain/review/publication-status'
import type { Role, User } from '@/payload-types'
import ListingPublicationActionsClient from './ListingPublicationActionsClient'

/**
 * 房源发布轴动作条 - 服务端（OPT-086 PR1）。
 *
 * 落点与楼盘启停按钮同一个槽（beforeDocumentControls）。该槽只给 { id, payload, user, ... }，
 * 不给 doc，所以用 payload.findByID 读回发布态 / 租售 / 版本 / 标题（同 BuildingOperationalToggle）。
 * 权限只决定按钮显隐；端点才是强制点（隐藏按钮不是权限控制，.agent/permissions.md）。
 * 新建（无 id）不渲染：没保存的房源没有发布轴。
 */
export default async function ListingPublicationActions({
  id, payload, user,
}: BeforeDocumentControlsServerProps) {
  if (id === undefined || id === null || id === '' || !user) return null

  let doc: Record<string, unknown> | null = null
  try {
    doc = (await payload.findByID({
      collection: 'listings', id, depth: 0, overrideAccess: true,
    })) as unknown as Record<string, unknown>
  } catch {
    return null
  }
  if (!doc || !isPublicationStatus(doc.publicationStatus)) return null

  const ctx = await buildPermissionContext({
    user: user as unknown as Pick<User, 'id' | 'roles' | 'cityScope' | 'status' | 'sessionVersion'>,
    loadRoles: async (roleIds) => {
      const docs = await payload.find({
        collection: 'roles', where: { id: { in: roleIds } }, depth: 0, overrideAccess: true, limit: roleIds.length,
      })
      return docs.docs as unknown as Role[]
    },
  })
  if (!ctx) return null

  const actions = availablePublicationActions({
    publicationStatus: doc.publicationStatus,
    businessType: typeof doc.businessType === 'string' ? doc.businessType : null,
    canPublish: hasOperationPermission(ctx, 'listing:publish'),
    canUnpublish: hasOperationPermission(ctx, 'listing:unpublish'),
  })

  return (
    <ListingPublicationActionsClient
      listingId={String(id)}
      listingTitle={typeof doc.title === 'string' ? doc.title : ''}
      publicationStatus={doc.publicationStatus}
      version={typeof doc.version === 'number' ? doc.version : null}
      actions={actions}
    />
  )
}
```

> `buildPermissionContext` 的参数形状以 `src/components/admin/ListingReviewQueue.tsx:43-60` 为准照抄；`user` 的类型转换若那里用了不同写法，跟那里一致。

- [ ] **Step 5: 注册 + 重生成 importMap**

`src/collections/Listings.ts:196-198`：

```ts
      edit: {
        // OPT-086 PR1：发布轴动作条（下架 / 标记已租 / 已售 / 重新上架），权限与状态机在端点强制。
        // OPT-030 P0-2：表单修改态桥，把 useFormModified 同步给根部离开守卫。
        beforeDocumentControls: [
          '/components/admin/ListingPublicationActions',
          '/components/admin/unsaved-changes/FormModifiedBridge',
        ],
      },
```

Run: `pnpm payload generate:importmap`，然后 `git diff --stat src/app/(payload)/admin/importMap.js` 应显示有改动。

- [ ] **Step 6: 跑守卫 + typecheck**

Run: `pnpm exec vitest run tests/listing-publication-actions-registration.test.ts && pnpm typecheck`
Expected: PASS；typecheck 无错。

- [ ] **Step 7: 冒烟**

`curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3721/admin/login`（若控制者已起 server；没起则跳过并在报告里说明）。

- [ ] **Step 8: 全量检查后提交（本提交需 `SKIP_MIGRATION_CHECK=1`，控制者已确认）**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/components/admin/ListingPublicationActionModal.tsx src/components/admin/ListingPublicationActionsClient.tsx src/components/admin/ListingPublicationActions.tsx src/collections/Listings.ts "src/app/(payload)/admin/importMap.js" tests/listing-publication-actions-registration.test.ts
SKIP_MIGRATION_CHECK=1 git commit -m "feat(admin): 房源编辑页发布轴动作条——下架 / 标记已租 / 已售 / 重新上架（OPT-086 PR1）"
```

---

### Task 3：房源列表操作列「下架」

**Files:**
- Modify: `src/components/admin/ListingsListViewClient.tsx:1-16`（import）、`:343-366`（操作列）、组件顶层 state

**Interfaces:**
- Consumes（T1/T2）：`availablePublicationActions` + `ListingPublicationActionModal`。列表行只提供 `unpublish`：`availablePublicationActions({ publicationStatus, businessType: row.businessType, canPublish: false, canUnpublish: true })` 取 `action === 'unpublish'` 的 spec——这样文案与编辑页完全同源。
- 列表侧权限：服务端 `ListingsListView.tsx` 已能拿到 `user`（`rg buildPermissionContext src/components/admin/ListingsListView.tsx`，若没有则照 `ListingReviewQueue.tsx` 加），新增 prop `canUnpublish: boolean` 传给客户端；无权限时不渲染按钮。

- [ ] **Step 1: 服务端补 `canUnpublish`**

在 `src/components/admin/ListingsListView.tsx` 里构造权限上下文（若已有则复用），`canUnpublish = hasOperationPermission(ctx, 'listing:unpublish')`，透传给 `<ListingsListViewClient canUnpublish={canUnpublish} … />`；`Props` 接口加 `canUnpublish: boolean`。

- [ ] **Step 2: 客户端**

```tsx
// import
import ListingPublicationActionModal from './ListingPublicationActionModal'
import { availablePublicationActions, type PublicationActionSpec } from '@/domain/listing/publication-actions'
import { isPublicationStatus } from '@/domain/review/publication-status'

// 组件内 state
const [unpublishTarget, setUnpublishTarget] = useState<{ row: ListingRow; spec: PublicationActionSpec } | null>(null)

// 操作列（替换 :348-364 的 render）
render: (_: unknown, row: ListingRow) => {
  const spec =
    canUnpublish && isPublicationStatus(row.publicationStatus)
      ? availablePublicationActions({
          publicationStatus: row.publicationStatus,
          businessType: row.businessType,
          canPublish: false,
          canUnpublish: true,
        }).find((s) => s.action === 'unpublish') ?? null
      : null
  return (
    <Space size={4}>
      <Button size="mini" href={`/admin/collections/listings/${row.id}`}>编辑</Button>
      {row.slug && row.publicationStatus === 'published' ? (
        <Button size="mini" type="text" href={`/listings/${row.slug}`} target="_blank">前台</Button>
      ) : null}
      {spec ? (
        <Button size="mini" type="text" status="warning" onClick={() => setUnpublishTarget({ row, spec })}>
          下架
        </Button>
      ) : null}
    </Space>
  )
},

// 表格下方渲染弹层
<ListingPublicationActionModal
  listingId={unpublishTarget ? String(unpublishTarget.row.id) : ''}
  listingTitle={unpublishTarget?.row.title ?? ''}
  spec={unpublishTarget?.spec ?? null}
  version={unpublishTarget?.row.version ?? null}
  onClose={() => setUnpublishTarget(null)}
  onDone={() => router.refresh()}
/>
```

操作列 `width` 从 132 调到 180；`useMemo` 依赖数组加 `canUnpublish`。

- [ ] **Step 3: 验证与提交**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 全绿（本任务不新增单测——行为由 T4 的 e2e 与控制者浏览器验收覆盖；把「为什么不单测」写进报告）。

```bash
git add src/components/admin/ListingsListView.tsx src/components/admin/ListingsListViewClient.tsx
git commit -m "feat(admin): 房源列表操作列加「下架」，复用发布轴确认弹层（OPT-086 PR1）"
```

---

### Task 4：e2e——ADM 下架一套已上架房源并恢复

**Files:**
- Create: `tests/e2e/listing-publication-actions.spec.ts`

**Interfaces:**
- Consumes：T2 的 DOM——动作条根 `.listing-publication-actions`，按钮文本 `下架` / `重新上架` / `标记已租`；弹层 `Input.TextArea` 的 placeholder `下架原因（必填，记入审计）`；确认按钮文本 `确认下架` / `确认重新上架`。

- [ ] **Step 1: 写 spec**

```ts
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const ADM = { email: 'e2e-adm@example.com', password: 'Test1234!' }

async function login(page: Page): Promise<APIRequestContext> {
  const response = await page.request.post('/api/users/login', { data: ADM, failOnStatusCode: false })
  expect(response.status(), 'ADM 测试账号应成功登录').toBe(200)
  return page.request
}

/** 取一套已上架且未被举报暂停的租赁房源；不写死 id，seed 会漂。 */
async function pickPublishedListing(request: APIRequestContext): Promise<{ id: number; version: number }> {
  const res = await request.get(
    '/api/listings?limit=1&depth=0&where[publicationStatus][equals]=published&where[businessType][equals]=lease&where[supplyVisibilityHold][equals]=normal',
  )
  expect(res.status()).toBe(200)
  const doc = (await res.json())?.docs?.[0]
  expect(typeof doc?.id, '夹具里至少要有一套已上架租赁房源').toBe('number')
  return { id: doc.id as number, version: doc.version as number }
}

async function publicationStatusOf(request: APIRequestContext, id: number): Promise<string> {
  const res = await request.get(`/api/listings/${id}?depth=0`)
  expect(res.status()).toBe(200)
  return (await res.json()).publicationStatus as string
}

async function countAudit(request: APIRequestContext, action: string): Promise<number> {
  const res = await request.get(`/api/audit-logs?limit=1&where[action][equals]=${action}`)
  expect(res.status()).toBe(200)
  return (await res.json()).totalDocs as number
}

test.describe('OPT-086 PR1 房源发布轴动作', () => {
  test('编辑页下架（原因必填）→ 状态与审计变化 → 重新上架恢复夹具', async ({ page }) => {
    const request = await login(page)
    const { id } = await pickPublishedListing(request)
    const auditBefore = await countAudit(request, 'listing.unpublish')

    await page.goto(`/admin/collections/listings/${id}`)
    const bar = page.locator('.listing-publication-actions')
    await expect(bar).toBeVisible()
    await expect(bar.getByText('已发布', { exact: true })).toBeVisible()

    try {
      await bar.getByRole('button', { name: '下架', exact: true }).click()
      const ok = page.getByRole('button', { name: '确认下架', exact: true })
      await expect(ok, '原因为空时确认按钮禁用').toBeDisabled()
      await page.getByPlaceholder('下架原因（必填，记入审计）').fill('e2e：验证下架动作')
      await expect(ok).toBeEnabled()
      await ok.click()

      await expect(bar.getByText('已下架', { exact: true })).toBeVisible()
      expect(await publicationStatusOf(request, id)).toBe('unpublished')
      expect(await countAudit(request, 'listing.unpublish')).toBe(auditBefore + 1)

      // 下架后出现「重新上架」
      await expect(bar.getByRole('button', { name: '重新上架', exact: true })).toBeVisible()
    } finally {
      // 恢复夹具：其它 spec 依赖已上架房源数量。走 API 而不是 UI，失败时也能恢复。
      const restore = await request.post(`/api/listings/${id}/publish`, { data: { action: 'publish' } })
      expect(restore.status(), '恢复上架应成功（夹具房源满足有效供给）').toBe(200)
    }
  })

  test('无 listing:unpublish 的角色（CSR）看不到动作按钮', async ({ page }) => {
    const response = await page.request.post('/api/users/login', {
      data: { email: 'e2e-csr@example.com', password: 'Test1234!' }, failOnStatusCode: false,
    })
    expect(response.status()).toBe(200)
    const adm = await page.context().newPage()
    // CSR 没有 listings 菜单，直接访问编辑页会 404 或被拒；这里只断言 API 层 403。
    const res = await page.request.post('/api/listings/1/publish', { data: { action: 'unpublish', reason: 'x' } })
    expect([401, 403]).toContain(res.status())
    await adm.close()
  })
})
```

> 第二个用例若 `adm` 页面多余，删掉 `newPage()` 两行；核心断言是 API 403。

- [ ] **Step 2: typecheck 覆盖 e2e**

Run: `pnpm typecheck`
Expected: 无错。

- [ ] **Step 3: 单 spec 试跑（可选）**

若控制者已起 dev server（3721）：`PLAYWRIGHT_BASE_URL=http://localhost:3721 pnpm exec playwright test tests/e2e/listing-publication-actions.spec.ts`。跑不了就在报告里说明，由 CI 验证。**不要跑全量 e2e。**

- [ ] **Step 4: 提交**

```bash
git add tests/e2e/listing-publication-actions.spec.ts
git commit -m "test(e2e): 房源编辑页下架与恢复，无权限角色 API 403（OPT-086 PR1）"
```

---

## 控制者在四任务之后负责的事

- 起 `E:\wt-086` 的 dev server（`launch.json` `opt086-dev`，3721），五个动作走一遍：下架（原因为空禁用、填后可提交、状态与可见性卡同步变）、标记已租（提示撤销推荐；核对 `isFeatured=false`）、重新上架、出售房源看到「标记已售」而非「标记已租」、无权限账号不见按钮；列表行「下架」与编辑页同弹层；深色模式；证据写 `artifacts/verification/OPT-086/`。
- 全分支终审（最强模型）→ 一轮修复 → rebase 到最新 master → 交用户决定 push / PR。
- 回写 `OPT-086-listing-domain-workstation.md` PR 1 状态。

---

### Task 5：两处收口——端点租售守卫 + 未保存改动时禁用动作

> 来源：Task 2 再审的场外观察（2026-09-10）。两条都是「动作条让运营更容易踩到的既有坑」，在同一 PR 内堵上。

**Files:**
- Modify: `src/endpoints/listing-publish-endpoint.ts`（在状态转移校验之后、写入之前加一段）
- Modify: `tests/listing-publish-endpoint.test.ts`（两个用例）
- Modify: `src/components/admin/ListingPublicationActionsClient.tsx`（读 `useFormModified`）
- Modify: `tests/listing-publication-actions.test.ts` 或新建一个小测试（纯函数 `actionsBlockedByUnsavedEdits` 若抽出）

**Interfaces:**
- Consumes：`useFormModified` from `@payloadcms/ui`（`FormModifiedBridge` 已在同一槽用它，`rg useFormModified src/components/admin/unsaved-changes`）。
- 端点新增的拒绝：`mark_leased` 且 `listing.businessType === 'sale'` → 422 `{ ok:false, error:'出售房源不能标记为已租，请使用「标记已售」', code:'BUSINESS_TYPE_MISMATCH' }`；`mark_sold` 且 `listing.businessType !== 'sale'` → 422 `{ ok:false, error:'租赁房源不能标记为已售，请使用「标记已租」', code:'BUSINESS_TYPE_MISMATCH' }`。放在 `canTransitionPublication` 校验之后、权限校验之后、写入之前。**这是新增拒绝，不改既有成功路径**（G1 的例外由控制者批准：它只让本来会写脏数据的请求失败）。

- [ ] **Step 1: 端点用例（先红）**

```ts
it('mark_leased 拒绝出售房源：422 BUSINESS_TYPE_MISMATCH，不 update', async () => {
  const { req, update } = makeReq({
    listing: makeEffectiveListing({ publicationStatus: 'published', businessType: 'sale' }),
    body: { action: 'mark_leased' },
  })
  const res = await run(req)
  expect(res.status).toBe(422)
  expect(res.body.code).toBe('BUSINESS_TYPE_MISMATCH')
  expect(update).not.toHaveBeenCalled()
})
it('mark_sold 拒绝租赁房源：422 BUSINESS_TYPE_MISMATCH，不 update', async () => {
  const { req, update } = makeReq({
    listing: makeEffectiveListing({ publicationStatus: 'published', businessType: 'lease' }),
    body: { action: 'mark_sold' },
  })
  const res = await run(req)
  expect(res.status).toBe(422)
  expect(res.body.code).toBe('BUSINESS_TYPE_MISMATCH')
  expect(update).not.toHaveBeenCalled()
})
```

Run: `pnpm exec vitest run tests/listing-publish-endpoint.test.ts -t BUSINESS_TYPE_MISMATCH` → Expected: FAIL（现在返回 200）。

- [ ] **Step 2: 端点实现**（在非法转移 409 之后插入）

```ts
      // 租售分开是不可逆口径（leased/sold 一旦写错无从分辨）；UI 只按已保存的租售显隐按钮，
      // 但直调 API 绕得过 UI，所以端点也要挡一次。缺省（无 businessType）按租赁处理，与 UI 一致。
      const isSale = listing.businessType === 'sale'
      if ((action === 'mark_leased' && isSale) || (action === 'mark_sold' && !isSale)) {
        return Response.json(
          {
            ok: false,
            code: 'BUSINESS_TYPE_MISMATCH',
            error: isSale ? '出售房源不能标记为已租，请使用「标记已售」' : '租赁房源不能标记为已售，请使用「标记已租」',
          },
          { status: 422 },
        )
      }
```

同时把头注释的响应清单补上这条 422。Run 同上 → PASS；整文件 → PASS。

- [ ] **Step 3: 未保存改动时禁用动作（先红）**

抽纯函数到 `src/domain/listing/publication-actions.ts`：

```ts
/** 有未保存改动时动作一律不可用：动作成功后的 router.refresh() 会用服务端状态整体替换表单，未保存的编辑会被静默丢掉。 */
export function publicationActionsDisabledReason(formModified: boolean): string | null {
  return formModified ? '有未保存的改动，请先保存再执行发布动作' : null
}
```

测试：`true` → 文案；`false` → `null`。

- [ ] **Step 4: 客户端接线**

`ListingPublicationActionsClient.tsx`：`const modified = useFormModified()`；`const disabledReason = publicationActionsDisabledReason(modified)`；每个按钮 `disabled={disabledReason !== null}`，外面包 Arco `Tooltip`（`content={disabledReason}`，仅 disabled 时渲染 Tooltip）；`aria-disabled` 与 `title` 同步。注释写明理由。

- [ ] **Step 5: 验证与提交**

`pnpm exec vitest run tests/listing-publish-endpoint.test.ts tests/listing-publication-actions.test.ts && pnpm typecheck && pnpm lint`；本地 3721 上：改一个字段不保存 → 动作按钮禁用且 hover 显示提示；保存后恢复可用。

```bash
git add src/endpoints/listing-publish-endpoint.ts tests/listing-publish-endpoint.test.ts src/components/admin/ListingPublicationActionsClient.tsx src/domain/listing/publication-actions.ts tests/listing-publication-actions.test.ts
git commit -m "fix(listing): 端点拒绝租售错标；有未保存改动时禁用发布动作（OPT-086 PR1）"
```
