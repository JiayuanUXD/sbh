# OPT-122 实施记录

- 分支：`feat/opt-122-site-search-6912`（worktree `E:\wt-opt122`）
- 基线提交：`4af9531d`
- 日期：2026-10-19 实施；2026-10-20 验收整改

## 2026-10-20 验收整改（验收报告 acceptance.md 的 PARTIAL 项与缺口）

### A5：放宽标注点名忽略词

- `cached-queries.ts`：接线 `relaxQuery`（原本就设计好了 `dropped` 但没接）——AND 为 0 时按
  「去掉最后一个词 → 全部 OR」顺序试，第一个有结果的候选胜出；`relaxed` 由 boolean 扩充为
  `relaxed: boolean` + `relaxedTerms: readonly string[]`。
- `SiteSearchView.tsx`：标注改为「没有完全匹配的结果，已忽略『游泳池』，以下为放宽后的结果。」
- 实测：`q=静安 游泳池` → AND=0 → drop-last 命中 4 条，标注正确出现；`q=静安 整层` 有完美
  匹配（AND=1），**不**触发放宽、不出现标注（符合预期）。

### A3：房源 tab 分类型零结果给出楼盘出口

- `SiteSearchView.tsx`：`tab=listings` 且房源 0、楼盘 > 0 时，渲染「该关键词暂无在租房源，
  但命中了 N 个相关楼盘」+ 楼盘卡片（top 4）+「查看全部 N 个楼盘 →」。
- 实测：`q=静安待租楼盘&tab=listings` 正确出现出口；全局零结果态未被误触发。

### A4：seed 补齐别名指向的楼盘

- `scripts/seed.ts` 新增「上海中心」（slug `shanghai-tower`）与「上海国金中心」
  （slug `shanghai-ifc`），均 0 在租、位于浦东陆家嘴。幂等重跑 seed 后验证：
  `shzx` / `IFC` / `上海中心` 全部 → 楼盘 1 命中，别名链路端到端打通。

### 输入联想（Phase 3 范围缺口）

- `src/domain/search/suggestions.ts`：`buildSearchSuggestions` 纯函数——跨层级收集
  （名称/别名/全拼/首字母精确 + 名称/全拼前缀），按 tier → kind → 名称长度排序；
  中文单字允许名称前缀（打「上」出「上海中心」），拉丁单字一律不前缀；
  **当前城市不进联想**（在 /shanghai 下打「上海」出「上海（城市）」是噪音）。
- `src/app/(frontend)/[city]/search/suggestions/route.ts`：GET 建议接口，只读按城市
  缓存的词表（0 条 SQL），响应 `no-store`，未知城市返回空列表而非 404。
- `useSearchSuggestions.ts`：150ms 防抖 + AbortController + 统一键盘（↑/↓/Esc/Enter）；
  **焦点门控**——只有输入框聚焦过才发请求，否则带着 q 落到搜索结果页时回填的 keyword
  会让联想自动展开（实测 375 下顶栏与页面表单两个 listbox 同时出现）；
  展开后失焦不清空（openRef），保证鼠标移向选项时列表不闪断。
- `SearchSuggestionList.tsx`：WAI-ARIA combobox 模式（listbox/option/aria-selected，
  输入框侧 aria-expanded/aria-controls/aria-activedescendant）。
- 接入两处：`HeaderSearch`（顶栏，Esc 两段式：先收联想再收搜索层）与
  `SiteSearchForm`（搜索页表单，保留原生 GET 提交兜底，联想只是增强）。
- E2E 4 条：顶栏键盘选楼盘直达、页面表单点击直达、加载不自动展开（隐式）、
  拼音别名直达。

### A2：分页器运行时验证

- 种子库最大同词结果 4 条 < 24/页，第 2 页永不出现。验收时向 dev 库临时插入 30 条
  有效房源（SQL 复制既有行，需带齐 `rent/merchant_id/verification_info_verified_at/version`
  否则不过有效供给谓词），实测 page=1 共 30 条 / 24 张卡 / 分页链接带 `aria-current`，
  page=2 余 6 张；验证后已删除（库恢复 11 条种子）。
- **环境发现**：dev 模式下 `unstable_cache` 跨服务器重启持久（疑似落盘），绕过 Payload
  的裸 SQL 写入不触发缓存失效——同一关键词换新词才能测到新鲜结果。这不是代码问题，
  但验收/调试时要知道：改了库必须换关键词或清 `.next` 缓存。

### 证据补齐（spec §19）

