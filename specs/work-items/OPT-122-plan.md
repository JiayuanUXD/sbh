# OPT-122 实施计划（Phase 1–3）

> 依据：`specs/work-items/OPT-122-site-search-and-search-quality.md`（设计已确认）。
> 状态：**待执行**。本计划在主树的 `docs/opt-122-site-search-a7c3` 分支上；执行另开 `feat/opt-122-site-search-*` 的 worktree。
> 纪律：纯逻辑先写失败测试；每个 Batch 结束跑 `pnpm typecheck && pnpm lint && pnpm test`；不手改迁移；未经确认不提交、不推送。

---

## 0. 执行约定

### 任务 0.1：开隔离 worktree

- 路径：`E:\wt-opt122`（根级短路径，避开 Windows 260 字符上限）。
- 命令（在主树执行）：

```bash
cd E:/github/sbh
git worktree add E:/wt-opt122 -b feat/opt-122-site-search-<4hex> origin/master
cp specs/work-items/OPT-122-site-search-and-search-quality.md E:/wt-opt122/specs/work-items/
cp specs/work-items/OPT-122-plan.md E:/wt-opt122/specs/work-items/
```

- 验证：`cd E:/wt-opt122 && git status -sb` 显示新分支；`ls specs/work-items/OPT-122*` 两份文档都在（untracked，仅作参考，不提交）。

### 任务 0.2：环境隔离

- `E:/wt-opt122/payload-office-platform/.env.local`：
  - `PORT=3721`（主树是 3717）；
  - `DATABASE_URL=postgres://…/sbh_dev_opt122`（**不要**指向主树的 `sbh_dev`，更不要指向生产）；
  - `COS_*` 五项留空（走本地磁盘）；
  - `PAYLOAD_SECRET` 用本地随机 32 位以上字符串。
- 若本地没有创建 `sbh_dev_opt122` 的权限，先向用户确认，不擅自连生产库。
- 验证：`psql "$DATABASE_URL" -c 'select 1'` 成功；`echo $PORT` 为 3721。

### 任务 0.3：基线

```bash
cd E:/wt-opt122/payload-office-platform
pnpm install
pnpm generate:types
pnpm payload generate:importmap
pnpm typecheck
pnpm lint
pnpm test
```

- 已知基线（主树 2026-10-12）：`typecheck` 0 error；`lint` 0 error / 35 warning；`vitest` 5970 通过 / 1 失败（`staging-cloudrun-package.test.ts`，本机 tmpdir 跨盘导致，与代码无关）。
- 验证：把实际结果写进 `artifacts/verification/OPT-122/baseline.md`，逐条注明「既有 / 新增」。

---

## Batch 1：纯函数（TDD，L1/L2 的核心）

> 每个任务先写测试文件，跑到红，再实现到绿。测试放 `payload-office-platform/tests/search/`。

### 任务 1.1：归一化与切词

- 文件：`src/domain/search/normalize.ts`、`tests/search/normalize.test.ts`
- 导出：

```ts
export type SearchTerm = Readonly<{ value: string; escaped: string }>
export type NormalizedQuery = Readonly<{
  raw: string
  normalized: string
  terms: readonly SearchTerm[]
}>
export function normalizeSearchQuery(raw: string): NormalizedQuery
export function escapeLikePattern(value: string): string
```

- 规则（按序）：`NFKC` → `trim` → 非「字母/数字/汉字/空白」字符替换为空格 → 连续空白折叠 → ASCII 小写 → 按空白切词 → 去空项 → 每项截 50 字 → 最多 8 项 → 逐项 `escapeLikePattern`。
- 必须通过的用例：

| 输入 | 期望 `terms` |
|---|---|
| `'　静安　整层 '` | `['静安', '整层']` |
| `'静安，整层。'` | `['静安', '整层']` |
| `'ＡＢＣ　写字楼'` | `['abc', '写字楼']` |
| `'１２３'` | `['123']` |
| `'   '` | `[]` |
| `'\u0000'` | `[]` |
| `'a'.repeat(120)` | `['a'.repeat(50)]` |
| 10 个词 | 只保留前 8 个 |

- `escapeLikePattern('50%_\\')` → `'50\\%\\_\\\\'`。
- 验证：`pnpm vitest run tests/search/normalize.test.ts` 全绿。

### 任务 1.2：命中打分

- 文件：`src/domain/search/rank.ts`、`tests/search/rank.test.ts`
- 导出：

