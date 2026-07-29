# Admin Navigation Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Payload 后台导航重构为已确认的九个中文业务分组，按角色与服务端读取权限过滤入口，提供待办/通知/审核/举报/线索/表单提交数量提醒，并把历史与技术入口降级到业务详情或“高级工具”。

**Architecture:** 使用纯配置模块维护稳定 slug 到目标信息架构的映射；Payload `beforeNavLinks` 服务端组件根据当前用户、角色菜单权限和 Payload Collection 读取权限生成可见树，客户端组件只负责路由高亮、单组手风琴和移动抽屉交互。所有默认 Collection 使用 `admin.group: false` 退出 Payload 自动导航但保留后台路由；数量提醒由单个受保护 endpoint 聚合，统计查询复用服务端权限上下文和数据范围。表单提交增加显式处理状态，线索归属历史和表单提交通过详情页上下文入口访问。

**Tech Stack:** Next.js 16.2、React 19.2、Payload CMS 3.86、TypeScript 5.9、Vitest 4、Playwright 1.61、SCSS、pnpm 8.6.1、PostgreSQL/SQLite Payload adapters。

## Global Constraints

- 权威设计：`docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md`。
- 遵守 `payload-office-platform/AGENTS.md`、`.agent/core.md`、`.agent/backend.md`、`.agent/permissions.md`、`.agent/testing.md`。
- 不修改任何 Collection slug、REST API 路径或既有数据关系。
- 菜单隐藏只降低认知负担；直接 URL 和数据读取仍由现有 Collection access / endpoint 权限拦截。
- 菜单可见性必须同时满足：菜单编码授权、Payload 当前用户对目标 Collection 的 `read` 权限。
- 数量统计必须使用和目标列表一致的权限、用户及城市/团队/本人范围，不得 `overrideAccess: true` 绕过边界。
- 自定义导航失败时不得阻塞当前页面；数量失败只隐藏数量并显示非阻断反馈。
- 保留工作区中与本任务无关的现有改动，不覆盖 `next-env.d.ts` 或三个现有 Admin Client 组件的用户改动。
- 所有依赖命令使用 `pnpm`；禁止 `any`、`@ts-ignore`、`@ts-expect-error`。
- 每个实现任务先写失败测试，再做最小实现，再运行聚焦测试。
- 浏览器验收覆盖 ADM、OPS、MGR、BRK、CSR，桌面与移动视口，以及亮色/暗色、0/1/99/100 数量、失败和无权限状态。
- 详细证据写入 `artifacts/verification/OPT-021-admin-navigation-ia/README.md`。

---

## Task 1: 建立任务包与可追踪验收基线

**Files:**

- Create: `specs/work-items/OPT-021-admin-navigation-ia.md`
- Reference: `docs/superpowers/specs/2026-07-28-admin-navigation-information-architecture-design.md`

- [ ] 从 `specs/work-items/TEMPLATE.md` 创建 Task Packet，状态设为“进行中”，并填写以下固定边界：

```md
# Task Packet：OPT-021 后台导航信息架构优化

> 状态：进行中
> 创建日期：2026-07-28
> 最后更新：2026-07-28

## 1. 目标

把后台导航重组为九个中文业务分组，按角色和服务端权限过滤，并提供安全的行动数量提醒与详情上下文入口。

## 2. 非目标

- 不改变 Collection slug、REST API 和数据关系。
- 不重构业务详情表单和业务状态机。
- 不用菜单隐藏替代服务端权限。
```

- [ ] 在“验收”中逐条链接设计稿第 12 节，并明确五类角色、桌面/移动、直接 URL、数量边界四类验收。
- [ ] 在“当前行为与证据”中记录现状：默认导航出现“集合 / workflow / system”，`lead-ownership-history`、`search`、`domain-events`、`audit-logs` 为平级入口。
- [ ] 确认 Task Packet 没有未替换的 `<任务编号>`、`<标题>`、`YYYY-MM-DD`。
- [ ] 提交：

```bash
git add specs/work-items/OPT-021-admin-navigation-ia.md
git commit -m "docs: add OPT-021 navigation task packet"
```

---

## Task 2: 建立导航配置单一真源

**Files:**

- Create: `payload-office-platform/src/domain/admin-navigation/navigation-config.ts`
- Create: `payload-office-platform/src/domain/admin-navigation/navigation-types.ts`
- Create: `payload-office-platform/tests/admin-navigation-config.test.ts`

