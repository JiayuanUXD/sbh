# OPT-009 移动端筛选候选结果数估算

## 背景

`optimization-backlog.md` OPT-009：移动端筛选抽屉（`MobileFilterDrawer`）暂存条件时，用户无法预知将看到多少套房源，需点"查看"提交后才知道结果数。要求暂存条件变化时实时估算候选结果数，按钮文案随暂存条件更新。

## 方案

- **Next Server Action**（用户确认）：新建 `'use server'` Action `estimateListingCount(filters)`，复用 `public-catalog` facade 的 `getSearchFacets` 口径估算 totalDocs。Server Action 在 RSC 安全环境执行，走 Payload Local API，不暴露 `/api/*`。
- **debounce 300ms + requestId**：暂存条件变化后 300ms 才发起估算；用 `useRef` 自增 requestId，仅采纳最新请求结果，避免旧请求覆盖。
- **按钮文案**：`查看 {estimateCount ?? totalDocs} 套房源`，`null` 时 fallback 到已应用条件的 totalDocs。
- **lint 合规**：effect body 不同步 `setState`（Next 16 `react-hooks/set-state-in-effect` 规则）。`setEstimateCount` 只在 `setTimeout` 异步回调中调用；打开抽屉时在 `openDrawer` 事件处理函数里清空 estimateCount，不在 effect 里清。

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/app/(frontend)/listings/actions.ts` | 新建。`'use server'` 导出 `estimateListingCount(filters: Record<string,string>): Promise<number\|null>`。URLSearchParams -> `parseListingSearchInput` -> `defaultSearchContext` -> `getSearchFacets` -> `facets.totalDocs`。异常返回 `null`（fallback totalDocs）。 |
| `src/components/frontend/MobileFilterDrawer.tsx` | 新增 `estimateCount` state + `estimateReqIdRef`；纯函数 `validateStaging` / `buildStagedParams`（提交逻辑复用）；debounce effect（300ms + requestId，无同步 setState）；`openDrawer` 清空 estimateCount；按钮文案 `查看 {estimateCount ?? totalDocs} 套房源`。 |
| `src/domain/public-catalog/facade.ts` | 修正过期注释：facet 现跟随当前搜索条件（`findEffectiveListings(facetInput)`），totalDocs 与列表页 `searchListings` 同一筛选口径（OPT-009 估算复用此口径）。 |

## 验证证据

### 静态检查

```
pnpm lint     -> 0 errors, 8 warnings（均为预存 no-img-element / InquiryModal useMemo，与 OPT-009 无关）
pnpm typecheck -> 通过（无输出）
```

### 浏览器验收（移动端 375×812，dev server :3717）

1. 打开 `/listings`，列表页渲染 8 套房源 ✓
2. 点"筛选"打开 drawer，按钮显示 `查看 8 套房源`（fallback totalDocs）✓
3. 区域选"静安区"（jingan），debounce 300ms 后按钮更新为 `查看 2 套房源`（静安南京西路 360㎡ + 静安整层 850㎡，正确）✓
4. 区域改"徐汇"（xuhui），按钮更新为 `查看 1 套房源`（徐家汇 200㎡，正确）✓
5. console 无 error，network 无 failed request ✓

估算口径与列表页提交后结果一致（同一 `getSearchFacets` / `searchListings` 筛选口径）。

## 约束遵守

- C 端只走 Payload Local API，未调 REST `/api/*`（Server Action 经 facade）✓
- 未新增 `any` / `as any` / `@ts-ignore` ✓
- 未触碰迁移文件、生产 DB（`push: false`）✓
- effect 合规 Next 16 `react-hooks/set-state-in-effect`（无同步 setState）✓
