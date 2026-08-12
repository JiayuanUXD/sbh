# 后台区域管理导航与地理页面框架修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一级“区域管理”并承载四个地理入口，将配套字典保留在“系统管理 → 基础配置”，同时让六条地理自定义 Admin View 恢复 Payload 标准左侧导航和顶部栏。

**Architecture:** `ADMIN_NAV_GROUPS` 继续是导航树唯一事实源，只重组现有叶子节点。新增服务端 `GeographyAdminTemplate`，使用 `@payloadcms/next/templates` 的官方 `DefaultTemplate` 包裹地理列表、城市详情和行政区新建入口；业务数据、权限检查、URL 与客户端组件保持不变。

**Tech Stack:** TypeScript、Payload CMS 3.86、Next.js 16、React 19、Vitest、Playwright、pnpm。

## Global Constraints

- 一级“区域管理”位于“房源运营”之后、“审核与风控”之前。
- “区域管理”直接包含城市管理、行政区域、商圈管理、地铁管理，顺序不变。
- “房源运营”只保留房源列表、楼盘库、房源投放申请。
- “系统管理”顺序为用户管理、角色管理、基础配置、高级工具；基础配置仅含配套字典。
- 不修改 URL、Collection、Custom View 注册、数据结构、菜单码、操作权限或角色权限数据。
- 四个列表页、城市详情页、行政区新建页统一使用 Payload 官方 `DefaultTemplate`，不得复制侧栏或修改生成的 Payload 根页面。
- 所有禁止访问、未知模块、正常页面内容均位于共享模板内；现有服务端准入检查继续生效。
- 保留工作树中 `.tmp/` 与 `docs/superpowers/plans/2026-08-10-public-page-performance.md` 等其他任务文件。

---

### Task 1: 重组后台导航树

**Files:**
- Modify: `tests/admin-navigation-config.test.ts`
- Modify: `tests/admin-navigation-role-matrix.test.ts`
- Modify: `src/domain/admin-navigation/navigation-types.ts`
- Modify: `src/domain/admin-navigation/navigation-config.ts`
- Modify: `src/components/admin/AdminNavigationClient.tsx`

**Interfaces:**
- Consumes: `ADMIN_NAV_GROUPS: readonly AdminNavGroup[]`。
- Produces: `region-management` 一级组；`supply-settings` 在 `system` 下只含 `amenities`。

- [ ] **Step 1: 修改导航配置测试表达目标树**

把一级分组期望改为十组：

```ts
expect(ADMIN_NAV_GROUPS.map((group) => group.label)).toEqual([
  '工作台',
  '房源运营',
  '区域管理',
  '审核与风控',
  '客户运营',
  '商户合作',
  '团队管理',
  '内容管理',
  '表单中心',
  '系统管理',
])
```

在标准树断言中：

```ts
expectedGroup('supply', '房源运营', [
  expectedLeaf('listings', '房源列表', '/admin/collections/listings', ['listings']),
  expectedLeaf('buildings', '楼盘库', '/admin/collections/buildings', ['buildings']),
  expectedLeaf('supply-submissions', '房源投放申请', '/admin/collections/supply-submissions', [
    'supply-submissions',
  ]),
]),
expectedGroup('region-management', '区域管理', [
  expectedLeaf('cities', '城市管理', '/admin/geography/cities', ['locations']),
  expectedLeaf('districts', '行政区域', '/admin/geography/districts', ['locations']),
  expectedLeaf('business-areas', '商圈管理', '/admin/geography/business-areas', [
    'business-areas',
  ]),
  expectedLeaf('metro-lines', '地铁管理', '/admin/geography/metro-lines', ['locations']),
]),
```

系统组断言为：

```ts
expectedGroup('system', '系统管理', [
  expectedLeaf('users', '用户管理', '/admin/collections/users', ['users']),
  expectedLeaf('roles', '角色管理', '/admin/collections/roles', ['roles']),
  expectedGroup('supply-settings', '基础配置', [
    expectedLeaf('amenities', '配套字典', '/admin/collections/amenities', ['dictionaries']),
  ]),
  expectedGroup('advanced-tools', '高级工具', [
    // 保留三个既有技术入口断言
  ]),
])
```