- [ ] 先写失败测试，锁定九个一级分组的顺序、中文名称、目标入口和稳定路径：

```ts
import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'

describe('admin navigation config', () => {
  it('按已确认顺序提供九个一级分组', () => {
    expect(ADMIN_NAV_GROUPS.map((group) => group.label)).toEqual([
      '工作台',
      '房源运营',
      '审核与风控',
      '客户运营',
      '商户合作',
      '团队管理',
      '内容管理',
      '表单中心',
      '系统管理',
    ])
  })

  it('不在主导航暴露归属历史或技术分组名', () => {
    const serialized = JSON.stringify(ADMIN_NAV_GROUPS)
    expect(serialized).not.toContain('lead-ownership-history')
    expect(serialized).not.toContain('workflow')
    expect(serialized).not.toContain('"集合"')
  })

  it('把技术入口收进系统管理的高级工具', () => {
    const system = ADMIN_NAV_GROUPS.find((group) => group.id === 'system')
    const advanced = system?.children.find((item) => item.id === 'advanced-tools')
    expect(advanced?.children?.map((item) => item.collectionSlug)).toEqual([
      'search',
      'domain-events',
      'audit-logs',
    ])
  })
})
```

- [ ] 运行并确认失败：

```bash
cd payload-office-platform
pnpm exec vitest run tests/admin-navigation-config.test.ts
```

Expected: FAIL，模块尚不存在。

- [ ] 定义无 `any` 的配置类型。叶子项至少包含：

```ts
export type AdminNavLeaf = {
  id: string
  label: string
  href: string
  menuCodes: readonly string[]
  collectionSlug?: string
  requiredOperationCode?: string
  badgeKey?: AdminNavigationBadgeKey
}
```

- [ ] 写入完整配置，稳定映射如下：

```ts
export const ADMIN_NAV_GROUPS = [
  group('workspace', '工作台', [
    leaf('overview', '运营概览', '/admin', ['dashboard']),
    leaf('my-tasks', '我的待办', '/admin/collections/tasks', ['todos'], {
      collectionSlug: 'tasks',
      requiredOperationCode: 'task:read',
      badgeKey: 'tasks',
    }),
    leaf('notifications', '消息通知', '/admin/collections/notifications', ['notifications'], {
      collectionSlug: 'notifications',
      requiredOperationCode: 'notification:read',
      badgeKey: 'notifications',
    }),
  ]),
  group('supply', '房源运营', [
    leaf('listings', '房源列表', '/admin/collections/listings', ['listings']),
    leaf('buildings', '楼盘库', '/admin/collections/buildings', ['buildings']),
    subgroup('supply-settings', '基础配置', [
      leaf('locations', '行政区域', '/admin/collections/locations', ['locations']),
      leaf('business-areas', '商圈管理', '/admin/collections/business-area-extensions', ['business-areas']),
      leaf('amenities', '配套字典', '/admin/collections/amenities', ['dictionaries']),
    ]),
  ]),
  group('risk', '审核与风控', [
    leaf('listing-reviews', '审核队列', '/admin/collections/listing-reviews', ['listing-reviews'], {
      badgeKey: 'listingReviews',
    }),
    leaf('listing-reports', '举报处理', '/admin/collections/listing-reports', ['reports'], {
      badgeKey: 'listingReports',
    }),
  ]),
  group('crm', '客户运营', [
    leaf('leads', '咨询线索', '/admin/collections/leads', ['leads', 'my-leads'], {
      badgeKey: 'leads',
    }),
    leaf('customers', '客户档案', '/admin/collections/customers', ['customers', 'my-customers']),
    leaf('follow-ups', '跟进记录', '/admin/collections/follow-ups', ['follow-ups']),
  ]),
  group('partners', '商户合作', [
    leaf('merchants', '商户管理', '/admin/collections/merchants', ['merchants']),
  ]),
  group('teams', '团队管理', [
    leaf('teams', '团队管理', '/admin/collections/teams', ['teams']),
    leaf('brokers', '经纪人管理', '/admin/collections/brokers', ['brokers']),
  ]),
  group('content', '内容管理', [
    leaf('pages', '页面内容', '/admin/collections/pages', ['pages']),
    leaf('media', '素材库', '/admin/collections/media', ['media']),
  ]),
  group('forms', '表单中心', [
    leaf('forms', '表单管理', '/admin/collections/forms', ['forms']),
    leaf('form-submissions', '提交数据', '/admin/collections/form-submissions', ['form-submissions'], {
      badgeKey: 'formSubmissions',
    }),
  ]),
  group('system', '系统管理', [
    leaf('users', '用户管理', '/admin/collections/users', ['users']),
    leaf('roles', '角色管理', '/admin/collections/roles', ['roles']),
    subgroup('advanced-tools', '高级工具', [
      leaf('search', '搜索索引', '/admin/collections/search', ['search']),
      leaf('domain-events', '领域事件', '/admin/collections/domain-events', ['domain-events'], {
        requiredOperationCode: 'events:read',
      }),
      leaf('audit-logs', '审计日志', '/admin/collections/audit-logs', ['audit-logs'], {
        requiredOperationCode: 'audit:view',
      }),
    ]),
  ]),
] as const satisfies readonly AdminNavGroup[]
```

