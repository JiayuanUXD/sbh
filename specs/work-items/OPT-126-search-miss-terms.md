# Task Packet：OPT-126 站内搜索未命中词采集（脱敏）

> 状态：**D1–D4 已由用户接受（2026-11-02）；P0 已在 PR #243（分支 `feat/opt-126-site-search-derived-props-222d`）；P1 已实现（分支 `feat/opt-126-search-miss-terms-4a47ab`，见 §16），保留期清理（§9）已按「请求顺带清理」实现（用户 2026-11-02 拍板）；P2 的埋点部分见 §17，别名联动未做**
> 创建日期：2026-11-02
> 来源：站内搜索能力复盘（OPT-122 遗留）+ Umami 近 30 天 `site_search` 数据
> 前置：OPT-122（站内搜索）、OPT-010（埋点白名单与脱敏）

---

## 0. 决策记录

| # | 决策 | 取向 | 状态 |
|---|---|---|---|
| D1 | 是否反转 OPT-122 §9.1「不上报 q 原文」 | **有限反转**：只采「未命中」的查询，且只存脱敏后的归一化词；其余查询仍只报长度与派生结果 | **需用户确认** |
| D2 | 存到哪里 | 自有 PG 表（Payload collection），**不进 Umami** | 推荐，待确认 |
| D3 | 存聚合还是明细 | 只存聚合（词 × 次数 × 首末次时间），不存会话 / IP / UA / 时间序列明细 | 推荐 |
| D4 | 保留期 | 只出现 1 次的词 30 天后删；出现 ≥2 次的保留 180 天 | 推荐，待确认 |
| D5 | 采集点 | 客户端 beacon + 服务端复核，不在 RSC 渲染里写库 | 推荐 |
| D6 | 谁能看 | 运营 / 管理员角色，具体按 `.agent/permissions.md` 核对 | 实施时定 |

## 1. 一句话

把「用户搜了什么却没搜到」脱敏后落库，让运营能按词频补别名、补楼盘数据、补词表；同时给 `site_search` 补几个不含文本的派生字段，在 Umami 里就能分析零结果的形态。

## 2. 现状与证据（Umami，2026-11-02 读取）

站点「商办空间」，近 30 天：访客约 3.4k，`site_search` 24 次（不到访客的 1%）。读到 20 条属性，另 4 条（第 2 页）未读。

| 观察 | 数据 | 含义 |
|---|---|---|
| 零结果 | 20 条里 4 条（20%） | 比例不低，但样本太小 |
| 零结果的查询长度 | 4 / 7 / 8 / 8 字符；长度 ≥7 的 3 条全部零结果 | 长中文串无分词，印证 OPT-122 §6.1 的已知边界 |
| 放宽 | 20 条的 `relaxed` 全为 false | 长中文串只有 1 个词项，`relax.ts` 无从放宽 |
| 单字查询 | 4289 / 16439 条结果 | 单字查询返回几乎全库，属噪音 |
| 资讯 | `result_news` 只有单字查询非零 | 资讯匹配需另查 |
| 看不到的 | 具体搜了什么 | 本方案要补的缺口 |

另有两处缺口，一并记录：

- OPT-122 §9.1 规划的 `search_suggestion_click` / `search_fallback_click` / `search_inquiry_open` **没有出现在 `events.ts` 白名单里**，Umami 30 天事件列表里也没有，即未实现。
- `listing_result_click` / `building_result_click` 的发送方是列表页视图（`CityListingsView` / `CityBuildingsView`），**不是搜索页**，所以「搜索 → 点击」的漏斗目前量不出来。

## 3. 目标与非目标

目标：

1. 两周内能回答「零结果词 Top 20 是什么、各属于哪类原因」。
2. 零结果词能被运营标记处置结果（补别名 / 数据缺口 / 超范围 / 噪音）。
3. 在 Umami 里不依赖文本也能区分零结果的形态（单词 / 多词、中文 / 拉丁、实体存在但无供给）。

非目标：

- 不做热搜榜、搜索历史、个性化（OPT-122 §7.5 的结论不变）。
- 不存会话、IP、UA、用户 ID，不做任何「谁搜了什么」的关联。
- 不改 `/search` 的匹配与排序（分词、类目意图、pg_trgm 另立项）。
- 单字查询返回全库的问题另开小改动（最少 2 字才查、或只给联想），不在本包。
- 不采「有结果」的查询原文。

## 4. 隐私边界（本方案的核心）

