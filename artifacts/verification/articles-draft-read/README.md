# 资讯草稿匿名可读（`/api/articles` 泄露草稿与回收站）

- 日期：2026-11-11
- 分支：`fix/articles-draft-read-leak-335224`（基于 `origin/master` = `ba078bce`）
- 来源：PR #260（资讯日期）排查时发现线上匿名能读到 8 篇未上线草稿（id 121–128）。该说法来自另一会话的报告，本次**先在本地独立复现**再动手。

## 结论

**成立，且比报告的范围更大**：匿名不仅能读草稿，还能用 `?trash=true` 读回收站（含已发布后又删掉的文章），GraphQL 同样可读；而且**任何登录的后台账号**（BRK / CSR / MGR，没有资讯菜单码）也读得到草稿与回收站。

## 根因

`src/collections/Articles.ts` 的 `access.read` 是 `() => true`，注释写「published 过滤由 facade 查询承担」。

1. **`Articles` 没有 `versions.drafts`**：`status`（draft / published）只是个普通 select 字段，Payload 不会替我们拦草稿，拦不拦完全取决于 `access.read`。
2. 那句注释只对 C 端成立：C 端走 Local API（`overrideAccess` 默认 true），查询层自己带 `status = published` 且 `deletedAt` 不存在（`supply-adapter.ts` 五处）。但 Payload 自带的 **REST / GraphQL 不经过 facade**，于是 `read: () => true` 等于对所有人开放全部状态。
3. `trash: true` 的集合在 `?trash=true` 时会撤掉 Payload 自己默认加的 `deletedAt` 过滤，所以回收站也一起开了。

Listings / Buildings 已在 OPT-104 收口过同一个模式，Articles 是漏网的。

## 修复

`Articles.access.read` → `createArticleReadAccess(canManageArticle)`（`src/domain/public-catalog/article-read-access.ts`）：

| 身份 | 读 |
| --- | --- |
| 匿名、会员、停用账号、**没有资讯菜单码的后台账号**（MGR/BRK/CSR） | Where：`status = published` 且 `deletedAt` 不存在 |
| 持资讯菜单码的后台账号（ADM、OPS、资讯日更专用账号） | `true`（全读，含草稿与回收站） |

读侧与写侧（`create/update/delete`）用**同一道门** `canManageArticle`。

## 逐个核对消费方（改之前）

| 消费方 | 怎么读 | 结论 |
| --- | --- | --- |
| C 端 `/news`、详情、首页资讯区、`[city]/search`、商圈落地页相关资讯、sitemap | `supply-adapter.ts` 的 `payload.find`（Local API，`overrideAccess` 默认 true，自带 published + 未删除） | 不经 access，**零影响**（浏览器实测见下） |
| 后台列表 / 编辑 / 回收站 | 登录态 REST，用户持 `articles` 菜单码 | 放行（浏览器实测见下） |
| 后台预览 | `payload.config.ts` 的 `livePreview` 只覆盖 `listings`、`buildings` | **无资讯预览**，不涉及 |
| 后台导航角标 | `navigation-badges.ts` 只统计 tasks / listings / leads 等 | 不含资讯 |
| 钩子 `syncHomeFeaturedExclusivity` | `req.payload.update`，不带 `overrideAccess: false` | 不受影响（既有单测） |
| 小程序 | 只走 `/api/mini/v1/*`，源码里没有资讯 / `/api/articles` | 不涉及 |
| **日更流水线 `news:publish`** | `scripts/lib/news-publish.ts`：`findArticleBySlug` **匿名读** `/api/articles?trash=true` 判断 slug 占用、读回刚建的草稿 | **会被新规则打到**：匿名看不到草稿与回收站 → 占用检查漏判、草稿读回失败。**已改**：占用检查与读回都带专用账号 token（见下） |
| `scripts/clean-chooffice-articles.ts --plan` | 匿名读 `${source}/api/articles`（OPT-100 一次性清洗，已执行过） | 改后 `--plan` 只看得到已发布且未删除的文章；**刻意没改**（已完成的一次性脚本，`--execute` 走 Local API 不受影响） |
| 其它分支 | `git grep` 全部远端分支：没有新增的 REST `/api/articles` 调用方 | — |

## 日更流水线的改动