同步更新角色矩阵测试中的管理员一级组顺序，其他角色仅按其已有菜单码自然出现/隐藏“区域管理”，不得修改迁移或角色权限数据。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm vitest run tests/admin-navigation-config.test.ts tests/admin-navigation-role-matrix.test.ts
```

Expected: FAIL；当前没有“区域管理”，地理入口仍在房源运营下。

- [ ] **Step 3: 最小重组 `ADMIN_NAV_GROUPS`**

在 `src/domain/admin-navigation/navigation-config.ts`：

1. 从 `supply` 删除完整 `supply-settings`。
2. 紧随 `supply` 新增：

```ts
group('region-management', '区域管理', 'location', [
  leaf('cities', '城市管理', '/admin/geography/cities', ['locations'], {
    collectionSlug: 'locations',
  }),
  leaf('districts', '行政区域', '/admin/geography/districts', ['locations'], {
    collectionSlug: 'locations',
  }),
  leaf('business-areas', '商圈管理', '/admin/geography/business-areas', ['business-areas'], {
    collectionSlug: 'locations',
  }),
  leaf('metro-lines', '地铁管理', '/admin/geography/metro-lines', ['locations'], {
    collectionSlug: 'locations',
  }),
]),
```

在 `AdminNavIconKey` 增加 `location`，并在 `AdminNavigationClient.tsx` 从现有
`@arco-design/web-react/icon` 包导入 `IconLocation`，补充
`location: <IconLocation />` 映射；不得引入自制 SVG。

3. 在 `system` 的 `roles` 与 `advanced-tools` 之间新增：

```ts
subgroup('supply-settings', '基础配置', [
  leaf('amenities', '配套字典', '/admin/collections/amenities', ['dictionaries']),
]),
```

- [ ] **Step 4: 运行导航领域测试并确认 GREEN**

Run:

```bash
pnpm vitest run tests/admin-navigation-config.test.ts tests/admin-navigation-state.test.ts tests/admin-navigation-role-matrix.test.ts tests/admin-navigation-visibility.test.ts
```

Expected: 4 files 全部 PASS。

- [ ] **Step 5: 提交导航树改动**

```bash
git add src/domain/admin-navigation/navigation-types.ts src/domain/admin-navigation/navigation-config.ts src/components/admin/AdminNavigationClient.tsx tests/admin-navigation-config.test.ts tests/admin-navigation-role-matrix.test.ts
git commit -m "feat(admin): 新增区域管理一级导航"
```

---

### Task 2: 为地理自定义视图补齐 Payload 标准框架

**Files:**
- Create: `src/components/admin/geography/GeographyAdminTemplate.tsx`
- Modify: `src/components/admin/geography/GeographyListView.tsx`
- Modify: `src/components/admin/geography/GeographyCityDetail.tsx`
- Modify: `src/components/admin/geography/GeographyCreateView.tsx`
- Create: `tests/geography-admin-template-contract.test.ts`

**Interfaces:**
- Consumes: `AdminViewServerProps`；`DefaultTemplateProps`。
- Produces: `GeographyAdminTemplate(props: AdminViewServerProps & { children: ReactNode }): ReactNode`。

- [ ] **Step 1: 写共享模板合同失败测试**

新增 `tests/geography-admin-template-contract.test.ts`，读取四个源文件并锁定架构：

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('地理自定义 Admin View 框架合同', () => {
  it('共享模板使用 Payload 官方 DefaultTemplate', () => {
    const template = source('src/components/admin/geography/GeographyAdminTemplate.tsx')
    expect(template).toContain("from '@payloadcms/next/templates'")
    expect(template).toContain('<DefaultTemplate')
  })

  it.each([
    'GeographyListView.tsx',
    'GeographyCityDetail.tsx',
    'GeographyCreateView.tsx',
  ])('%s 使用共享后台模板', (file) => {
    const view = source(`src/components/admin/geography/${file}`)
    expect(view).toContain('GeographyAdminTemplate')
  })
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm vitest run tests/geography-admin-template-contract.test.ts
```

Expected: FAIL；共享模板文件不存在。

- [ ] **Step 3: 实现共享服务端模板**