现行规则：`events.ts` 头部写明「不采集用户输入的自由文本」，`PII_PROP_KEY` 会拒绝含 `query` 的属性键；OPT-122 §9.1 明确「不上报 q 原文」。本包要做的是**有限**反转，所以边界必须写死：

1. **不改 Umami 白名单**，不把 `q` 放进任何 Umami 事件属性。文本只走自有端点，进自有表。
2. 只采 `missKind` 命中的查询（见 §6），有结果的查询不采文本。
3. 只存**归一化后**的词（`normalizeSearchQuery().normalized`：NFKC、小写、标点转空格），不存原始输入。
4. 脱敏函数 `sanitizeMissTerm`（纯函数，TDD）：

| 规则 | 处理 | 理由 |
|---|---|---|
| 原文含 `@`、`http`、`www.`、常见域名后缀 | 丢弃，计入 `dropped:contact` | 邮箱、网址 |
| 连续数字 ≥ 6 位（NFKC 后判，含全角）；或空格 / 连字符分段的数字合计 ≥ 8 位（`138 1234 5678`、`021-12345678`） | 丢弃，计入 `dropped:digits` | 手机号、证件号、订单号；面积 / 价格数字（如 500、3万、`100-200平`）不受影响。分段规则是实施时补的：归一化会把连字符变成空格，只判「连续」会让带分隔符的电话原样落库 |
| 归一化后长度 > 20 码点 | 丢弃，计入 `dropped:too_long` | 整句 / 粘贴内容，自由文本风险高 |
| 归一化后长度 < 2 码点 | 不采 | 单字是噪音，另行处理 |
| 空串 | 不采 | |

5. 被丢弃的只计数（按原因），不存文本，用于判断规则是否过严。
6. 2–4 字的中文串可能是人名，**无法自动识别**。缓解靠聚合与保留期：只存词频不存来源；出现 1 次的词 30 天删；后台默认只展示 ≥2 次的词；运营可对单词一键「忽略并删除」。这是剩余风险，需用户在 D1 里接受。
7. 隐私政策页同步更新，说明「为改进搜索，会统计未检索到结果的关键词，不关联个人身份」。页面位置实施时核对。

## 5. 数据模型

新 Payload collection `search-miss-terms`，admin 列表即运营界面，不做自定义 View。

| 字段 | 类型 | 说明 |
|---|---|---|
| `city` | text | 公开城市 slug，服务端校验 |
| `term` | text | 脱敏归一化词，≤20 码点 |
| `missKind` | select | `zero`（三类结果全 0）/ `entity-no-supply`（楼盘存在、在租房源 0）/ `relaxed`（放宽后才有结果） |
| `count` | number | 累计次数 |
| `firstSeenAt` / `lastSeenAt` | date | |
| `lastResultTotal` | number | 最近一次的三类结果总数（`relaxed` 时有意义） |
| `status` | select | `new` / `handled` / `ignored` |
| `resolution` | select | `alias-added` / `data-gap` / `out-of-scope` / `noise` |
| `note` | text | 运营备注 |

- 唯一键 `(city, term, missKind)`。
- 写入用一条原生 `INSERT … ON CONFLICT DO UPDATE SET count = count + 1, last_seen_at = now()`，避免 Local API 读改写的并发丢计数；需显式写 `created_at` / `updated_at`。
- 新 collection 必须走 `payload migrate:create` 并提交 `src/migrations/`，不得手改迁移正文；pre-commit 会拦「改了 collection 没带迁移」。迁移顺序注意事项见 `.agent/migrations.md`（新 collection 的 `payload_locked_documents_rels` 列须由 schema 迁移创建）。本包无数据迁移，不涉及文档锁检查问题。

## 6. 采集链路

```
/[city]/search 渲染完成
  → SearchAnalytics（客户端，已有）
  → 判定 missKind 候选，page=1 且本会话未发过同 city+q → navigator.sendBeacon
  → POST /api/search-misses { city, q }        ← 只发 q，不发客户端算的计数
  → 服务端：同源 / JSON / 体积校验 → 分布式限流
  → 校验 city 为公开城市
  → 用 normalizeSearchQuery + 页面同一组 cached 查询复核结果数（300s 缓存，重复词近乎零成本）
  → 复核确实是 zero / entity-no-supply / relaxed 才继续
  → sanitizeMissTerm → upsert
  → 返回 204
```