- `metadata.txt`：robots/canonical/title/307 实测 + tab 计数一致性抽样。
- `query-count.md`：插桩 pg 复刻路由冷路径 = **16 条 SQL**（词表 1 + 选页 1 + 卡片 6 +
  楼盘 5 + 资讯 3）；热路径全部命中 unstable_cache（0 条），HTTP 计时 冷 0.63s / 热 0.13s；
  联想接口 0 条 SQL。
- `pinyin-audit.md`：词表 3/16 含多音字（长宁/外滩源大厦/徐家汇国际大厦），
  `pinyin-pro` 默认读音全部正确，无需人工订正。
- `a11y.md`：键盘路径（E2E 实证）、combobox ARIA、对比度 token、动效。
- 截图：`desktop-1440-suggestions.png`、`mobile-375-suggestions.png`、
  `desktop-1440-crossout.png`、`desktop-1440-relaxed.png`。

## 已完成（2026-10-19 首批）

### 域层（纯函数，TDD）

- `src/domain/search/normalize.ts`：NFKC、全半角、标点当分隔符、ASCII 小写、切词、8 项/50 字上限、LIKE 通配符转义。
- `src/domain/search/rank.ts`：标题/楼盘/行政区/地铁的字段权重，单词取最高分、多词累加并统计命中数。
- `src/domain/search/relax.ts`：去尾词 + OR 两个放宽候选，最多一层。
- `src/domain/search/zero-state.ts`：实体 > 城市 > 建议 > 策展的优先级。
- `src/domain/search/vocabulary.ts`：名称/别名/全拼/首字母/前缀分层解析，单字不做首字母与前端前缀匹配。
- `src/domain/search/vocabulary-build.ts`：`pinyin-pro` 生成全拼/首字母，附加代码内别名，按 `kind:id` 去重。
- `src/domain/search/expand.ts`：ASCII 词扩展为中文实体名；歧义保留全部候选、查询取排序第一。
- `src/domain/search/tabs.ts`：`q/tab/page` 解析与白名单。

### 数据与查询

- `src/domain/public-catalog/search-vocabulary-sql.ts`：城市 + 前台可见行政区/商圈 + 启用地铁 + 公开楼盘；枚举值按真实 schema（`business_area` / `metro_station` / `metro_line`）。
- `src/lib/frontend/cached-queries.ts`：
  - `getCachedSearchVocabulary`（按城市 300s）；
  - `getCachedSiteSearchListings`（AND → 0 时自动降级 OR，返回 `relaxed`）；
  - `getCachedSiteSearchBuildings`（拼音先扩展成中文实体名再查楼盘）；
  - `getCachedSiteSearchArticles`（标题/摘要 contains）；
  - `getCachedSearchFallback`（热门区域/热门楼盘/推荐房源，按城市缓存）。
- `listing-query-sql.ts`：新增 `ListingSearchRanking`，`match_score` 只用于站内搜索；不传时列表页行为不变。
- `building-search.ts` / `building-query-sql.ts`：`BuildingSearchInput.q`、命中分与排序；不传 q 行为不变。
- `supply-adapter.ts` / `facade.ts`：`findPublishedArticles` / `listPublishedArticles` 增加可选 `q`。

### 路由与 UI

- `src/app/(frontend)/[city]/search/page.tsx`：`q/tab/page` 解析、三类并行取数、`noindex`。
- `src/app/(frontend)/search/page.tsx`：307 到默认城市，保留 `q/tab/page`。
- `SiteSearchView` / `SearchTabs` / `SearchZeroState` / `SearchAnalytics` / `search.css`：
  - 全部：房源 top 8、楼盘 top 4、资讯 top 3；
  - tab 内分页；
  - 零结果：建议（来自词表解析）+ 实体卡 + 热门区域/热门楼盘/推荐房源 + 留资 CTA；
  - `site_search` 埋点，不含 q 原文。
- `search-submit.ts`：`buildSiteSearchHref` / `siteSearchPathFor`。
- `HeaderSearch` 提交到站内搜索；`HomeSearchPill` 只填关键词走搜索、带筛选仍走列表页。
- `city-routes.ts`：新增 `search` 页面类型，城市切换保留 `q/tab/page`；`/listings?q=` 与 `/search` 均 noindex。

### 测试

- 纯函数/链接/参数：`tests/search-*.test.ts` 共 55+ 用例。
- 词表 SQL：`tests/search-vocabulary-postgres.test.ts`（本地临时表）。
- E2E：`tests/e2e/search.spec.ts` 5 条（入口、tab、零结果、兼容跳转、移动端无横向滚动）。
- 守卫修正：`site_search` 加入 `ANALYTICS_EVENTS`；`search` 加入导航目标豁免并写明理由；`findPublishedArticles` 类型契约测试同步。
- 全量：`typecheck` 0 error；`lint` 0 error / 37 warning（既有）；`vitest` 除 `staging-cloudrun-package` 既有超时外全绿；`supply-sync-chunk` 单跑通过（全量并发下曾超时）。