- [ ] 增加配置完整性测试：ID 唯一、href 唯一、叶子均有 `menuCodes`、所有 `collectionSlug` 均出现在 Payload Config 或插件集合清单中。
- [ ] 运行测试并确认通过。
- [ ] 提交：

```bash
git add src/domain/admin-navigation/navigation-config.ts src/domain/admin-navigation/navigation-types.ts tests/admin-navigation-config.test.ts
git commit -m "feat: define admin navigation structure"
```

---

## Task 3: 对齐菜单权限编码、内置角色和生产角色数据

**Files:**

- Modify: `payload-office-platform/src/domain/auth/permission-codes.ts`
- Modify: `payload-office-platform/src/test/factory/roles.ts`
- Modify: `payload-office-platform/scripts/seed.ts`
- Create: `payload-office-platform/src/migrations/20260728_180000_opt_021_admin_navigation_roles.ts`
- Modify: `payload-office-platform/src/migrations/index.ts`
- Modify: `payload-office-platform/tests/permission-codes.test.ts`
- Create: `payload-office-platform/tests/admin-navigation-role-matrix.test.ts`

- [ ] 先扩展失败测试，要求 `pages`、`media`、`forms`、`form-submissions`、`search`、`domain-events` 均为已注册菜单编码。
- [ ] 写角色矩阵测试，至少锁定：

```ts
expect(visibleTopGroups('ADM')).toEqual([
  '工作台', '房源运营', '审核与风控', '客户运营', '商户合作',
  '团队管理', '内容管理', '表单中心', '系统管理',
])
expect(visibleTopGroups('OPS')).toEqual([
  '工作台', '房源运营', '审核与风控', '商户合作', '内容管理', '表单中心',
])
expect(visibleTopGroups('MGR')).toEqual([
  '工作台', '房源运营', '客户运营', '团队管理',
])
expect(visibleTopGroups('BRK')).toEqual([
  '工作台', '房源运营', '客户运营',
])
expect(visibleTopGroups('CSR')).toEqual([
  '工作台', '客户运营', '表单中心',
])
```

- [ ] 运行聚焦测试并确认失败。
- [ ] 扩展 `MENU_CODES`，不删除旧编码，避免自定义角色现有 JSON 失效。
- [ ] 更新五类内置角色 fixture：
  - ADM 保持 `*`；
  - OPS 增加 `todos`、`notifications`、`locations`、`business-areas`、`dictionaries`、`pages`、`media`、`forms`、`form-submissions`；
  - MGR 增加 `todos`、`notifications`、`buildings`、`listings`；
  - BRK 增加 `dashboard`、`todos`、`notifications`；
  - CSR 增加 `dashboard`、`todos`、`notifications`、`forms`、`form-submissions`；
  - 对显示待办/通知的角色补充 `task:read`、`notification:read`，不授予 `task:manage` 或 `notification:manage`。
- [ ] 将 `scripts/seed.ts` 的“已存在则跳过”改成按 `code` 更新 fixture 权限、名称和描述，保证本地/E2E 重跑可收敛。
- [ ] 编写数据迁移：`up` 通过 Payload Local API 按 `code` 更新五个内置角色的菜单/操作/字段权限；`down` 恢复迁移前的角色基线数组。更新必须 `overrideAccess: true` 且只命中 `isBuiltin=true` 的 ADM/OPS/MGR/BRK/CSR。
- [ ] 运行：

```bash
pnpm exec vitest run tests/permission-codes.test.ts tests/admin-navigation-role-matrix.test.ts tests/test-factory.test.ts
pnpm exec payload migrate:status
```