- **为什么不在 RSC 渲染里写库**：`/[city]/search` 是 `force-dynamic` 且走 `unstable_cache`，渲染里带副作用会被爬虫、预取放大，且缓存命中时根本不执行。
- **为什么服务端复核**：客户端传的计数可伪造，会污染待办列表；复核后端点只接受「q + city」。
- 端点照 `api/corrections/route.ts` 的模式：同源 / JSON / 体积校验、`runDistributedRateLimit` + `createPgRateLimitDeps`。**实施时同源与类型校验改用 `lib/api/request-guards.ts` 的 `isSameOriginHost` / `isStrictJsonContentType`**：corrections 自带的 `isSameOrigin` 缺 `Origin` 即放行，beacon 必带 `Origin`，没有理由沿用这个宽松口径。限流键加 `search-miss:` 前缀，与询盘配额隔离；`failOpen: true`（统计类，PG 异常时宁可少记也不拦用户，但不落库）。每 IP 每分钟建议 20 次，实施时按 `rate-limit-config.ts` 风格定。
- 失败一律静默：埋点不能影响搜索页。

## 7. Umami 侧补充（不含文本，无需迁移）

给 `site_search` 加字段（属性键避开 `PII_PROP_KEY` 的关键词）：

| 字段 | 类型 | 用途 |
|---|---|---|
| `term_count` | number | 归一化后的词项数；区分「单个长串」与「多词」 |
| `script` | string | `cjk` / `latin` / `mixed` / `digit` / `other`（假名、西里尔等）/ `none`（归一化后为空，实际不会上报）；看拼音 / 英文输入占比 |
| `entity_hit` | boolean | 楼盘存在但在租房源为 0 |
| `suggested` | boolean | 是否展示了「你是不是想找」 |

第二批（Phase 2）：补齐 OPT-122 §9.1 里未实现的 `search_suggestion_click`、`search_fallback_click`、`search_inquiry_open`，并给 `listing_result_click` / `building_result_click` 增加来源标记（如 `section='site-search'`），打通「搜索 → 点击 → 留资」。具体字段实施时与 `list-analytics.ts` 的口径一起评审。

## 8. 运营使用方式

1. admin 打开 `search-miss-terms`，默认筛 `status=new` 且 `count≥2`，按 `count` 降序。
2. 按 `missKind` 分流：
   - `zero`：判断是别名缺失 → 补 `src/domain/search/aliases.ts`（v1 仍走 PR）、楼盘没收录 → 数据缺口、超范围 → 忽略；
   - `entity-no-supply`：供给问题，不是搜索问题，转供给侧；
   - `relaxed`：放宽有效，看放宽后是否合理。
3. 处置后改 `status` 与 `resolution`。
4. 每两周看一次：零结果率、Top 词变化、`resolution` 分布，作为是否值得做分词 / pg_trgm 的依据（取代现在的 24 次样本）。

## 9. 保留与删除

- 只出现 1 次且 `lastSeenAt` 超 30 天：删除。
- `count≥2` 且 `lastSeenAt` 超 180 天：删除。
- `ignored` 且 `resolution=noise`：运营点「忽略并删除」时直接物理删除（已实现：admin 里 `search_miss:manage` 可删除）。
- 清理方式（用户 2026-11-02 拍板）：**请求顺带清理**，仿限流表——`/api/search-misses` 处理完一个请求后，每个实例每小时最多触发一次 `DELETE`（`src/lib/search-miss/prune-search-miss.ts`，状态在 `api/search-misses/prune-state.ts`）。

**为什么不是定时任务：** 仓库现有的 Payload jobs `autoRun` 全是「事件触发的队列轮询」，没有任何周期性任务（`schedule`）的先例；新造调度还要解决多实例防重。请求顺带清理改动最小，DELETE 幂等，多实例同时执行也安全（后到者删 0 行）。

实现要点：

- 保留期常量只有 `SEARCH_MISS_RETENTION_DAYS`（单次 30 天 / 重复 180 天）一处，SQL 里天数走参数；按 `last_seen_at` 计，不看 `status`（`ignored` 的词同样到期删除）。
- 节流是模块级时间戳，**先占位再删**：并发请求只有一个会执行；DELETE 失败也占用本小时窗口，不会在数据库故障期被每个请求重试。
- 被拒绝的请求（非同源 / 非法 body / 429）不触发；有结果而不入库的请求也算「处理过」，会触发。
- 清理失败只记 `search_miss_prune_failed` warn，响应仍是 204；成功执行时记 `search_miss_pruned`（含删除行数，无文本）。

已知局限：

