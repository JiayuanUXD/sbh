# 资讯不显示日期：根因、修复与验证（2026-11-11）

## 结论

**不是展示层、DTO 或格式化的问题，是数据缺发布时间，而写入边界没有任何约束。**

- 展示层、`mapArticleCard` / `mapArticleDetail`、`formatPublishedDate` 都正常：本地给了日期就处处显示。
- 线上 8 篇已发布资讯（id 111–116、119、120）的 `publishedAt` 是 `NULL`：首页对缺失显示「—」，`/news` 卡片与详情页按「缺失不渲染」整块不出，所以用户看到的是「资讯没有日期」。
- 缺失的来历：资讯的规范路径是「导入脚本默认写草稿 → 运营在后台把状态改成已发布」（`scripts/import-articles.ts` 文件头写明）。草稿阶段 frontmatter 不带发布时间，而 `Articles.publishedAt` 是可选字段、无默认值、无 hook，**改成「已发布」这一步没有任何东西给它写时间**。线上这 8 篇的 `updated_at` 都晚于 `created_at`（相隔几分钟到 4 天不等），说明建好之后又在后台改过，和这条路径吻合（但库里没有「谁在何时点了发布」的记录，这只是与数据相符的推断，不是直接证据）。
- 同一缺陷还有一个副作用：PostgreSQL 的 `ORDER BY published_at DESC` 把 NULL 排在**最前**，所以线上 `/news` 第一页前 8 张就是无日期的，首页「最新」也被它们占满。
- **还没发布的 8 篇草稿（id 121–128，北外滩线路系列）会重演同样的事**，所以光补历史数据不够，必须在写入边界堵上。

线上现状用 `prod-undated-articles.py`（只读 GET 公开页面与公开 REST，不碰库）核对，输出见该脚本头注释所述；2026-11-11 的结果：已发布且缺发布时间 8 篇、草稿 8 篇；`/news` 第 1 页 12 张卡片里前 8 张无日期、后 4 张是 `2026.10.21`。

## 修复

| 层 | 改动 |
|---|---|
| 写入边界 | 新增 `src/collections/article-published-at.ts`：纯规则 `resolveArticlePublishedAt` + `beforeChange` hook `ensureArticlePublishedAt`，挂在 `Articles.hooks.beforeChange` 上 |
| 后台提示 | 「发布日期」字段加 `admin.description`（说明留空会自动填、已发布不能清空） |

规则（只在「发布」这一刻盖章，**绝不编造编辑时间**）：

1. 本次写入后状态不是 `published`：不动（草稿不盖章）。
2. 已有可解析的发布时间（提交的或库里原有的）：不动，运营指定的日期不被覆盖。
3. 已发布文章被清空日期，且库里原有可解析的值：恢复原值。
4. 「变成已发布」（新建即已发布，或状态由非 published 改成 published）且没有任何日期：盖当前时刻。
5. **历史上已发布却没日期的老文章，这次只是无关编辑（改摘要、切主推、进回收站）：不动。** 补历史数据走单独的、需确认的回填，不靠 hook 顺手把编辑时间当成发布时间。

没有改展示层：缺失时首页「—」、卡片与详情页不渲染，仍是仓库既有口径（不得编造、不得用请求时刻顶替）。

## 前后对照（本地，隔离克隆库 `sbh_dev_newsdate`，端口 3741）

修复前，用 Local API 在未修复代码上复现三条路径（探针脚本已删除，同一场景现由 PG 测试常驻守着）：

| 路径 | 修复前 `publishedAt` |
|---|---|
| 草稿 → 改成已发布（只传 status） | `null` |
| 直接以已发布创建、不带日期 | `null` |
| 带日期的已发布文章被清空日期 | `null` |

修复前前台三处（DOM 读取）：首页无日期行显示「—」；`/news` 卡片无日期节点；详情页无日期节点；且无日期的 3 篇排在 `/news` 最前。

修复后，**在后台界面真实点一遍**（`e2e-adm@example.com` 公开夹具账号）：新建草稿 → 状态改为「已发布」，**不填发布日期** → 保存：