```ts
export type MatchFields = Readonly<{
  title?: string | null
  buildingName?: string | null
  districtName?: string | null
  metroName?: string | null
}>
export function scoreListingMatch(fields: MatchFields, term: string): number
export function scoreListingMatchAll(
  fields: MatchFields,
  terms: readonly string[],
): Readonly<{ score: number; matched: number }>
```

- 权重：标题 100 / 80 / 60（全等 / 前缀 / 包含）；楼盘 90 / 70 / 50；行政区 40 / 35 / 30；地铁 35 / 30 / 25。
- 单字段取**最高分**，不叠加；多词为各词得分之和，`matched` 为命中词数。
- 用例：
  - `{ title: '陆家嘴整层' }` + `'陆家嘴'` → 80；
  - `{ title: '陆家嘴整层' }` + `'陆家嘴整层'` → 100；
  - `{ buildingName: '上海中心' }` + `'上海中心'` → 90；
  - `{ title: 'A', buildingName: '上海中心' }` + `'上海中心'` → 90（取最大，不是 90+60）；
  - 两个词分别命中 title 与 district → `matched: 2`。
- 验证：`pnpm vitest run tests/search/rank.test.ts`。

### 任务 1.3：放宽候选

- 文件：`src/domain/search/relax.ts`、`tests/search/relax.test.ts`
- 导出：

```ts
export type Relaxation = Readonly<{
  terms: readonly string[]
  dropped: readonly string[]
  mode: 'drop-last' | 'or'
}>
export function relaxQuery(terms: readonly string[]): readonly Relaxation[]
```

- 规则：`terms.length <= 1` → `[]`；否则依次给「去掉最后一项」与「OR 全部词项」两个候选，最多两个。
- 用例：`['静安','整层','500平']` → `[{terms:['静安','整层'],dropped:['500平'],mode:'drop-last'}, {terms:['静安','整层','500平'],dropped:[],mode:'or'}]`。
- 验证：`pnpm vitest run tests/search/relax.test.ts`。

### 任务 1.4：零结果分类

- 文件：`src/domain/search/zero-state.ts`、`tests/search/zero-state.test.ts`
- 导出：

```ts
export type ZeroResultKind = 'entity' | 'city' | 'suggestion' | 'curated'
export function classifyZeroResult(input: Readonly<{
  exactEntity: Readonly<{ kind: 'building' | 'district' | 'metro'; name: string }> | null
  cityMatch: Readonly<{ slug: string; name: string }> | null
  suggestions: readonly string[]
}>): ZeroResultKind
```

- 优先级：`entity` > `city` > `suggestion` > `curated`。
- 用例：命中楼盘 → `entity`；只命中外地城市 → `city`；有「你是不是想找」→ `suggestion`；都没有 → `curated`。
- 验证：`pnpm vitest run tests/search/zero-state.test.ts`。

### 任务 1.5：词表解析

- 文件：`src/domain/search/vocabulary.ts`、`tests/search/vocabulary.test.ts`
- 导出：

```ts
export type VocabularyKind = 'building' | 'district' | 'businessArea' | 'metro' | 'city'
export type VocabularyEntry = Readonly<{
  kind: VocabularyKind
  id: number | string
  slug: string
  name: string
  parentName?: string
  aliases: readonly string[]
  pinyin: string
  initials: string
}>
export type SearchVocabulary = Readonly<{ city: string; entries: readonly VocabularyEntry[] }>
export function resolveVocabularyTerm(
  vocab: SearchVocabulary,
  term: string,
): readonly VocabularyEntry[]
```

- 解析顺序：名称全等 → 别名全等 → 全拼全等 → 首字母全等 → 名称前缀 → 全拼前缀；命中某一层就返回该层全部，按 `building > district > businessArea > metro > city`、名称长度升序。
- 用例：
  - `'lujiazui'` → 陆家嘴（district 或 businessArea）；
  - `'shzx'` → 上海中心（building）；
  - `'IFC'` → 上海国金中心（building）；
  - 同城两个同音条目 → 都返回，不静默取第一个；
  - `'changning'` 在只有长宁的城市里不会返回外地的常宁。
- 验证：`pnpm vitest run tests/search/vocabulary.test.ts`。

### 任务 1.6：查询扩展

- 文件：`src/domain/search/expand.ts`、`tests/search/expand.test.ts`
- 导出：

```ts
export type ExpandedQuery = Readonly<{
  listingTerms: readonly string[]
  buildingIds: readonly number[]
  resolved: readonly VocabularyEntry[]
}>
export function expandSearchTerms(
  terms: readonly string[],
  vocab: SearchVocabulary,
): ExpandedQuery
```