- `findArticleBySlug(…, token?)`、`preparePublish({…, token?})`、`executePublish({…, token?})`：带 token 才查得全（含草稿与回收站）。
- `PublishPlan.slugCheck: 'all' | 'published-only'` 如实记录占用检查的范围。
- `scripts/news/publish.ts`：真发布时**先登录一次**，用同一个 token 做占用检查和发布；`--dry-run` 仍不登录（保持原有「不登录、不写」承诺），所以只覆盖已发布文章，输出里写明。
- `scripts/news/README.md`：写明专用账号的「资讯中心」菜单码同时是读草稿的凭据，别减掉。
- **上线注意**：生产的日更专用账号按 OPT-124 约定本就只有「资讯中心 + 素材库」两个菜单码，满足新规则；若它的角色被改过，需要确认仍含 `articles` 菜单码。

## 复现（改前）与实测（改后）

环境：隔离库 `sbh_dev_artleak`（克隆自 `sbh_dev_geo`，已补跑迁移）、端口 3741、`pnpm dev`（非生产模式；`.env.production*` 不存在）。账号是 `scripts/seed.ts` 的公开夹具。

脚本：`probe.sh`（请求层矩阵，改前改后共用）。输出：`before.txt`（改前）、`after.txt`（改后）。

**改前**（`before.txt`）：匿名与 BRK/CSR/MGR 都能——
- `GET /api/articles` 列表含草稿正文；
- `where[status][equals]=draft` 枚举出全部草稿；
- 按 slug、按 id 读草稿正文；
- `?trash=true` 读到回收站里的文章；`/api/articles/<回收站 id>?trash=true` 200。

`before.txt` 不含 GraphQL 段（那段探针是改后补的）。改前的 GraphQL 泄露由真库测试在**未修复代码**上变红证明，当时的实际响应：
`{"data":{"Articles":{"docs":[{"id":13,"slug":"zz-readacc-draft-…","status":"draft"}]}}}`。

**改后**（`after.txt`）：

| 身份 | 列表 / where=draft / slug / `trash=true` / `draft=true` | 草稿 id | 已发布 id | 回收站 id（`trash=true`） |
| --- | --- | --- | --- | --- |
| 匿名、BRK、CSR、MGR | 都不含草稿与回收站正文 | **404** | 200 带正文 | **404** |
| OPS、ADM | 草稿、已发布、回收站都读得到 | 200 | 200 | 200 |
| GraphQL 匿名 | 列表只有已发布；`where status=draft` 为空；`Article(id: 草稿)` 无正文 | | | |
| GraphQL OPS | 全读 | | | |

**日更流水线端到端**（`pipeline-e2e.ts` → `pipeline-e2e-result.txt`，10 项全 ✔）：匿名按 slug 查草稿查不到；带 token 查得到；已存在草稿被「只新建不覆盖」拦下；专用账号新建草稿并带 token 读回验收通过、同一篇草稿匿名按 id 读 404；新建已发布文章并通过前台详情页验收、匿名仍读得到；不传 token 的 `executePublish` 仍自行登录（向后兼容）。

> 未做：真实 `pnpm news:publish` CLI 整条命令。它前置的内容检查（`numbers.json` 格式、站内链接 200）在只有 5 篇种子资讯的本地库里过不了，与本次改动无关；CLI 入口 `publish.ts` 只改了「先登录、带 token」的几行，经 typecheck / lint 与上面的库函数端到端覆盖，**入口本身没有真跑过**。

## 浏览器走查（内置浏览器，本地 3741）

本地库里造一篇草稿「浏览器走查草稿不应对外」和一篇已发布「浏览器走查已发布应对外」（夹具 `browser-fixture.sh`，走完已清理，库回到 5 篇）。