Expected: 所有测试 PASS；新迁移列为 pending。

- [ ] 提交：

```bash
git add src/domain/auth/permission-codes.ts src/test/factory/roles.ts scripts/seed.ts src/migrations/20260728_180000_opt_021_admin_navigation_roles.ts src/migrations/index.ts tests/permission-codes.test.ts tests/admin-navigation-role-matrix.test.ts
git commit -m "feat: align role permissions with admin navigation"
```

---

## Task 4: 实现服务端导航可见性解析

**Files:**

- Create: `payload-office-platform/src/domain/admin-navigation/resolve-navigation.ts`
- Create: `payload-office-platform/tests/admin-navigation-visibility.test.ts`

- [ ] 先写失败测试，覆盖：
  - 菜单通配符；
  - `leads` 或 `my-leads` 任一授权即可显示咨询线索；
  - 缺少目标 Collection `read` 权限时叶子隐藏；
  - 缺少 `events:read` / `audit:view` 时高级工具叶子隐藏；
  - 子项全部隐藏时，子分组和一级分组不渲染；
  - 配置解析失败返回至少包含当前工作台入口的安全回退树。
- [ ] 实现纯函数，不在客户端重算权限：

```ts
export function resolveAdminNavigation(input: {
  groups: readonly AdminNavGroup[]
  permission: PermissionContext
  canReadCollection: (slug: string) => boolean
}): readonly ResolvedAdminNavGroup[]
```

- [ ] 过滤顺序固定为：
  1. 任一 `menuCodes` 通过 `hasMenuPermission`；
  2. `requiredOperationCode` 为空或通过 `hasOperationPermission`；
  3. `collectionSlug` 为空或 `canReadCollection(slug)`；
  4. 递归移除空子分组与空一级分组。
- [ ] 不将角色编码写死进 resolver；角色差异只来自 PermissionContext。
- [ ] 运行：

```bash
pnpm exec vitest run tests/admin-navigation-visibility.test.ts tests/admin-navigation-role-matrix.test.ts
```

Expected: PASS。

- [ ] 提交：

```bash
git add src/domain/admin-navigation/resolve-navigation.ts tests/admin-navigation-visibility.test.ts
git commit -m "feat: resolve server-side admin navigation visibility"
```

---

## Task 5: 增加表单提交处理状态

**Files:**

- Modify: `payload-office-platform/src/payload.config.ts`
- Create: `payload-office-platform/src/domain/forms/submission-status.ts`
- Create: `payload-office-platform/src/migrations/20260728_181000_opt_021_form_submission_status.ts`
- Modify: `payload-office-platform/src/migrations/index.ts`
- Create: `payload-office-platform/tests/form-submission-status.test.ts`
- Regenerate: `payload-office-platform/src/payload-types.ts`

- [ ] 先写纯函数失败测试，锁定 `new -> processing -> processed`，允许 `processing -> new` 回退领取，不允许 `processed -> new`。
- [ ] 定义枚举：

```ts
export const FORM_SUBMISSION_STATUSES = ['new', 'processing', 'processed'] as const
```

- [ ] 在 `formBuilderPlugin.formSubmissionOverrides.fields` 末尾追加 `processingStatus`、`processedAt`、`processedBy`；默认 `new`，列表默认列包含表单、处理状态、创建时间、处理人。
- [ ] 添加 `beforeChange` hook：状态变为 `processed` 时服务端写入 `processedAt` 和当前用户；离开 `processed` 时清空二者；拒绝非法转换。
- [ ] 迁移为 `form_submissions` 增加状态枚举/列/索引，并为历史记录回填 `new`；`down` 安全删除新增字段与枚举。
- [ ] 生成类型并运行聚焦测试：

```bash
pnpm exec payload generate:types
pnpm exec vitest run tests/form-submission-status.test.ts
```

Expected: PASS；`FormSubmission` 包含三个新增字段。

- [ ] 提交：

```bash
git add src/payload.config.ts src/domain/forms/submission-status.ts src/migrations/20260728_181000_opt_021_form_submission_status.ts src/migrations/index.ts tests/form-submission-status.test.ts src/payload-types.ts
git commit -m "feat: track form submission processing status"
```

---

## Task 6: 实现安全的导航数量聚合 endpoint

**Files:**