创建 `GeographyAdminTemplate.tsx`：

```tsx
import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps } from 'payload'
import type { ReactNode } from 'react'

type GeographyAdminTemplateProps = AdminViewServerProps & {
  children: ReactNode
}

export default function GeographyAdminTemplate({
  children,
  initPageResult,
  params,
  searchParams,
  viewActions,
  viewType,
}: GeographyAdminTemplateProps) {
  const { req, permissions, visibleEntities } = initPageResult

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={req.payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={req.user}
      viewActions={viewActions}
      viewType={viewType}
      visibleEntities={{
        collections: [...visibleEntities.collections],
        globals: [...visibleEntities.globals],
      }}
    >
      {children}
    </DefaultTemplate>
  )
}
```

若类型检查显示 `viewType` 在自定义视图中为 `undefined`，保留 `undefined`，不要伪造 `dashboard` 或 `list`。

- [ ] **Step 4: 包裹三个地理服务端入口的全部返回路径**

在三个入口中把现有函数体拆为“内容解析函数 + 模板外层”，确保正常、禁止访问、未知模块都在模板内：

```tsx
export default async function GeographyListView(props: AdminViewServerProps) {
  const content = await renderGeographyListContent(props)
  return <GeographyAdminTemplate {...props}>{content}</GeographyAdminTemplate>
}
```

城市详情和行政区新建采用相同模式。不要把权限判断移出原服务端入口，不要修改已有查询、写入或错误文案。

- [ ] **Step 5: 运行模板合同、领域测试和类型检查**

Run:

```bash
pnpm vitest run tests/geography-admin-template-contract.test.ts tests/geography-modules.test.ts tests/geography-access.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected: 3 files 全部 PASS；TypeScript 退出 0。

- [ ] **Step 6: 提交模板修复**

```bash
git add src/components/admin/geography/GeographyAdminTemplate.tsx src/components/admin/geography/GeographyListView.tsx src/components/admin/geography/GeographyCityDetail.tsx src/components/admin/geography/GeographyCreateView.tsx tests/geography-admin-template-contract.test.ts
git commit -m "fix(admin): 地理页面恢复后台导航框架"
```

---

### Task 3: 更新 E2E 合同并完成验收

**Files:**
- Modify: `tests/e2e/geography-admin.spec.ts`
- Modify: `tests/e2e/admin-navigation.spec.ts`

**Interfaces:**
- Consumes: Task 1 的导航树与 Task 2 的共享模板。
- Produces: 浏览器合同覆盖新菜单与六条地理路由框架。

- [ ] **Step 1: 更新导航 E2E 的一级组预期**

把管理员一级组列表在“房源运营”后加入“区域管理”。对按角色声明的列表，只在该角色已有 `locations` 或 `business-areas` 菜单权限时加入“区域管理”，不得修改登录固件权限。

- [ ] **Step 2: 更新地理 flow1**

将原“房源运营 → 基础配置含 5 项”改为：

```ts
test('flow1 区域管理含四个地理入口，系统基础配置只保留配套字典', async ({ page }) => {
  await loginAs(page)
  await page.goto('/admin')
  await ensureDesktopNavigationOpen(page)

  await openTopGroup(page, '区域管理')
  const regionGroup = topGroupButton(page, '区域管理').locator('..')
  await expect(regionGroup.locator('.admin-navigation__item')).toHaveCount(4)
  await expect(regionGroup).toContainText('城市管理')
  await expect(regionGroup).toContainText('行政区域')
  await expect(regionGroup).toContainText('商圈管理')
  await expect(regionGroup).toContainText('地铁管理')

  await openTopGroup(page, '系统管理')
  const systemConfig = page.locator('.admin-navigation__subgroup').filter({ hasText: '基础配置' })
  await expect(systemConfig.locator('.admin-navigation__subgroup-item')).toHaveCount(1)
  await expect(systemConfig).toContainText('配套字典')
})
```

按现有 helper 的实际作用域调整 locator，保持语义断言不变。

- [ ] **Step 3: 为六条地理路由增加框架断言**

对以下已在固件中可稳定访问的代表 URL 增加 `.admin-navigation`、`.app-header` 可见断言：

- `/admin/geography/cities`
- `/admin/geography/districts`
- `/admin/geography/business-areas`
- `/admin/geography/metro-lines`
- `/admin/geography/cities/${cityId}`
- `/admin/geography/districts/new`

在地理列表与详情路由上断言“区域管理”按钮为 active/open。保留既有未授权访问测试，确认仍是登录重定向或 403。

- [ ] **Step 4: 运行聚焦静态与自动化验证**

Run:

```bash
pnpm exec eslint src/domain/admin-navigation/navigation-types.ts src/domain/admin-navigation/navigation-config.ts src/components/admin/AdminNavigationClient.tsx src/components/admin/geography/GeographyAdminTemplate.tsx src/components/admin/geography/GeographyListView.tsx src/components/admin/geography/GeographyCityDetail.tsx src/components/admin/geography/GeographyCreateView.tsx tests/admin-navigation-config.test.ts tests/admin-navigation-role-matrix.test.ts tests/geography-admin-template-contract.test.ts tests/e2e/admin-navigation.spec.ts tests/e2e/geography-admin.spec.ts
pnpm exec tsc --noEmit --pretty false
pnpm vitest run tests/admin-navigation-config.test.ts tests/admin-navigation-state.test.ts tests/admin-navigation-role-matrix.test.ts tests/admin-navigation-visibility.test.ts tests/geography-admin-template-contract.test.ts tests/geography-modules.test.ts tests/geography-access.test.ts
pnpm exec playwright test tests/e2e/admin-navigation.spec.ts tests/e2e/geography-admin.spec.ts
```

Expected: eslint 与 TypeScript 退出 0；7 个 Vitest 文件与 2 个 Playwright spec 全部 PASS。

- [ ] **Step 5: 运行全量测试和生产构建**

Run:

```bash
pnpm test
NEXT_PUBLIC_SITE_URL=http://localhost:3717 pnpm build
```

Expected: 全部 Vitest 测试 PASS；Next.js 生产构建退出 0。

- [ ] **Step 6: 真实浏览器验收**

使用当前本地账号在 `http://localhost:3717/admin` 验证：

