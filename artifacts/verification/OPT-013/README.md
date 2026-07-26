# OPT-013 验证证据：详情页日期与标题语义

## 工作项

修复详情页 `availableFrom` 直接输出 ISO 串、以及「房源说明」二级标题与富文本首段 h2 重复的问题（P2-06）。

## 构建 SHA / 工作树

- 修复提交：`17088f0 feat(frontend): OPT-013 修复详情页日期本地化与重复标题`
- 分支：`feat/backend-m6-m8`
- 改动文件：
  - `payload-office-platform/src/lib/frontend/format.ts`（新增 `formatAvailableDate`）
  - `payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx`（可入驻日期 + section 标题）
  - `payload-office-platform/tests/format.test.ts`（新增 4 用例）

## 环境与数据前提

- Node.js 24.14.0（项目要求 22.x；仅 engine 警告，不影响正确性，正式验收应在 22.x 复跑）
- 本地 SQLite，seed 数据 8 套有效房源

## 执行命令及退出码

```text
pnpm exec vitest run tests/format.test.ts
Test Files  1 passed (1)
     Tests  11 passed (11)
退出码 0

pnpm typecheck
> tsc --noEmit --pretty false
（无错误输出，仅 Node engine 警告）
退出码 0
```

## 变更与预期

### 日期本地化

- 变更：`listings/[slug]/page.tsx` 可入驻字段由 `{listing.availableFrom || '面议'}` 改为 `{formatAvailableDate(listing.availableFrom)}`。
- `formatAvailableDate` 复用 `domain/shared/time` 的 `parseUtcIso` + `shanghaiDate`，按 Asia/Shanghai 时区渲染为「YYYY年M月D日」，null/空/非法回退「面议」。延续项目「原生 Intl，不引 date-fns/dayjs」约定。
- 预期：`2026-08-01T00:00:00.000Z` -> 「2026年8月1日」；不再输出原始 ISO。
- 单测覆盖：null/空/undefined/非法 ISO/正常 ISO/UTC 跨日时区边界（`2026-07-31T16:00:00.000Z` -> 上海次日「2026年8月1日」）。

### 重复标题

- 变更：`listings/[slug]/page.tsx` section 标题由「房源说明」改为「详细介绍」。
- 根因：原 section h2「房源说明」与 seed 富文本首段 h2「房源说明」同名，页面出现两个同名二级标题。
- 预期：section h2 = 「详细介绍」，富文本首段 h2 = 「房源说明」，两者不同名，标题层级可唯一表达章节结构。

## 未执行项与剩余风险

- **浏览器视觉验证留待 OPT-011 统一执行**：详情页四视口截图将在 OPT-011 的 `f7-2-visual-review.spec.ts` 扩展中覆盖，届时断言日期渲染为本地化格式且无重复同名 h2。
- 富文本首段标题由 CMS 编辑控制；若编辑在富文本中以「详细介绍」开头，仍可能与 section 标题重名。此为内容规范问题，平台层已通过区分 section 标题解决 seed 场景，建议后续在 CMS 编辑指引中补充「富文本首段不建议使用与 section 标题相同的标题」。
