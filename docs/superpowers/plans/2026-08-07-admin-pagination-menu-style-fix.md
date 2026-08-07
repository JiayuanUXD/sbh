# Admin Pagination Menu Style Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复 Payload 后台分页下拉选项被 reset 清除的 padding 与行高。

**Architecture:** 保留 Payload 原生 `PerPage` 和 `PopupButtonList`，在后台自定义样式中增加一个只命中两者组合 class 的覆盖规则。使用源文件合同测试锁定选择器与变量，并以真实浏览器计算样式验证最终 cascade。

**Tech Stack:** SCSS、Payload CMS 3.86、Vitest、TypeScript、pnpm

## Global Constraints

- Payload 原生表单、主题和交互语义为主。
- Arco 样式限制在明确命名容器内，不覆盖 Payload 全局 token。
- 禁止修改 `node_modules`、替换分页组件或引入全局 reset。
- 未经用户确认不得提交、推送或创建 PR。

---

### Task 1: 恢复分页菜单选项间距

**Files:**
- Create: `payload-office-platform/tests/admin-pagination-style-contract.test.ts`
- Modify: `payload-office-platform/src/app/(payload)/custom.scss`
- Create: `specs/work-items/OPT-024-admin-pagination-menu-style.md`
- Create: `artifacts/verification/OPT-024/README.md`

**Interfaces:**
- Consumes: Payload DOM classes `.popup__content`, `.popup-button-list__button`, `.per-page__button` 及变量 `--popup-button-list-gap`、`--list-button-padding`、`--base`。
- Produces: 仅分页 Popup 选项生效的 padding 与 line-height 覆盖。

- [x] **Step 1: Write the failing style contract test**

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const customStyles = readFileSync(
  resolve(process.cwd(), 'src', 'app', '(payload)', 'custom.scss'),
  'utf8',
)

describe('admin pagination menu style contract', () => {
  it('restores spacing removed by the PerPage button reset', () => {
    expect(customStyles).toMatch(
      /\.popup__content\s+\.popup-button-list__button\.per-page__button\s*\{[^}]*padding-block:\s*calc\(2px \+ var\(--popup-button-list-gap\) \/ 2\);[^}]*padding-inline:\s*var\(--list-button-padding\);[^}]*line-height:\s*var\(--base\);/s,
    )
  })
})
```

- [x] **Step 2: Run the contract test and verify RED**

Run: `cd payload-office-platform && pnpm exec vitest run tests/admin-pagination-style-contract.test.ts`

Expected: FAIL because `custom.scss` has no scoped pagination override.

- [x] **Step 3: Add the minimal scoped override**

```scss
.popup__content .popup-button-list__button.per-page__button {
  padding-block: calc(2px + var(--popup-button-list-gap) / 2);
  padding-inline: var(--list-button-padding);
  line-height: var(--base);
}
```

- [x] **Step 4: Run contract and related regression tests**

Run: `cd payload-office-platform && pnpm exec vitest run tests/admin-pagination-style-contract.test.ts tests/dashboard-stats-widget-contract.test.ts && pnpm exec tsc --noEmit --pretty false`

Expected: 2 test files pass and TypeScript exits 0.

- [x] **Step 5: Verify the real page in light and dark modes**

Open `/admin/collections/listings`, open “每一页: 10”, and verify each `.per-page__button` has non-zero block padding, `line-height: var(--base)` resolved to 20px, and a height greater than the pre-fix 16.09px. Select 25 and verify the URL/list range updates; then repeat visual and console checks in dark mode and inspect `/admin/collections/buildings` as the adjacent route.

- [x] **Step 6: Record evidence without committing**

Write exact RED/GREEN outputs, computed styles, interaction result, routes and console logs to `artifacts/verification/OPT-024/README.md`; complete only verified task-packet checks. Do not commit or push without a new explicit user request.