- **没有流量就没有清理**。站内搜索页的未命中请求是常规流量，过期数据最多滞后到下一次未命中请求之后一小时；极低流量时词会略晚于 30 / 180 天消失。隐私页因此写「满 30 天后删除 / 最长保留 180 天」，没有承诺精确到天。
- 清理耦合在公开写入端点上（失败被隔离，但每小时有一次额外 DELETE 的延迟落在某个用户请求里；当前表很小，可忽略）。若以后表变大或要精确到时，再换 CloudRun 定时触发的受保护端点。
- 需要立刻清理时仍可手工跑：

```sql
DELETE FROM search_miss_terms
WHERE (count <= 1 AND last_seen_at < now() - interval '30 days')
   OR (count >= 2 AND last_seen_at < now() - interval '180 days');
```

## 10. 验收

1. 本地搜 `13812345678`、`a@b.com`、`https://x.com`、21 字以上长串：库里**无**新增，`dropped:*` 计数 +1。
2. 本地搜一个确实无结果的 2–8 字词：库里出现 1 行 `zero`，再搜一次 `count=2`。
3. 伪造请求体带假计数、对有结果的词发请求：库里不新增（服务端复核拦下）。
4. 超过限流返回 429；PG 限流表不可用时不拦用户。
5. `site_search` 在 Umami 里出现 `term_count` / `script` / `entity_hit` / `suggested`，且**没有** `q` 或任何文本属性。
6. admin 里能看到列表、能改 `status`；以运营角色与非运营角色各验一次权限。
7. 浏览器实际走一遍 `/shanghai/search` 与 admin 列表（见仓库 `CLAUDE.md`「完成前必须在浏览器里走一遍」），证据存 `artifacts/verification/OPT-126/`。

## 11. 测试策略

- 纯逻辑 TDD：`sanitizeMissTerm`（各规则的边界：5 位 vs 6 位数字、全角数字、20 vs 21 码点、emoji 码点计数、邮箱 / 网址变体）、`missKind` 判定。
- 端点：同源 / 类型 / 体积 / 限流 / 复核 / 脱敏 / upsert 的单测；upsert 的并发计数用真实 PG 集成测一次。
- 契约测试：断言 Umami 白名单里**不存在**含 `q` 的搜索事件属性（守住 D1 的边界，防以后有人顺手把文本加进 Umami）。

## 12. 分阶段

| 阶段 | 内容 | 迁移 | 价值 |
|---|---|---|---|
| P0 | `site_search` 补 4 个派生字段 + 契约测试 | 无 | 立刻能在 Umami 看零结果形态，可先单独上线 |
| P1 | collection + 迁移 + `/api/search-misses` + 脱敏 + 隐私政策更新 | 1 个 schema 迁移 | 拿到真实未命中词 |
| P2 | 补齐 OPT-122 §9.1 缺失的 3 个事件、结果点击来源标记；admin 处置流转；别名联动 | 视别名是否迁集合 | 打通漏斗与闭环 |

P0 与 P1 互相独立，可并行。P1 合并即上线（见仓库 `CLAUDE.md`「合并到 master 即上线」），迁移须先在本地对等环境跑通。

## 13. 风险

| 风险 | 处置 |
|---|---|
| 反转了既有隐私口径 | D1 由用户拍板；契约测试守边界；隐私政策同步 |
| 2–4 字人名漏过脱敏 | 只存聚合；单次词 30 天删；默认只展示 ≥2 次；一键删除 |
| 端点被刷、污染待办列表 | 同源 + 限流 + 服务端复核 |
| 搜索量太小，词频没统计意义 | 先看 4 周；量始终起不来说明入口曝光不足，是另一个问题（见 §14） |
| 新增 collection 迁移出错 | 本地先对等环境 `payload migrate`；上线前 `pnpm preflight` |

## 14. 未覆盖、需另查

- `building_search`（30 天 794 次）、`listing_search`（391 次）的属性没看过，口径未知。它们是比 `site_search` 大 30 倍的搜索信号，若其中有关键词类筛选，也应纳入同一套采集，需先读属性确认。
- 站内搜索量占访客不到 1%，入口曝光与用户习惯（靠筛选而非搜索）需要结合页面点击数据判断。
- 资讯搜索 30 天几乎无命中，需单独核对 `listPublishedArticles({ q })` 的匹配字段。

## 15. 文件地图（预期，P1 实际见 §16）