1. 抓包（请求体）：`PATCH /api/articles/63`，`status:"published"`、`publishedAt:null`；创建草稿的 `POST` 请求体里则压根没有 `publishedAt` 键——两种形态规则都覆盖。
2. 响应：`PATCH` 200，响应 `publishedAt = 2026-11-11T06:07:04.240Z`；草稿创建 `POST` 201，`publishedAt = null`、`status = draft`。
3. 强刷重载：表单回显 `2026-11-11 14:07`（Asia/Shanghai）；库里 `published_at = 2026-11-11 14:07:04.24+08`。
4. 之后只改关联区域（无关编辑）：`publishedAt` 仍是 `06:07:04.240Z`，没有被重新盖章。

这一篇在前台**六处**都显示 `2026.11.11`（SSR DOM 读取 + 截图）：首页资讯列表、`/news` 卡片、`/news/<slug>`（含 `<time datetime="2026-11-11T06:07:04.240Z">`，375 宽度截图确认）、站内搜索卡片 `/search?q=…`、区域落地页「静安区相关资讯」卡片 `/shanghai/area/jingan`（截图，日期节点可见、非隐藏）；保存后缓存自动失效，无需重启。`/news` 在 375 下 `scrollWidth = 375`，无横向溢出。

## 测试与变异验证

| 文件 | 内容 |
|---|---|
| `tests/article-published-at.test.ts`（15 例） | 规则表 + hook 行为 + **hook 确实挂在 `Articles.hooks.beforeChange`** |
| `tests/articles-published-at-postgres.test.ts`（6 例，`pnpm test:postgres`，无库自动跳过） | 真实 Payload + PG：草稿→发布、直接发布、显式日期保留、清空恢复、老文章无关编辑不盖章、草稿不盖章 |

先红后绿：在未修复代码上 PG 套件 3 红 2 绿（红的正是线上出过事的三条路径），修复后全绿。

变异验证（故意改坏 → 确认变红 → 还原，还原后 `diff` 与原版一致）：

| 变异 | 单测 | PG |
|---|---|---|
| M1 hook 从 `beforeChange` 摘掉 | 红（挂载断言） | 红 3 |
| M2 「变成已发布」时不再盖章 | 红 6 | 红 2 |
| M3 去掉 `becomesPublished` 判断（老文章无关编辑也盖成编辑时刻） | 红 1 | 红 1（补了老文章用例之后） |
| M4 去掉「清空 → 恢复原值」 | 红 1 | 红 1 |

M3 最初只有纯规则层拦得住，于是补了 PG 用例，让这条红线在 Payload 真实调用形态下也有守卫。

其余闸门：`pnpm typecheck` 退出 0；`pnpm lint` 0 error（37 条 warning 都在未触碰的文件）；`pnpm test` 527 文件 / 7122 例全绿（不含 PG 套件，那部分上面单独跑过）。`pnpm migrate:drift` 退出 0 且 `src/migrations/` 无新文件（真跑 `migrate:create` 判定这份 config 不产生新迁移）：本改动只加 hook 和后台说明文案，**不涉及表结构，没有迁移**。未跑 `pnpm build`、E2E、`migrate:dry-run`（未改迁移与 DOM 结构）。

注意：pre-commit 的「改了 collection 必须带迁移」是纯路径匹配（暂存了 `src/collections/` 下任何文件就拦），本次提交会命中它，只能靠逃生舱 `SKIP_MIGRATION_CHECK=1` 放行；依据就是上面的 `migrate:drift`。

## 补数方案（**口径已选 A（2026-11-11 用户确认）；尚未执行，生产一概没碰**）

`backfill-published-at.sql`：预检 → 单事务执行 → 回滚。已在克隆库演练：`UPDATE 3`，再跑 `UPDATE 0`（幂等），前台三处出现日期且排序恢复正常。

要补的 8 篇（2026-11-11 公开 REST 读到的 `createdAt` / `updatedAt`，UTC）与口径 A 的结果（上海时区日期与 UTC 日期一致）：

| id | slug | createdAt | updatedAt | 口径 A 显示 |
|---|---|---|---|---|
| 111 | lujiazui-office-rent-guide-shanghai | 10-23 10:53 | 10-23 10:58 | 2026.10.23 |
| 112 | xujiahui-office-rent-guide-shanghai | 10-24 02:32 | 10-26 03:31 | 2026.10.24 |
| 113 | nanjingxi-road-vs-huaihai-road-guide | 10-26 02:38 | 10-26 03:31 | 2026.10.26 |
| 114 | qiantan-office-rent-guide-shanghai | 10-27 02:53 | 10-31 05:11 | 2026.10.27 |
| 115 | hongqiao-lingang-vs-station-guide | 10-28 02:58 | 10-31 05:11 | 2026.10.28 |
| 116 | zhangjiang-office-guide-shanghai | 10-29 07:01 | 10-31 05:10 | 2026.10.29 |
| 119 | westbund-office-guide-shanghai | 10-30 02:35 | 10-31 05:10 | 2026.10.30 |
| 120 | beiwaitan-office-guide-shanghai | 10-31 03:26 | 10-31 05:10 | 2026.10.31 |

