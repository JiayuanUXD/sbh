# OPT-012: 清理 lint 压制和缓存标签契约

任务包。修复提交与任务标记提交分离。

## 完成标准（optimization-backlog.md）

- 无规则压制
- 缓存失效集成测试验证真实 Next 行为

## 审查问题（frontend-acceptance-audit.md）

### P1：lint 基线不可执行

`package.json` 使用 `next lint`，当前 Next.js 版本执行 `pnpm lint` 时把 `lint` 解释为项目目录并报错，lint 并未检查项目。另有两处手工规则压制：审核队列 Hooks 依赖压制、缓存模块动态 `require` 的规则压制。

### P1：缓存标签测试没有验证真实 Next 行为

现有测试通过 fake invalidator 验证 tag 集合；生产适配器对每次 `revalidateTag` 异常捕获并继续，且通过动态 `require('next/cache')` 接入，无法证明真实 Next 运行时中所有预期标签均被正确失效，也无法暴露部分失效。

## 修复内容

### 1. lint 基线迁移至 flat config

- 新建 `eslint.config.mjs`（flat config，`...next` extends eslint-config-next 16，附 ignores）
- `package.json` lint 脚本：`next lint` -> `eslint .`
- 修复 `src/app/(frontend)/dev-story/page.tsx:442` `react/no-unescaped-entities` error（`"` -> `&quot;`）

### 2. 消除全部规则压制

- `src/domain/public-catalog/cache-invalidator.ts`：动态 `require('next/cache')` -> 顶层静态 `import { revalidateTag } from 'next/cache'`（与 `lib/frontend/cached-queries.ts` 一致）；删除 `eslint-disable-next-line @typescript-eslint/no-require-imports`
- `src/components/admin/ListingReviewQueueClient.tsx`：`callReview`/`callPublish`/`handleApprove` 包 `useCallback`；`columns` useMemo deps 补 `handleApprove`；删除 `eslint-disable-next-line react-hooks/exhaustive-deps`

### 3. 缓存失效部分失败可观测

- `cache-invalidator.ts` `handle`：收集 `failedTags`，非空时 `console.error('[cache-invalidator] partial_failure', …)` 上报（不返回 `err`，保持"失效不阻断业务"设计，避免 revalidateTag 持续失败导致事件死信堆积）

### 4. 缓存失效集成测试

- 新建 `tests/cache-next-adapter-integration.test.ts`
- `vi.mock('next/cache')` 注入 spy，验证 `createNextTagInvalidator` 走真实模块路径
- 验证 `listing.published` 事件使 `computeAffectedTags` 计算的所有 tag 经真实 `revalidateTag` 失效（含 sitemap / home / listing / 类别级 tag）
- 验证 `revalidateTag` 部分抛错时 `handle` 返回 `ok` 且 `console.error` 上报 `failedTags`

## 证据

### lint（0 errors，无规则压制）

```text
pnpm --dir payload-office-platform lint
✖ 8 problems (0 errors, 8 warnings)
```

剩余 8 warnings 均为既有代码：`@next/next/no-img-element` ×7（buildings/pages/ListingGallery×3/PageContent/Media）与 `InquiryModal:172` useMemo dep（属 OPT-010 范围）。全项目 `grep eslint-disable` 无匹配。

### 单测

```text
pnpm exec vitest run tests/cache-next-adapter-integration.test.ts
Test Files  1 passed (1)
Tests       3 passed (3)

pnpm exec vitest run tests/public-catalog-cache-invalidator.test.ts
Test Files  1 passed (1)
Tests       17 passed (17)
```

## 遗留（超出 OPT-012 范围）

- `no-img-element` ×7：既有 `<img>` 用法，改 `next/image` 需域名配置与尺寸调整，建议后续单独清理
- `InquiryModal:172` useMemo dep `'open'`：随 OPT-010 埋点重构一并处理