| 页面 | 结果 |
| --- | --- |
| `/news` | 6 篇（5 种子 + 已发布走查文），**不含草稿**（`screenshots/c-end-news-list-draft-hidden.jpg`） |
| `/news/zz-browser-pub` | 200，标题与正文都在（`screenshots/c-end-news-detail-published.jpg`） |
| `/news/zz-browser-draft` | **404** |
| 首页 | 含已发布走查文标题，不含草稿 |
| `/shanghai/search?q=浏览器走查` | 命中已发布，不含草稿 |
| `/sitemaps/static.xml` | 7 个 `/news` 相关 URL（`/news` + 6 篇已发布），不含草稿 |
| 后台（OPS 登录）`/admin/collections/articles` | 7 行，**草稿（状态「草稿」）与已发布都在**（`screenshots/admin-ops-articles-list-draft-visible.jpg`） |
| 后台草稿编辑页、改标题保存 | 抓包：`PATCH /api/articles/53?depth=0&fallback-locale=null`，请求体含 `title` / `status` / `content` 等全字段，**200**；后续 `POST /api/articles/access/53` 200。强刷后标题回显「（二次编辑）」，库里同值（`screenshots/admin-ops-draft-edit.jpg`） |
| 后台垃圾箱 `/admin/collections/articles/trash` | 正常打开（当时没有回收站文章，空态） |

控制台的 500 是本地 `media/` 目录为空、封面图 `GET /api/media/file/…` 失败（直接请求不存在的文件也是 500），外加预览代理下 HMR WebSocket 报错；服务端 `preview_logs` 无错误。与资讯接口无关，master 上同样存在。

## 自动化测试与变异验证

| 层 | 文件 | 验什么 |
| --- | --- | --- |
| access 函数 | `tests/articles-read-access.test.ts`（10 例） | 匿名 / 会员 / 停用账号 / MGR·BRK·CSR → Where；ADM / OPS / 资讯日更专用账号 → `true`；每次返回新对象 |
| Payload REST / GraphQL 处理器（真实 PG） | `tests/articles-read-access-postgres.test.ts`（13 例） | 把 `Request` 直接交给 `REST_GET(config)` / `GRAPHQL_POST(config)`：匿名列表、`where` 枚举、按 slug、按 id、`trash=true`、`draft=true`、GraphQL；后台角色分档；已发布读取不变 |
| 流水线 | `tests/news-publish.test.ts`（新增 3 例、改 2 例） | 假后端遵守新规则；占用检查与读回带 JWT；`slugCheck` 范围；token 复用 |

**变异验证**（`mutation-check.sh` → `mutation-results.txt`）：基线 23/23 绿；六个变异全部变红，还原后与变异前**逐字节一致**，复跑 23/23 绿。

| 变异 | 结果 |
| --- | --- |
| M1 还原成原 bug `read: () => true` | 红（17 例） |
| M2 Where 去掉 `deletedAt`（`?trash=true` 能读回收站） | 红（11 例，含真库 trash 用例） |
| M3 Where 去掉 `status` | 红（17 例） |
| M4 放宽成「任何登录账号全读」 | 红（8 例：BRK/CSR/MGR） |
| M5 收得太死：ADM / OPS 也被收窄 | 红（5 例：后台读不到草稿） |
| M6 返回共享对象 | 红（1 例） |

其余闸门（该 worktree 的 `node_modules` 缺 `qrcode`，先 `pnpm install --frozen-lockfile` 同步依赖，否则 typecheck 会报与本次无关的 `Cannot find module 'qrcode'`）：`pnpm typecheck` 0 错；`pnpm lint` 0 error（37 条既有 warning，本次改动文件无）；全量 `pnpm test` 527 文件 / 7120 例全绿；`media-delete-cache-postgres` 等相关真库用例绿。

## 没验证到的

- **生产**：没有读过线上。合并上线后线上匿名 `GET /api/articles` 是否已不含草稿 121–128，需要在取得授权后做一次只读复核（匿名 `curl` 即可，不需要登录）。
- **CI 的 `postgres-migrations` 作业**会首次跑 `articles-read-access-postgres.test.ts`（本地已对隔离库跑绿；CI 库经 migrate + seed，夹具账号同样存在）。
- 真实 `pnpm news:publish` CLI 整条命令（见上）。

## 顺带发现、未处理

1. **`Pages` 同类问题**：`Pages.access.read` 也是 `() => true`，且有 `status`（draft / published）与 `trash: true`，匿名同样可枚举草稿页与回收站页。线上只有 1 个页面，影响小，但同一模式，值得照本次做法收口。
2. **可见性判据仍是多份**：`supply-adapter.ts` 五处查询各自写着 `status = published` + `deletedAt` 不存在，与本次的 `getPublishedArticleWhere()` 是第六份。没合并是因为 `supply-adapter.ts` 是多分支都在改的热文件；单独做更稳。