三种口径（**用户选了 A**，B、C 留作备忘）：

- **A（推荐）`published_at = created_at`**：一天一篇，日期各不相同，和日更节奏一致。代价是它是「写稿日」，不是点发布的那一刻；若 114–120 真是 10-31 批量上架，口径 A 显示的日期会比实际早 0–4 天（114 最多，120 为 0）。
- **B `published_at = updated_at`**：更接近点发布的时刻，但 114–116、119、120 五篇 `updated_at` 都落在 10-31 05:10:40–05:11:11（UTC，31 秒内，疑似批量改状态），会全显示 2026.10.31，且 `updated_at` 不保证就是上架动作。
- **C 运营在后台逐篇手填**：最准，走 hook 与缓存失效，8 篇各点一次。

裸 SQL 不触发 Payload 缓存失效，前台最长 5 分钟后反映。回滚用第 2 步 `RETURNING` 出的 id 清单，不要用条件批量回滚。

### 执行步骤（由有生产写权限的人做；执行语句已收紧到只动这 8 个 id）

1. 预检（只读，SQL 文件第 1 段）：应当恰好命中 id 111、112、113、114、115、116、119、120。若还有别的「已发布无日期」文章，**停下来**，它们的创建日不代表发布日，要单独定口径，不要一起补。
2. 执行第 2 段（`BEGIN … UPDATE … RETURNING … COMMIT`）：返回须恰好 8 行，`published_at` 依次为 2026-10-23 / 24 / 26 / 27 / 28 / 29 / 30 / 31（上海时区）；不是 8 行就 `ROLLBACK`。
3. 5 分钟后复核（只读）：`python3 artifacts/verification/news-published-at/prod-undated-articles.py` 应显示「已发布且缺发布时间：0 篇」，`/news` 第 1 页不再有「无日期」卡片，顺序按日期倒序。
4. 配套：`fix/news-date-display-fc8239`（`cf74600a`）合并上线后，草稿 121–128 上架才会自动盖章；合并到 master 会触发自动部署，这件事和补数互不依赖，先后均可。
5. 想改成逐篇手填（口径 C），在后台改「发布日期」即可，走 hook 与缓存失效，不必跑 SQL。

执行用的 SQL 在克隆库用 `BEGIN … ROLLBACK` 验证过语法，并确认在没有这 8 个 id 的库里是 0 行；收紧前的宽条件版本（无 id 限定）在克隆库真实执行过一次（`UPDATE 3`，再跑 `UPDATE 0`）。

## 没在本次处理、但值得跟进

1. **公开 REST 能读到草稿**：`Articles.access.read = () => true`（注释称「published 过滤由 facade 承担」），所以 `/api/articles` 对匿名返回草稿正文（线上能读到 8 篇未上线草稿）。这和日期无关，但是内容泄露面，建议单独处理。
2. **NULL 排最前**：`-publishedAt` 排序在 PG 里 NULL 在前。有了 hook 与回填后不再有 NULL，故没改查询；若不回填，无日期文章会继续占据 `/news` 与首页最前。
3. **8 篇草稿上架时的日期**：它们 `createdAt` 在 11-02 至 11-11 之间。修复后上架会自动盖「点发布的那一刻」；若想显示各自的写稿日，上架前在后台手填「发布日期」，不要一次批量发布。
4. 卡片与详情页对缺失日期是「不渲染」，首页是「—」，两种写法并存（仓库规则允许两者，未统一）。

## 验证环境说明

- 在隔离 worktree `news-date-fc8239`、独立端口 3741、从 `sbh_dev_geo` 克隆的 `sbh_dev_newsdate` 库上做的（克隆后补跑了落后的 4 个迁移，否则 `update` 会因缺列 `42703`）。没有碰共用的 `sbh_dev_geo`（探针第一次误写的一条草稿已清掉）、没有读 `.env.production.local`、没有用生产模式起服务。
- 新 worktree 没有本地 `media/` 目录，封面图 500、卡片走占位图——与本改动无关，页面本身 200。
