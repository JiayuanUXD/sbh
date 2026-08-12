# 后台基础配置移入系统管理 Implementation Plan

> **已被取代：** 用户于 2026-08-12 调整方案为新增一级“区域管理”，请勿执行本计划；后续实施以 `2026-08-12-admin-region-management-navigation.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将后台“基础配置”二级分组从“房源运营”移动到“系统管理”，保持五个入口、路由和权限不变。

**Architecture:** 继续以 `ADMIN_NAV_GROUPS` 为唯一导航配置源，只移动既有 `supply-settings` 子树的位置。导航过滤、路由归属、展开状态和权限判断沿用现有领域函数，不新增组件或状态。

**Tech Stack:** TypeScript、Payload CMS 3.86、React 19、Vitest、Playwright、pnpm。

## Global Constraints

- “房源运营”只保留房源列表、楼盘库、房源投放申请。
- “系统管理”顺序为用户管理、角色管理、基础配置、高级工具。
- “基础配置”保留城市管理、行政区域、商圈管理、地铁管理、配套字典及原顺序。
- 不修改 URL、Collection、Custom View、数据结构、菜单码或权限。
- 保留工作树中 `.tmp/` 与 `docs/superpowers/plans/2026-08-10-public-page-performance.md` 等其他任务文件。

---

### Task 1: 移动导航子树

**Files:**
- Modify: `tests/admin-navigation-config.test.ts`
- Modify: `src/domain/admin-navigation/navigation-config.ts`

**Interfaces:**
- Consumes: `ADMIN_NAV_GROUPS: readonly AdminNavGroup[]`。
- Produces: `supply` 组不含 `supply-settings`；`system` 组在 `roles` 与 `advanced-tools` 之间包含原样的 `supply-settings`。

- [ ] **Step 1: 修改导航合同测试，表达目标树**

在 `tests/admin-navigation-config.test.ts` 中把 `supply-settings` 的期望子树从 `supply` 移到 `system`，放在 `roles` 后、`advanced-tools` 前；五个叶子节点内容保持原样。再增加两条聚焦断言：

```ts
it('房源运营不再承载基础配置', () => {
  const supply = ADMIN_NAV_GROUPS.find((group) => group.id === 'supply')
  expect(supply?.children.map((item) => item.id)).toEqual([
    'listings',
    'buildings',
    'supply-submissions',
  ])
})