- Create: `payload-office-platform/src/domain/admin-navigation/navigation-badges.ts`
- Create: `payload-office-platform/src/endpoints/admin-navigation-endpoint.ts`
- Modify: `payload-office-platform/src/payload.config.ts`
- Create: `payload-office-platform/tests/admin-navigation-badges.test.ts`
- Create: `payload-office-platform/tests/admin-navigation-endpoint.test.ts`

- [ ] 先写失败测试，覆盖六个统计口径：
  - `tasks`：`status in [pending, in_progress]` 且分配给当前用户；
  - `notifications`：当前用户且 `read=false`；
  - `listingReviews`：`taskStatus in [pending, processing]`；
  - `listingReports`：`status != closed`；
  - `leads`：`stage=new` 或超过现有 SLA 截止时间，复用 CRM SLA 领域规则；
  - `formSubmissions`：`processingStatus=new`。
- [ ] 统计测试必须证明城市/团队/本人范围进入 `where`，未授权 badge key 不发起查询。
- [ ] 实现 badge 值格式化：

```ts
export function formatBadgeCount(count: number): string | null {
  if (count <= 0) return null
  if (count > 99) return '99+'
  return String(count)
}
```

- [ ] 使用 `requireAdminContext` 获取当前 PermissionContext；使用 `req.payload.count({ req, overrideAccess: false })` 保留 Collection access；业务范围额外通过既有 scope builder 合并，不把客户端输入作为范围来源。
- [ ] endpoint 合同固定为：

```ts
type AdminNavigationResponse =
  | { ok: true; badges: Partial<Record<AdminNavigationBadgeKey, number>>; asOf: string }
  | { ok: false; error: string }
```

- [ ] 未登录返回 401；没有某入口权限时响应中省略对应 key；单项统计失败时省略该 key、记录服务端日志，其他 key 仍返回。
- [ ] 在 `payload.config.ts` 顶层 endpoints 注册 `GET /admin-navigation`。
- [ ] 如加入短缓存，仅允许按 `userId + sessionVersion` 隔离、TTL 不超过 30 秒；不得跨用户共享。
- [ ] 运行：

```bash
pnpm exec vitest run tests/admin-navigation-badges.test.ts tests/admin-navigation-endpoint.test.ts
```

Expected: PASS。

- [ ] 提交：

```bash
git add src/domain/admin-navigation/navigation-badges.ts src/endpoints/admin-navigation-endpoint.ts src/payload.config.ts tests/admin-navigation-badges.test.ts tests/admin-navigation-endpoint.test.ts
git commit -m "feat: add scoped admin navigation badges"
```

---

## Task 7: 让 Payload 默认导航退出但保留全部后台路由

**Files:**

- Modify: `payload-office-platform/src/collections/Amenities.ts`
- Modify: `payload-office-platform/src/collections/AuditLogs.ts`
- Modify: `payload-office-platform/src/collections/Brokers.ts`
- Modify: `payload-office-platform/src/collections/BuildingMerchantRelations.ts`
- Modify: `payload-office-platform/src/collections/Buildings.ts`
- Modify: `payload-office-platform/src/collections/BusinessAreaExtensions.ts`
- Modify: `payload-office-platform/src/collections/Customers.ts`
- Modify: `payload-office-platform/src/collections/DisplayTags.ts`
- Modify: `payload-office-platform/src/collections/DomainEvents.ts`
- Modify: `payload-office-platform/src/collections/FollowUps.ts`
- Modify: `payload-office-platform/src/collections/LeadOwnershipHistory.ts`
- Modify: `payload-office-platform/src/collections/Leads.ts`
- Modify: `payload-office-platform/src/collections/ListingMerchantRelations.ts`
- Modify: `payload-office-platform/src/collections/ListingReports.ts`
- Modify: `payload-office-platform/src/collections/ListingReviews.ts`
- Modify: `payload-office-platform/src/collections/Listings.ts`
- Modify: `payload-office-platform/src/collections/Locations.ts`
- Modify: `payload-office-platform/src/collections/Media.ts`
- Modify: `payload-office-platform/src/collections/Merchants.ts`
- Modify: `payload-office-platform/src/collections/Notifications.ts`
- Modify: `payload-office-platform/src/collections/Pages.ts`
- Modify: `payload-office-platform/src/collections/Roles.ts`
- Modify: `payload-office-platform/src/collections/Tasks.ts`
- Modify: `payload-office-platform/src/collections/Teams.ts`
- Modify: `payload-office-platform/src/collections/Users.ts`
- Modify: `payload-office-platform/src/domain/audit/export-controls.ts`
- Modify: `payload-office-platform/src/payload.config.ts`
- Create: `payload-office-platform/tests/admin-navigation-payload-config.test.ts`