- 规则：ASCII 词解析成实体后，把 `entry.name` 加进 `listingTerms`；building 类型同时加 `buildingIds`；中文词保留原词，若本身是别名则加 canonical；结果去重、保持顺序。
- 用例：`['lujiazui','整层']` → `listingTerms` 含 `'陆家嘴'`、`'整层'`；`['shzx']` → `buildingIds` 含上海中心的 id。
- 验证：`pnpm vitest run tests/search/expand.test.ts`。

---

## Batch 2：词表数据与多音字

### 任务 2.1：公开词表 SQL

- 文件：`src/domain/public-catalog/search-vocabulary-sql.ts`、`tests/search-vocabulary-postgres.test.ts`
- 导出：

```ts
export type SearchVocabularyRow = Readonly<{
  kind: 'building' | 'district' | 'businessArea' | 'metro' | 'city'
  id: number
  slug: string
  name: string
  parent_name: string | null
}>
export function buildSearchVocabularyQuery(city: string): Readonly<{ text: string; values: unknown[] }>
```

- 覆盖：公开楼盘（`getPublicBuildingWhere` 同口径）、`frontendVisible` 的行政区 / 商圈、启用的地铁站、当前城市。
- 上限：`LIMIT 100000`；超过抛错（与楼盘目录的 250k 安全上限同型）。
- 验证：`pnpm vitest run tests/search-vocabulary-postgres.test.ts --no-file-parallelism`（需要 `DATABASE_URL`）。

### 任务 2.2：词表缓存与拼音

- 文件：`src/domain/search/vocabulary.ts`（补 `buildSearchVocabulary`）、`src/lib/frontend/cached-queries.ts`
- 导出：`buildSearchVocabulary(rows, city)`、`getCachedSearchVocabulary(city)`。
- 拼音：`pinyin(name, { toneType: 'none', type: 'array' }).join('')`；首字母：`pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' }).join('')`。
- 缓存：`unstable_cache`，键含 city，`revalidate: 300`，tags 用 `listingsCityTag + buildingsCityTag + facetsTag`；按城市 memo。
- 验证：单测覆盖 `上海中心 → shanghaizhongxin / shzx`、`陆家嘴 → lujiazui / ljz`；缓存只打一次库（用 fake loader 计数）。

### 任务 2.3：别名与多音字

- 文件：`src/domain/search/aliases.ts`、`src/domain/search/pinyin-overrides.ts`、`tests/search/aliases.test.ts`
- 初始别名（可增补）：

```ts
export const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  '上海中心': ['上海中心大厦', 'shzx'],
  '上海国金中心': ['国金中心', 'IFC'],
  '上海环球金融中心': ['环球金融中心', 'SWFC'],
  '陆家嘴': ['lujiazui', 'ljz'],
  '静安寺': ['jingansi', 'jas'],
}
```

- 多音字白名单：至少覆盖 `长宁`、`银行`、`重庆`、`厦门`、`蚌埠`；测试断言拼音正确。
- 验证：`pnpm vitest run tests/search/aliases.test.ts`。

---

## Batch 3：查询层

### 任务 3.1：房源搜索 SQL（含 match_score）

- 文件：`src/domain/public-catalog/listing-query-sql.ts`、`tests/site-search-listings-postgres.test.ts`
- 改法：
  - 抽出 `buildListingMatchScore(terms, bind)`，返回 `CASE WHEN …` 表达式；
  - `filteredQuery` 增加可选 `terms` 与 `mode: 'and' | 'or'`；
  - 每个词生成 `(l.title ILIKE $n OR b.name ILIKE $n OR dist.name ILIKE $n OR ba.name ILIKE $n OR metro.name ILIKE $n)`；`and` 用 `AND` 连接，`or` 用 `OR`；
  - `match_score` 加到 `normalized` CTE，`ORDER BY match_score DESC, COALESCE(is_featured,false) DESC, updated_at DESC, id ASC`；
  - 不改 `/listings` 的现有调用路径（不传 `terms` 时行为与今天完全一致）。
- 用例（真库）：
  - 标题全等的房源排在标题包含的前面；
  - 楼盘名命中的房源进入结果；
  - 两个词 AND 命中；一个词无命中时 AND 返回 0、OR 返回至少 1；
  - 分页与 `total` 与结果一致。
- 验证：`pnpm vitest run tests/site-search-listings-postgres.test.ts --no-file-parallelism`。

### 任务 3.2：房源搜索缓存