1. 一级组顺序中“区域管理”位于“房源运营”之后。
2. 区域管理四项顺序正确；房源运营没有基础配置。
3. 系统管理基础配置只显示配套字典。
4. 四个地理列表、城市详情和行政区新建都显示左侧导航与顶部栏。
5. 城市/行政区/商圈/地铁路由的“区域管理”所属状态正确。
6. 相邻 `/admin/collections/amenities` 仍由系统管理承载。
7. 浏览器控制台无本任务新增 error；既有 React 19/Arco warning 单独记录，不能误报为本次新增。

- [ ] **Step 7: 提交 E2E 合同**

```bash
git add tests/e2e/admin-navigation.spec.ts tests/e2e/geography-admin.spec.ts
git commit -m "test(admin): 覆盖区域导航与地理页面框架"
```

---

### Task 4: 最终审查与交付

**Files:**
- Review: 本计划 Task 1–3 的全部修改文件。

**Interfaces:**
- Consumes: Task 1–3 的提交与验证报告。
- Produces: 可合并的独立分支。

- [ ] **Step 1: 检查范围与工作树**

Run:

```bash
git diff --check
git status --short
git log --oneline -6
```

Expected: 无空白错误；仅用户既有未跟踪文件保留；任务文件均已提交。

- [ ] **Step 2: 整分支独立代码审查**

审查重点：导航没有重复叶子；角色权限数据未变；`DefaultTemplate` 参数完整；权限拒绝状态在模板内；没有嵌套两层后台模板；六条路由均覆盖；测试未依赖脆弱源代码细节以外的行为合同。

- [ ] **Step 3: 修复有效审查意见并重新验证**

若有 Critical/Important 意见，由一个修复代理集中处理，运行覆盖改动的聚焦测试；随后由主代理重新执行 TypeScript、全量测试、构建和目标浏览器验证。

- [ ] **Step 4: 交付分支**

报告分支、提交、根因、菜单结果、自动化/构建/浏览器证据及剩余风险；不推送、不创建 PR、不合并，除非用户另行授权。