- [ ] 先写配置测试，加载 Payload config 后断言所有需要自定义导航承载的 Collection 都满足 `admin.group === false`，同时 `admin.hidden !== true`。
- [ ] 运行并确认现有 `集合 / workflow / system / 账号与权限` 分组导致测试失败。
- [ ] 将每个手写 Collection 的 `admin.group` 统一设为 `false`；关系中间表、展示标签等非主入口同样退出默认导航，但保留直接路由。
- [ ] 在插件 override 中设置：

```ts
searchOverrides: { admin: { group: false }, ... }
formOverrides: { admin: { group: false }, ... }
formSubmissionOverrides: { admin: { group: false }, ... }
```

- [ ] 让 `overrideExportsCollection` 合并 `admin.group: false`，并新增同样处理 `imports` 的 `overrideImportsCollection` 后传给 `importExportPlugin.overrideImportCollection`，避免插件生成的导入/导出任务重新形成默认导航分组。
- [ ] 将展示名称对齐目标文案：
  - Tasks plural → `我的待办`
  - Notifications plural → `消息通知`
  - ListingReviews plural → `审核队列`
  - Media plural → `素材库`
  - Form submissions plural → `提交数据`
  - Locations plural → `行政区域`
  - BusinessAreaExtensions plural → `商圈管理`
  - Amenities plural → `配套字典`
- [ ] 从 `admin.dashboard.defaultLayout` 移除空的 Payload `collections` widget，只保留 `core-stats`，避免默认集合全部退出导航后工作台出现空卡片。
- [ ] 运行：

```bash
pnpm exec vitest run tests/admin-navigation-payload-config.test.ts
pnpm exec payload generate:types
```

Expected: PASS；所有 Collection 路由仍存在于 sanitized config。

- [ ] 提交：

```bash
git add src/collections src/domain/audit/export-controls.ts src/payload.config.ts tests/admin-navigation-payload-config.test.ts src/payload-types.ts
git commit -m "refactor: move collections to custom admin navigation"
```

---

## Task 8: 实现服务端导航桥接与客户端手风琴

**Files:**

- Create: `payload-office-platform/src/components/admin/AdminNavigation.tsx`
- Create: `payload-office-platform/src/components/admin/AdminNavigationClient.tsx`
- Create: `payload-office-platform/src/components/admin/AdminNavigation.scss`
- Create: `payload-office-platform/src/domain/admin-navigation/navigation-state.ts`
- Modify: `payload-office-platform/src/payload.config.ts`
- Regenerate: `payload-office-platform/src/app/(payload)/admin/importMap.js`
- Create: `payload-office-platform/tests/admin-navigation-state.test.ts`

- [ ] 先为无 DOM 依赖的导航状态纯函数写测试，覆盖：
  - 当前 `/admin/collections/leads/123` 自动展开“客户运营”并高亮“咨询线索”；
  - 打开“房源运营”会关闭“客户运营”；
  - `基础配置` 和 `高级工具` 默认折叠。
- [ ] 在 `navigation-state.ts` 导出 `findActiveLeaf`、`deriveOpenGroupId` 和 `toggleOpenGroup`，客户端只组合这些已测试的纯函数；badge 格式化由 Task 6 测试，服务端空分组行为由 Task 4 的 resolver 测试，真实交互与失败提示由 Task 10 的 Playwright 覆盖。
- [ ] `AdminNavigation.tsx` 保持 Server Component：从 Payload `ServerProps` 的 `user`、`payload`、`permissions` 构造 PermissionContext，用 Payload sanitized permissions 建立 `canReadCollection`，调用 `resolveAdminNavigation` 后只把已过滤树传给 Client Component。
- [ ] `AdminNavigationClient.tsx` 使用 Payload 的 `Link`、`useNav` 和 Next pathname；点击叶子后调用 `setNavOpen(false)`，兼容移动抽屉关闭。
- [ ] 展开状态由当前 pathname 派生初值；仅保存一个 `openGroupId`，不得保存多组选中状态。
- [ ] 使用原生 button 实现分组开关，包含 `aria-expanded`、`aria-controls` 和键盘焦点样式；叶子链接包含 `aria-current="page"`。
- [ ] 注册：

```ts
admin: {
  components: {
    actions: ['/components/admin/EnvBadge', '/components/admin/ThemeToggle'],
    beforeNavLinks: ['/components/admin/AdminNavigation'],
  },
}
```