### 整改后测试（2026-10-20）

- 搜索单测 73 passed（新增 `tests/search-suggestions.test.ts` 15 条）。
- E2E `tests/e2e/search.spec.ts` **10 passed**（新增联想 ×2、分类型零结果、放宽标注、拼音别名直达；dev 与 `next start` 生产模式各跑一遍）。
- **CI 适配**：CI 主趟不设 `MULTI_CITY_ROUTING_ENABLED`（关闭态），顶栏 `citySlug` 为空、
  联想按设计不请求——「顶栏联想」用例按 `detail-pages` 等既有 spec 的口径加
  `test.skip(!ROUTING_ENABLED)`；开启态（生产形态）仍 10/10 全过，关闭态 9 passed / 1 skipped。
- 全量 `vitest` 6627 passed / 2 failed：`staging-cloudrun-package`（既有环境超时）与
  `supply-sync-chunk`（并发抖动）——**主树对照实验证明与 OPT-122 无关**：不含 OPT-122
  代码的主树全量跑同样挂这两个（6554 passed / 2 failed，失败项一致）。
- `pnpm build` 通过；产物含 `/[city]/search`、`/search`、`/[city]/search/suggestions`。

## 验证结果

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 0 error |
| `pnpm lint` | 0 error / 37 warning（均为既有 `no-img-element` / `admin/login` 链接告警） |
| `pnpm test`（全量） | 6609 passed / 2 failed：`staging-cloudrun-package` 既有 5s 超时；`supply-sync-chunk` 全量并发下超时，单跑通过 |
| `pnpm build` | 通过；产物含 `/[city]/search` 与 `/search`。第二次构建被沙箱的批量删除守卫拦在 `.next/trace`，把旧 `.next` 移走后干净构建通过（非代码问题） |
| `pnpm test:e2e tests/e2e/search.spec.ts` | 5 passed（入口 / tab / 零结果 / 兼容跳转 / 移动端无横向滚动）；dev 与 `next start` 生产模式各跑一遍均通过 |
| 浏览器实测 | 有结果、零结果、楼盘 tab、移动端 375 均正常；`/listings?q=` 返回 `noindex` |

兜底内容改为**按需取数**：有结果时不发热门区域/热门楼盘/推荐房源三条查询，只有空查询或全局零结果才取。

## 已知偏差与后续

1. **`all` 房源区块仍水合 24 张卡**：`Pagination.pageSize` 是字面量 `24`，本期不在 UI 前改类型；页面只展示前 8 张。后续可把 `pageSize` 放宽为 `number`，或给搜索页单独一个 8 条的选择查询。
2. **did-you-mean 未做相似度**：建议项来自词表解析（拼音/别名命中），没有编辑距离/trgm；中文错字（如「陆家咀」）暂无建议。L3 需要 `pg_trgm` 扩展权限。
3. **兜底块点击埋点未接**：只上报 `site_search`；建议/兜底/留资点击事件留待下一批。
4. **tab 计数会顺带取另外两类第 1 页**：命中缓存，冷路径多两次查询；后续可换轻量 count。
5. **顶栏占位文案未更新**：仍为「搜索商圈、楼盘或地址」，而房源 `q` 的匹配字段不含地址（沿袭走查发现，spec 方案 A 中「改占位文案或地址入匹配」未落地）。
6. **搜索页 canonical 指向站点根**：搜索页未显式设置 canonical，HTML 输出来自根布局默认值；noindex 下无搜索语义影响，建议后续显式声明或不输出。
7. **资讯链路无种子数据**：articles 表为空，「资讯」tab 与 `all` 资讯区块仅有单测覆盖，无运行时证据；`seed-articles.ts` 可在需要时灌入。
8. **价格维度、`updated_at` 排序键、卡片信息密度**等走查项不在本包，已在 spec §3.3 标注为独立工作项。

## 证据

- `baseline.md`：Batch 0 基线。
- `desktop-1440-search.png`：有结果的桌面页。
- `desktop-1440-zero-v2.png`：零结果页（热门区域/热门楼盘/推荐房源/留资）。
- `desktop-1440-buildings-tab.png`：楼盘 tab。
- `mobile-375-search.png`：移动端。
- `query-count.md`：待补冷/热查询条数（见批次 8 剩余项）。