- 文件：`src/lib/frontend/cached-queries.ts`
- 导出：`getCachedSiteSearchListings(city, q, page, pageSize)`；内部构造 `ListingSearchInput`（`q`、`page`、`pageSize`、`sort: 'recommended'`），复用 selection + cards 两段缓存；键含归一化 q、page、pageSize。
- 验证：单测断言 `pageSize: 8` 与 `24` 是两条不同缓存键；同一 q 第二次调用不重复打库（fake）。

### 任务 3.3：楼盘 q

- 文件：`src/domain/public-catalog/building-search.ts`、`building-query-sql.ts`、`tests/site-search-buildings-postgres.test.ts`
- 改法：`BuildingSearchInput` 加 `q?: string`；`parseBuildingSearchInput` 复用 `normalizeSearchQuery`；SQL 加 `b.name ILIKE` / 区名 / 商圈名 / 地铁名；`ORDER BY match_score`。
- 验证：名称全等排第一；分页/计数正确；不传 q 行为不变。

### 任务 3.4：资讯 q

- 文件：`src/domain/public-catalog/facade.ts`、`src/lib/frontend/cached-queries.ts`、`tests/site-search-articles-postgres.test.ts`
- 导出：`searchPublishedArticles(q, page, pageSize)`；`payload.find` 的 `where.and` 加 `or: [{ title: { contains } }, { excerpt: { contains } }]`，只查 `published` + 未删除。
- 缓存：`getCachedSiteSearchArticles(city, q, page)`，tag `ARTICLES_CATEGORY_TAG`。
- 验证：标题命中优先于摘要；分页与 total 正确。

### 任务 3.5：计数与兜底

- 文件：`src/lib/frontend/cached-queries.ts`
- 导出：
  - `getCachedSiteSearchCounts(city, q)`：三类 `total` 并行；
  - `getCachedSearchFallback(city)`：热门区域 6（facet 计数）、热门楼盘 4（在租套数）、推荐房源 4（`recommended`）。
- 约束：兜底按城市缓存 300s，不按 q；不水合超过 4 张卡。
- 验证：单测断言缓存键不含 q；页面上限 3 块。

---

## Batch 4：路由与 metadata

### 任务 4.1：搜索路由

- 文件：`src/app/(frontend)/[city]/search/page.tsx`
- 解析：`q`（归一化）、`tab` 白名单、`page`（1..10000）；`resolveCityContext`；coming-soon 走 `ComingSoonCityView`。
- 取数：`q` 为空 → 只取 fallback；否则 `Promise.all` 三类查询 + 计数（当前 tab 的页数据 + 另两类 count）。
- 渲染：`<SiteSearchView … />`。
- 验证：单测覆盖空 q、非法 tab、越界 page、未开通城市。

### 任务 4.2：兼容路由

- 文件：`src/app/(frontend)/search/page.tsx`
- 行为：按 `siteConfig.defaultCity` 解析 city，307 到 `/[city]/search`，保留 `q` / `tab` / `page`。
- 验证：`curl -I` 看到 307 与正确的 `Location`。

### 任务 4.3：城市路由类型

- 文件：`src/lib/frontend/city-routes.ts`、`tests/search-city-routes.test.ts`
- 改法：`CityPageType` 加 `search`；`citySwitchPreservedFilters` 保留 `q` / `tab` / `page`；4 个穷举 switch 补分支。
- 验证：城市切换 href 带 `q/tab/page`；无前缀转换不丢参数。

### 任务 4.4：noindex

- 文件：`src/app/(frontend)/[city]/search/page.tsx`、`src/app/(frontend)/listings/page.tsx`、`src/app/(frontend)/[city]/listings/page.tsx`
- 改法：搜索页 `robots: { index: false, follow: true }`；列表页在 `input.q` 存在时同样 noindex；其他筛选组合不动。
- 验证：`curl` 抓 `<meta name="robots">`；单测覆盖 q 有/无两种。

---

## Batch 5：UI

### 任务 5.1：Tabs

- 文件：`src/components/frontend/search/SearchTabs.tsx`
- 结构：`<nav aria-label="搜索结果类型">` + 4 个链接（全部 / 房源 N / 楼盘 N / 资讯 N）；`aria-current="page"`；切 tab 删 `page`。
- 验证：1440/375 截图；键盘 Tab 可逐项聚焦。

### 任务 5.2：结果视图