- [ ] 样式必须限定在 `.admin-navigation`，实现：
  - 桌面端导航主体独立滚动、当前项品牌色、单组展开；
  - 三级“基础配置/高级工具”缩进与弱化；
  - badge 0 隐藏、警示 badge 使用语义色；
  - 亮色/暗色变量；
  - 小屏全屏抽屉中链接至少 44px 点击高度；
  - 不用全局 CSS 隐藏 Payload 默认链接。
- [ ] 运行：

```bash
pnpm exec vitest run tests/admin-navigation-state.test.ts
pnpm exec payload generate:importmap
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS；import map 包含 `AdminNavigation`。

- [ ] 提交：

```bash
git add src/components/admin/AdminNavigation.tsx src/components/admin/AdminNavigationClient.tsx src/components/admin/AdminNavigation.scss src/domain/admin-navigation/navigation-state.ts src/payload.config.ts 'src/app/(payload)/admin/importMap.js' tests/admin-navigation-state.test.ts
git commit -m "feat: add responsive role-aware admin navigation"
```

---

## Task 9: 增加详情页上下文入口

**Files:**

- Create: `payload-office-platform/src/components/admin/LeadOwnershipHistoryLink.tsx`
- Create: `payload-office-platform/src/components/admin/FormSubmissionsLink.tsx`
- Create: `payload-office-platform/src/domain/admin-navigation/context-links.ts`
- Modify: `payload-office-platform/src/collections/Leads.ts`
- Modify: `payload-office-platform/src/payload.config.ts`
- Regenerate: `payload-office-platform/src/app/(payload)/admin/importMap.js`
- Create: `payload-office-platform/tests/admin-navigation-context-links.test.ts`

- [ ] 先为 `context-links.ts` 的 URL 构造纯函数写失败测试：
  - 线索编辑页有“归属记录”，链接为 `/admin/collections/lead-ownership-history?where[lead][equals]=<leadId>`；
  - 表单编辑页有“查看提交数据”，链接为 `/admin/collections/form-submissions?where[form][equals]=<formId>`；
  - 创建页没有对象 ID 时返回 `null`；
  - 特殊字符 ID 被 `URLSearchParams` 正确编码。
- [ ] 使用 Payload edit `beforeDocumentControls` 插槽，不新建独立页面，不改变现有 Collection 路由。
- [ ] 链接组件从 `useDocumentInfo` 读取当前文档 ID，只拼接受控数字/字符串 ID；使用 `URLSearchParams` 编码查询。
- [ ] Server wrapper 先依据 Payload permissions 判断目标 Collection `read`；无权限时不把 Client Link 渲染到页面。Playwright 再覆盖真实无权限状态。
- [ ] 在 `Leads.admin.components.edit.beforeDocumentControls` 注册归属记录入口。
- [ ] 在 `formBuilderPlugin.formOverrides.admin.components.edit.beforeDocumentControls` 注册提交数据入口，和既有 plugin admin 配置深度合并。
- [ ] 运行：

```bash
pnpm exec vitest run tests/admin-navigation-context-links.test.ts
pnpm exec payload generate:importmap
```

Expected: PASS。

- [ ] 提交：

```bash
git add src/components/admin/LeadOwnershipHistoryLink.tsx src/components/admin/FormSubmissionsLink.tsx src/domain/admin-navigation/context-links.ts src/collections/Leads.ts src/payload.config.ts 'src/app/(payload)/admin/importMap.js' tests/admin-navigation-context-links.test.ts
git commit -m "feat: add contextual history and submission links"
```

---

## Task 10: 增加五角色桌面/移动端 E2E 验收

**Files:**

- Create: `payload-office-platform/tests/e2e/admin-navigation.spec.ts`
- Modify: `payload-office-platform/tests/e2e/permission-matrix.spec.ts`

- [ ] 使用现有 `e2e-{role}@example.com` 账号编写导航矩阵，先让新测试因旧导航结构失败。
- [ ] ADM 测试断言九个一级分组均可见；OPS/MGR/BRK/CSR 使用 Task 3 的目标矩阵。
- [ ] 对每个角色至少点击一个允许入口并确认页面加载；直接访问一个不允许 Collection URL，确认 403、Not Found 或无数据，而不是仅检查菜单隐藏。
- [ ] 桌面 1440×900 验证：
  - 一次只展开一个一级分组；
  - 当前路由刷新后所属组展开且叶子高亮；
  - 导航可滚动，设置/退出控件未被遮挡。
- [ ] 移动 390×844 验证：
  - 菜单以全屏抽屉打开；
  - 点击叶子后抽屉自动关闭；
  - 系统管理置底；
  - 返回与关闭按钮具有不同 accessible name。
- [ ] 用 endpoint fixture 或测试数据验证数量边界 0、1、99、100；断言 0 不显示、100 为 `99+`。
- [ ] 分别在亮色和暗色执行关键截图与可读性断言。
- [ ] 运行：

```bash
pnpm seed
pnpm exec playwright test tests/e2e/admin-navigation.spec.ts tests/e2e/permission-matrix.spec.ts --project=chromium
```

Expected: PASS。

- [ ] 提交：

```bash
git add tests/e2e/admin-navigation.spec.ts tests/e2e/permission-matrix.spec.ts
git commit -m "test: cover admin navigation role and responsive behavior"
```

---

## Task 11: 完整验证、证据与任务收口

**Files:**

- Create: `artifacts/verification/OPT-021-admin-navigation-ia/README.md`
- Create: `artifacts/verification/OPT-021-admin-navigation-ia/adm-desktop.png`
- Create: `artifacts/verification/OPT-021-admin-navigation-ia/ops-desktop.png`
- Create: `artifacts/verification/OPT-021-admin-navigation-ia/brk-mobile.png`
- Create: `artifacts/verification/OPT-021-admin-navigation-ia/dark-mode.png`
- Modify: `specs/work-items/OPT-021-admin-navigation-ia.md`

- [ ] 运行生成与静态检查：

```bash
cd payload-office-platform
pnpm exec payload generate:types
pnpm exec payload generate:importmap
pnpm exec tsc --noEmit --pretty false
pnpm lint
```

Expected: 全部退出码 0。

- [ ] 运行自动化测试：

```bash
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/admin-navigation.spec.ts tests/e2e/permission-matrix.spec.ts --project=chromium
```

Expected: 全部 PASS；生产构建成功。

- [ ] 运行迁移检查：

```bash
pnpm migrate:dry-run
pnpm migrate:verify
```

Expected: 两个 OPT-021 迁移可执行；无意外 DROP；角色与表单历史数据可回滚。

- [ ] 手工浏览器复核：
  - ADM/OPS/MGR/BRK/CSR 五角色；
  - `/admin`、房源列表、审核队列、咨询线索、表单提交、用户管理；
  - 未授权直接 URL；
  - 亮色/暗色；
  - 桌面 1440×900、移动 390×844；
  - 数量加载失败时链接仍可用；
  - 空数据、正常数据和 99+。
- [ ] 在 verification README 记录每条命令、退出码、测试数量、截图路径、角色矩阵结果、失败重试和剩余风险。不要只写“已通过”。
- [ ] 将 Task Packet 状态改为“已完成”，填写实际修改文件、验证摘要、迁移结果和详细证据链接。
- [ ] 检查只暂存 OPT-021 文件，保留工作区其他改动：

```bash
git status --short
git diff --cached --stat
```

- [ ] 最终提交：

```bash
git add artifacts/verification/OPT-021-admin-navigation-ia specs/work-items/OPT-021-admin-navigation-ia.md
git commit -m "docs: record OPT-021 navigation verification"
```

## Final Acceptance Checklist

- [ ] 一级分组名称、顺序和子项与设计稿第 4 节完全一致。
- [ ] 页面上不再出现“集合”“workflow”“system”等技术分组。
- [ ] `lead-ownership-history` 仅从线索详情进入。
- [ ] `search`、`domain-events`、`audit-logs` 仅位于“系统管理 / 高级工具”。
- [ ] ADM 九组可见，OPS/MGR/BRK/CSR 与目标矩阵一致。
- [ ] 空分组不渲染；无权限直接 URL 仍被服务端拒绝。
- [ ] 所有 badge 统计按当前用户权限范围收窄，失败不阻塞导航。
- [ ] 桌面端单组展开，当前路由刷新后正确恢复。
- [ ] 移动端点击后关闭抽屉，导航可滚动且账号控件可达。
- [ ] Collection slug、API 路径和数据关系未改变。
- [ ] 全量类型、单测、构建、迁移检查和 E2E 均通过。
- [ ] `artifacts/verification/OPT-021-admin-navigation-ia/README.md` 包含可复核证据。