it('系统管理在角色管理和高级工具之间承载基础配置', () => {
  const system = ADMIN_NAV_GROUPS.find((group) => group.id === 'system')
  expect(system?.children.map((item) => item.id)).toEqual([
    'users',
    'roles',
    'supply-settings',
    'advanced-tools',
  ])
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
pnpm vitest run tests/admin-navigation-config.test.ts
```

Expected: FAIL；实际树仍在 `supply` 下，且 `system` 缺少 `supply-settings`。

- [ ] **Step 3: 最小移动导航配置**

在 `src/domain/admin-navigation/navigation-config.ts` 中删除 `supply` 下的完整 `subgroup('supply-settings', ...)`，并将同一子树原样插入 `system`：

```ts
group('system', '系统管理', 'settings', [
  leaf('users', '用户管理', '/admin/collections/users', ['users']),
  leaf('roles', '角色管理', '/admin/collections/roles', ['roles']),
  subgroup('supply-settings', '基础配置', [
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
    leaf('amenities', '配套字典', '/admin/collections/amenities', ['dictionaries']),
  ]),
  subgroup('advanced-tools', '高级工具', [
    // 保持既有三个叶子节点不变
  ]),
])
```

- [ ] **Step 4: 运行导航领域测试并确认 GREEN**

Run:

```bash
pnpm vitest run tests/admin-navigation-config.test.ts tests/admin-navigation-state.test.ts tests/admin-navigation-role-matrix.test.ts
```

Expected: 3 files 全部 PASS。

- [ ] **Step 5: 提交导航移动**

```bash
git add payload-office-platform/src/domain/admin-navigation/navigation-config.ts payload-office-platform/tests/admin-navigation-config.test.ts
git commit -m "feat(admin): 基础配置移入系统管理"
```

---

### Task 2: 更新浏览器合同并完成验收

**Files:**
- Modify: `tests/e2e/geography-admin.spec.ts`
- Verify: `tests/e2e/admin-navigation.spec.ts`
- Verify: `src/components/admin/AdminNavigationClient.tsx`

**Interfaces:**
- Consumes: Task 1 输出的新 `ADMIN_NAV_GROUPS` 树。
- Produces: E2E 从“系统管理 → 基础配置”进入，并验证“房源运营”无该分组。

- [ ] **Step 1: 更新地理 E2E 导航入口**

将 `tests/e2e/geography-admin.spec.ts` 的 flow1 修改为：

```ts
test('flow1 系统管理下的基础配置含 5 项且房源运营不再承载该分组', async ({ page }) => {
  await loginAs(page)
  await page.goto('/admin')
  await ensureDesktopNavigationOpen(page)
  await openTopGroup(page, '系统管理')

  const systemConfig = page.locator('.admin-navigation__subgroup').filter({ hasText: '基础配置' })
  const subToggle = systemConfig.locator('.admin-navigation__subgroup-toggle')
  await expect(subToggle).toBeVisible()
  if ((await subToggle.getAttribute('aria-expanded')) !== 'true') {
    await subToggle.dispatchEvent('click')
  }
  await expect(systemConfig.locator('.admin-navigation__subgroup-item')).toHaveCount(5)

  await openTopGroup(page, '房源运营')
  await expect(
    page.locator('.admin-navigation__group--open .admin-navigation__subgroup').filter({
      hasText: '基础配置',
    }),
  ).toHaveCount(0)
})
```

- [ ] **Step 2: 运行聚焦静态与测试验证**

Run:

```bash
pnpm exec eslint src/domain/admin-navigation/navigation-config.ts tests/admin-navigation-config.test.ts tests/e2e/geography-admin.spec.ts
pnpm exec tsc --noEmit --pretty false
pnpm vitest run tests/admin-navigation-config.test.ts tests/admin-navigation-state.test.ts tests/admin-navigation-role-matrix.test.ts
```

Expected: eslint 退出 0；TypeScript 退出 0；3 个测试文件全部 PASS。

- [ ] **Step 3: 运行全量自动化和构建**

Run:

```bash
pnpm test
NEXT_PUBLIC_SITE_URL=http://localhost:3717 pnpm build
```

Expected: 所有 Vitest 测试 PASS；Next.js 生产构建退出 0。

- [ ] **Step 4: 真实浏览器验收**

在 `http://localhost:3717/admin` 验证：

1. “系统管理”展开后显示用户管理、角色管理、“基础配置”、“高级工具”。
2. “基础配置”展开后恰好显示五项，顺序为城市、行政区域、商圈、地铁、配套字典。
3. 点击城市管理进入 `/admin/geography/cities`，系统管理保持所属展开语义。
4. 返回仪表盘并展开“房源运营”，只显示三项且没有“基础配置”。
5. 浏览器控制台无新增 error。

- [ ] **Step 5: 提交 E2E 合同与验证结果**

```bash
git add payload-office-platform/tests/e2e/geography-admin.spec.ts
git commit -m "test(admin): 更新基础配置导航验收"
```

---

### Task 3: 最终审查与交付

**Files:**
- Review: `src/domain/admin-navigation/navigation-config.ts`
- Review: `tests/admin-navigation-config.test.ts`
- Review: `tests/e2e/geography-admin.spec.ts`

**Interfaces:**
- Consumes: Task 1–2 的提交和验证证据。
- Produces: 可供合并的独立分支。

- [ ] **Step 1: 检查范围与工作树**

Run:

```bash
git diff --check
git status --short
git log --oneline -3
```

Expected: 无空白错误；仅用户既有未跟踪文件保留；本任务文件均已提交。

- [ ] **Step 2: 独立代码审查**

审查要求：确认菜单只移动不复制、叶子权限/路由未变化、系统顺序正确、路由归属与角色过滤无回归。若有有效意见，按 TDD 修复并重新执行 Task 2 的验证。

- [ ] **Step 3: 交付分支**

报告分支名、提交、菜单结果、自动化/构建/浏览器证据；不推送、不创建 PR、不合并，除非用户另行授权。