- `src/domain/search/miss-term.ts`（+ 测试）：`sanitizeMissTerm`、`classifyMissKind`
- `src/collections/SearchMissTerms.ts`、`src/migrations/<ts>_opt_126_search_miss_terms.ts`
- `src/app/(frontend)/api/search-misses/route.ts`（模式同 `api/corrections/route.ts`）
- `src/lib/rate-limit-config.ts`：新增 `SEARCH_MISS_RATE_LIMIT_CONFIG`
- `src/components/frontend/search/SearchAnalytics.tsx`：新增 beacon
- `src/lib/frontend/analytics/events.ts`：`site_search` 白名单加 4 个键
- `src/payload.config.ts`：注册 collection（改后须 `pnpm generate:types`、`pnpm payload generate:importmap`）
- 隐私政策页：文案更新（位置实施时核对）

## 16. P1 实施记录（2026-11-02）

分支 `feat/opt-126-search-miss-terms-4a47ab`，只含 P1。与 §15 预期相比的差异：

| 项 | 实际 |
|---|---|
| 纯函数 | `src/domain/search/miss-term.ts`：`sanitizeMissTerm`（返回 `keep` / `drop(原因)` / `skip(原因)`，丢弃与不采都不带文本）、`classifyMissKind`。测试 `tests/search-miss-term.test.ts` |
| 编排 | `src/lib/search-miss/record-search-miss.ts`（依赖注入，复核 → 脱敏 → upsert）、`upsert-search-miss.ts`（原生 `INSERT … ON CONFLICT`，冲突时不碰 status / resolution / note） |
| 端点 | `src/app/(frontend)/api/search-misses/route.ts`。成功与「已处理但不入库」→ 204；协议错误 403 / 413 / 415 / 400；限流 429；内部异常 500（客户端静默）。日志只有 `outcome` 枚举（`recorded` / `not_a_miss` / `unknown_city` / `dropped:*` / `skipped:*`），**`dropped:*` 的计数就是这条日志，没有单独的计数表** |
| 限流 | `SEARCH_MISS_RATE_LIMIT_CONFIG`：每 IP 每分钟 20 次，`failOpen: true`，键前缀 `search-miss:` |
| collection | `src/collections/SearchMissTerms.ts`：事实字段 `access.update = false`；`create` 对所有人关闭（只走原生 upsert）；`defaultSort: -count`；唯一索引 `(city, term, missKind)` |
| 迁移 | `20261102_090440_opt_126_search_miss_terms`（`payload migrate:create` 生成，含 `payload_locked_documents_rels.search_miss_terms_id`）+ `20261102_090441_opt_126_grant_ops_search_miss_codes`（手写数据迁移，只给 OPS 追加菜单码 / 操作码，写法同 OPT-088） |
| 权限 | 新增菜单码 `search-miss-terms`、操作码 `search_miss:manage`；ADM 通配、OPS 授予（迁移 + `src/test/factory/roles.ts` 夹具同步）；MGR / BRK / CSR 无。OPS 数据范围是全局，故不再按城市收窄 |
| 导航 | 「站点与内容」组末尾新增「未命中搜索词」叶子；同步改了 5 处既有导航快照 / 清单测试（含 e2e 的 `ALL_LEAF_LABELS`） |
| 客户端 | `SearchMissBeacon.tsx`（独立组件，`SiteSearchView` 挂一行）+ `lib/search-miss/beacon-plan.ts`（纯函数）。**客户端先用同一个 `sanitizeMissTerm` 预判**，手机号 / 邮箱这类输入根本不离开浏览器；请求体只有 `{ city, q }`。去重键存 `sessionStorage`，不可用时宁可不采。没有改 `SearchAnalytics.tsx` / `events.ts` |
| 隐私政策 | `/pages/privacy`（`src/app/(frontend)/pages/privacy/page.tsx`）。**没有升 `PRIVACY_POLICY_VERSION`**：它同时是询盘 / 委托 / 投放 / 会员 / 城市合伙人 / 小程序的同意版本校验口径，升版会让这些入口的版本比对一起变；本次改动只涉及匿名搜索统计，是否升版属法务 / 产品决定，见 PR 说明 |
| 契约测试 | `tests/search-miss-contract.test.ts`：beacon 不引用埋点管道、不并入 SearchAnalytics；隐私页文案不自相矛盾 |

验收证据在 `artifacts/verification/OPT-126/`，逐条对应 §10：

