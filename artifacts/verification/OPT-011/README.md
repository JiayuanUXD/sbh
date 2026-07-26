# OPT-011 桌面/移动浏览器验收闭环

## 背景

`optimization-backlog.md` OPT-011 / 审查 P2-03：浏览器验收证据尚未完全闭环。已通过首页/列表/详情/咨询旅程、楼盘到咨询、内容页咨询/404/空态/错误/重复提交/隐私、首页列表 4 视口、加载/空态/错误/极端租金、无障碍。仍需补充：

1. 房源详情、楼盘详情、内容页的完整四视口证据
2. 停用供给在列表、详情、站点地图等入口不可达的专项证据
3. 生产构建环境中开发故事页不可访问的实际结果

## 补齐工作

### 1. 详情/楼盘/内容页四视口（扩展 f7-2 spec）

`tests/e2e/f7-2-visual-review.spec.ts` 新增 3 个用例，各覆盖 4 档视口（375×812 / 768×1024 / 1440×900 / 1920×1080）：

- 房源详情页 `/listings/jingan-serviced-office-42-seats`
- 楼盘详情页 `/buildings/west-nanjing-premium-center`
- 内容页 `/pages/about`

每视口断言 `h1` 可见并截图存档至 `artifacts/verification/f7-2-visual-review/<page>-<viewport>.png`。

### 2. 停用供给不可达专项（新建 spec）

`tests/e2e/disabled-supply-not-reachable.spec.ts`，5 个用例：

- 不存在的房源 slug -> 404
- 不存在的楼盘 slug -> 404
- sitemap 中所有房源/楼盘 URL 返回 200（sitemap 只含有效供给）
- 列表页房源详情链接均出现在 sitemap 中（无停用供给混入）
- dev-story 不出现在 sitemap 中

说明：seed 数据全部 `publicationStatus=published`，无真实停用 listing。非有效供给（draft/unpublished/leased/举报暂停）与"不存在 slug"在运行时表现一致--均不在 `findEffectiveListings` 结果，详情页 `notFound()`。纯函数层停用过滤由 `public-catalog-effective-supply-consistency.test.ts` 覆盖（§2a draft / §2b unpublished / §5 paused）。

### 3. dev-story 生产 404 实际验证

`dev-story/page.tsx:197` 守卫 `if (process.env.NODE_ENV === 'production') notFound()`。本地 production build + start 实测：

```text
pnpm build        # next build 成功，/dev-story 标记为 ƒ (Dynamic)
PORT=3001 pnpm start -p 3001
curl /dev-story  -> status=404  ✓
curl /listings   -> status=200  ✓ (对照)
curl /           -> status=200  ✓ (对照)
```

## 验证证据

### 全量 e2e（dev server :3717，playwright chromium）

```text
pnpm exec playwright test tests/e2e/f7-2-visual-review.spec.ts
  14 tests: 13 passed, 1 skipped  (dev-story 生产 404 由本次 production build 验证)

pnpm exec playwright test tests/e2e/disabled-supply-not-reachable.spec.ts
  5 tests: 5 passed

pnpm exec playwright test tests/e2e/frontend-journey.spec.ts tests/e2e/f7-3-accessibility.spec.ts
  18 tests: 18 passed  (InquiryModal/layout/analytics 改动无回归)
```

合计 37 项 e2e：36 通过，1 跳过（dev-story 生产 404 已由 production build 独立验证）。

截图产物：`payload-office-platform/artifacts/verification/f7-2-visual-review/{detail,building,content}-{mobile,tablet,desktop,wide}.png` 等。

## 约束遵守

- 未新增 `any` / `as any` / `@ts-ignore` ✓
- 未触碰迁移文件、生产 DB ✓
- e2e 复用 dev server（:3717），未启多余服务 ✓
- production build 验证后立即 kill prod server，未残留进程 ✓