- 文件：`src/components/frontend/search/SiteSearchView.tsx`
- 顶部：搜索输入框（回填 `q`，提交走 `buildSiteSearchHref`）；`q` 为空时渲染搜索引导（热门区域 / 热门楼盘 / 推荐房源），不渲染 tab 结果区。
- 单字查询：结果区顶部给「补充一个字会更准」提示，不阻断结果。
- `all`：房源 8（移动端 CSS 只露 4）/ 楼盘 4 / 资讯 3；区块为 0 不渲染；每块「查看全部 N 条 →」。
- tab：复用 `ListingResultCard` / `BuildingResultCard` / 资讯行；底部复用/仿 `ListPager` 的分页（tab 内 `page`）。
- 验证：三类都有结果、单类为 0、全部为 0 四种状态下截图。

### 任务 5.3：零结果组件

- 文件：`src/components/frontend/search/SearchZeroState.tsx`
- 结构：h1 +「你是不是想找」≤3 + 实体卡 + 最多 3 个内容块 + `InquiryModal` CTA。
- 数据：由路由传入 `classifyZeroResult` 的结果与 fallback。
- 验证：四种零结果类型各一张截图；块数 ≤3。

### 任务 5.4：样式

- 文件：`src/app/(frontend)/styles/search.css`
- 只用现有 token；桌面 4 列沿用 `.ls-grid` 的断点；移动端 1 列；搜索框 sticky；无新颜色字面量。
- 验证：1440/375 无横向滚动；`prefers-reduced-motion` 下过渡关闭。

### 任务 5.5：可访问性

- 文件：`SiteSearchView.tsx`、`SearchZeroState.tsx`
- 加 `aria-live="polite"` 的结果计数；h1/h2 层级；建议列表用 `<ul><li><a>`。
- 验证：Playwright 断言 `aria-live` 存在；键盘可完成搜索与翻页。

---

## Batch 6：入口改造

### 任务 6.1：href 构造

- 文件：`src/lib/frontend/search-submit.ts`、`tests/search-submit.test.ts`
- 新增 `buildSiteSearchHref(citySlug, { q, tab, page })`；`tab=all` 不写、`page=1` 不写、`q` trim + 100 字截断。
- 验证：单测覆盖有/无 city、空 q、tab/page 省略。

### 任务 6.2：顶栏

- 文件：`src/components/frontend/HeaderSearch.tsx`
- 提交改 `buildSiteSearchHref`；表单 `action` 改成 `/search` 路径（无 JS 兜底）；`initialKeyword` 逻辑不变。
- 验证：在首页 / 列表页 / 搜索页各提交一次，落到 `/search?q=`。

### 任务 6.3：首页搜索 pill

- 文件：`src/components/frontend/home/HomeSearchPill.tsx`
- 只填 q → `buildSiteSearchHref`；带 district/type/area → `buildListingSearchHref`。
- 验证：两个分支的 href 单测 + 浏览器点击。

---

## Batch 7：埋点

### 任务 7.1：`site_search`

- 文件：`src/components/frontend/search/SearchAnalytics.tsx`、`src/lib/frontend/analytics.ts`、`tests/search-analytics.test.ts`
- 字段：`city/q_length/tab/page/result_total/result_listings/result_buildings/result_news/zero_result/relaxed`；不含 q 原文；按 `q hash + tab` 去重。
- 验证：单测断言 payload 不含 `q`；同状态只上报一次。

### 任务 7.2：兜底与建议点击

- 文件：`SearchZeroState.tsx`、`SearchTabs.tsx`
- 事件：`search_suggestion_click`、`search_fallback_click`、`search_inquiry_open`。
- 验证：点击各块各产生一条事件（测试替身）。

---

## Batch 8：验收

### 任务 8.1：E2E

- 文件：`tests/e2e/search.spec.ts`
- 场景：顶栏/首页两个入口、三类结果、tab 切换与分页、实体卡、全局零结果、移动端 375、键盘、`aria-live`。
- 验证：`pnpm test:e2e -- tests/e2e/search.spec.ts`。

### 任务 8.2：证据

- `artifacts/verification/OPT-122/`：截图、`curl` metadata、查询条数、a11y、多音字清单。
- 验证：文件齐全，`README.md` 索引。

### 任务 8.3：全量检查

```bash
pnpm generate:types && pnpm payload generate:importmap
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

- 验证：全绿；`build` 的生产环境变量按 `DEPLOYMENT.md` 本地预检，不连生产库。

---

## 依赖与派单

- 顺序：Batch 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8。
- Batch 5 与 6 可以并行，但 `cached-queries.ts` 只能由 Batch 3 的代理改，避免冲突。
- 每个 Batch 一个全新子代理；主代理只做编排、评审与合并，不直接写业务代码。
- 每个 Batch 结束跑一次 `typecheck + lint + test`，Critical 问题阻断下一批。

## 计划变更

计划变了先改本文件，再派活；不要在执行中悄悄改口径。