| §10 | 结果 | 证据 |
|---|---|---|
| 1 | 通过：电话 / 邮箱 / 网址 / 21 字 / 分段电话，库里无新增，日志 `dropped:*` | `curl-acceptance.txt`、`db-after-acceptance-1-3.txt` |
| 2 | 通过：无结果词入库 `zero`，再发 `count` 累加 | 同上、`beacon-requests.json` |
| 3 | 通过：伪造计数 / 有结果的词 → `not_a_miss`，不入库 | 同上 |
| 4 | 通过：第 21 次起 429 + `Retry-After`；临时下线 `inquiry_rate_limit` 表时请求 204 照常处理并告警 | `curl-ratelimit-failopen.txt` |
| 5 | **不在 P1 范围**（P0 / PR #243）。P1 侧只验证了 Umami 管道里没有查询文本：beacon 不碰埋点 | `search-miss-contract.test.ts` |
| 6 | 通过：OPS 能看列表、改状态（PATCH 抓包 + 强刷回显）、删除；BRK / CSR / MGR 与匿名 REST 403，BRK 后台菜单无入口、直达 URL 为「没有找到任何东西」；事实字段改不动 | `role-check.txt`、`admin-*.png/.txt`、`rest-access.txt` |
| 7 | 通过：`/shanghai/search` 抓包（beacon 请求体恰为 `{"city":"shanghai","q":"…"}`，同会话同词强刷 / 重进不再发，page=2 不发，有结果不发）+ admin 列表 + 强刷核对 | `beacon-requests.json`、`search-zero-result.png`、`admin-ops-list.png` |

迁移验证：本地独立库 `sbh_dev_opt126` 先在 master 状态跑完全部迁移，再跑本包两个迁移；另在全新空库跑通整条迁移链；`migrate:dry-run` 无新增告警（8 条告警均为既有迁移）；`migrate:drift` 一致；`migrate:verify` 0 fail。证据 `migrate-*.txt`。

保留期清理（§9）：已实现，见 §9，证据 `artifacts/verification/OPT-126/prune-*.txt`。

未做 / 未验证：Umami 侧四个派生字段（P0）；生产后台（需要登录态，未验）；移动端与暗色模式下的 admin 列表未专门看。

## 17. P2 实施记录（2026-11-02）

分支 `feat/opt-126-p2-search-funnel-b21f`，叠在 P0（#243）与 P1（#244）之上。

| 项 | 实际 |
|---|---|
| 新事件 | `search_suggestion_click`（`city`、`position`）、`search_fallback_click`（`city`、`block`、`position`）。**没有 `source`**：OPT-122 §9.1 设想的 pinyin / alias / typo 来源，词表解析层没有往外带，加它要动 `resolveVocabularyTerm` 的返回形状，不在本包 |
| `search_inquiry_open` | **不新增**。零结果页留资用的就是 `InquiryModal pageType="search"`，它打开时已上报 `inquiry_open`（`page_type=search`），重复造一个事件只会让两份数据对不上 |
| 结果点击来源 | 搜索结果卡沿用 `listing_result_click` / `building_result_click`，`section='search'` 标来源（`LIST_SECTIONS` 加一项，点击守卫同步放行）。`rank` 为区块内 1 基序号，`page_index` 为结果页码。无查询时的「热门」推荐不是搜索结果，不带埋点；资讯卡未覆盖 |
| 实现 | `src/domain/search/funnel-analytics.ts`（data-* 契约 + fail-closed 解析）、`SearchFunnelAnalytics.tsx`（委托监听器，仅零结果页挂）。`SearchZeroState` 仍是服务端组件；楼盘 / 房源卡用 `display: contents` 的包装层承载属性 |
| 守卫 | `tests/search-funnel-analytics.test.ts`：白名单键固定且无文本类键、夹带 `q` / `name` 被剥离、解析各种脏值整条不报、零结果页渲染带属性 |
| 验证 | `artifacts/verification/OPT-126/p2-funnel-events.txt`。兜底块与结果卡点击在浏览器里验过；**建议词点击没能在浏览器里验到**（本地数据没有会出建议的零结果词），由渲染测试覆盖 |

**admin 处置流转**：P1 已具备（`status` / `resolution` / `note` 可编辑，`ignored`+`noise` 可删），P2 不再重复。

**别名联动未做**：v1 别名在代码里（OPT-122 §10 明确不建表），「运营在 admin 标 `alias-added` 后别名自动生效」需要把别名迁成集合——是一次 schema 迁移加词表缓存失效，属于产品 / 架构决定，待用户拍板后另开工作项。目前 `alias-added` 只是运营的处置标记，别名仍须开发者改代码。

