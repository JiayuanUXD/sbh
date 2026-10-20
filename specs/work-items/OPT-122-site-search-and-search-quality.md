# Task Packet：OPT-122 站内搜索（一框搜全站 · 分类结果 · 模糊匹配 · 零结果兜底）

> 状态：**设计已确认，待实施**。本文档在 `docs/opt-122-site-search-a7c3` 分支上；实施另开 `feat/opt-122-site-search-*` 的 worktree，未经确认不提交、不合并。
> 创建日期：2026-10-19
> 来源：2026-10-19 搜索结果页走查 + 四轮设计讨论。
> 用户已拍板：①一框搜全站；②结果按类型分类；③模糊做 L1 归一化/分词 + L2 拼音/别名；④「查看全部」留在搜索结果页内分页。

---

## 0. 决策记录

| # | 决策 | 结论 | 放弃的方案与原因 |
|---|---|---|---|
| D1 | 搜索页归属 | 独立 `/[city]/search`，**不进主导航** | 挂在 `/listings`：结果一旦跨实体，页面身份、筛选语义、canonical、埋点全部错位 |
| D2 | 结果形态 | `all` 分区 + `tab` 分类；tab 内分页 | 把楼盘/资讯塞进房源列表；混合列表统一打分（跨实体排序无法公平） |
| D3 | 模糊等级 | L1 归一化/分词 + L2 拼音/别名 | 只做 L0 子串（用户已明确不够）；L3 pg_trgm（TencentDB 扩展权限待确认，不阻塞） |
| D4 | 深结果 | 留在 `/search` tab 内分页（用户拍板） | 跳 `/listings?q=`（会把搜索拆成两套体验） |
| D5 | 零结果 | 纠错 → 实体 → 替代 → 留资 | 个性化「猜你喜欢」：站内没有行为画像，收藏也已关闭，只能靠编 |
| D6 | 索引 | 不复用 `plugin-search` 的 `search` 集合 | 该集合 staff-only、字段只有 `title`、不含资讯，访问控制不适合公开检索 |
| D7 | 词表存储 | v1 代码内 JSON + 运行时拼音缓存，零迁移 | 直接建 `search-terms` 集合：别名量未知，先用 PR 管理，稳定后再迁 |

---

## 1. 一句话

把现在作为 `/listings` 一个筛选维度的 `q`，升级成独立的站内搜索：`/[city]/search` 一框输入，房源 / 楼盘 / 资讯分类展示、分类内分页；支持 L1 归一化/分词与 L2 拼音/别名；零结果按「纠错 → 实体 → 替代 → 留资」四层兜底；页面不进导航、不索引。

---

## 2. 线上现状（2026-10-19，代码核实）

### 2.1 搜索链路

| 项 | 现状 | 位置 |
|---|---|---|
| 入口 | `HeaderSearch` / `HomeSearchPill` 提交到 `/listings?q=` | `lib/frontend/search-submit.ts`、`HeaderSearch.tsx:83` |
| 结果实体 | **只有房源**，没有楼盘、没有资讯 | `CityListingsView` |
| `q` 匹配字段 | `l.title` / `b.name` / `dist.name` / `ba.name` / `metro.name`；**地址不参与** | `listing-query-sql.ts:45` |
| 解析 | 只 trim + 100 字截断，无归一化、无分词 | `search-params.ts:246` |
| 排序 | 精选 → `updated_at`，命中位置不影响顺序 | `listing-query-sql.ts:82` |
| 楼盘检索 | `/buildings` 没有 `q` | `building-search.ts` |
| 资讯检索 | 没有 | — |
| 拼音 | `pinyin-pro` 已是依赖，但只用于生成 slug | `domain/shared/slug.ts` |
| 别名 | Buildings / Listings 没有 aliases 字段 | `collections/Buildings.ts` |
| 容错 | 无 pg_trgm、无编辑距离 | `src/migrations/` 无扩展 |
| 索引集合 | `plugin-search` 已建 listings + buildings 的 `search` 集合，但 staff-only、前台零引用、可搜索字段只有 `title` | `payload.config.ts:547` |
| 零结果 | `q` 是收窄维度 → `EmptyFiltered`「取消关键词」，没有实体出口 | `CityListingsView.tsx:255` |
| SEO | `/listings?q=` 自 canonical、标题不随 q 变、可索引 | `metadata.ts:148` |
| 卡片 | 不显示楼盘名；`floor/seats/decorationStatus/availableFrom` 在 DTO 里但未展示 | `listing-display.ts:48`、`contracts.ts:230` |

### 2.2 直接的后果

- 搜楼盘名只能得到「楼里的房源」；楼里没有有效供给时返回 0，用户会以为站里没这个楼。
- 搜「静安 整层」这种多词组合必然 0 结果（整串匹配）。
- 拼音、首字母、别名、错字全部搜不到。
- 搜索框承诺「商圈、楼盘或地址」，但地址不在匹配字段里。
- 搜索结果页被索引，且所有 q 共用同一个 title/description。

---

## 3. 目标与非目标

### 3.1 目标

- 一个输入框覆盖房源、楼盘、资讯三类公开内容，结果按类型分类，分类内可独立分页。
- L1 + L2 模糊：多词、全半角、标点、拼音、首字母、别名可命中。
- 零结果不再是一条死路：先纠错/放宽，再给实体出口，最后给可解释的替代内容与留资入口。
- 搜索页可观测：零结果率、放宽率、分类点击、兜底块点击、留资率。
- 不污染现有列表页的 SEO：搜索页与其 q 变体不索引。

### 3.2 非目标

- L3 容错（pg_trgm）与语义搜索。
- 外部搜索引擎（Meilisearch / Algolia / Typesense）。
- 个性化推荐、搜索历史、热搜榜（等 `site_search` 有数据后再谈）。
- 价格归一化、地图找房、收藏（收藏已于 2026-09-19 按产品决定关闭）。
- 小程序搜索页同步（`sbh-miniprogram/pages/listings` 结构不同，另行立项）。

### 3.3 关联优化清单（走查提出，分批处理）

| 优化项 | 来源 | 处置 |
|---|---|---|
| 关键词相关性排序 | 2026-10-19 走查 | **本包**（`/search`），列表页的 `q` 排序随后对齐 |
| `/listings?q=` 变体 noindex | 走查 | **本包** |
| 结果数变化 `aria-live` 播报 | 走查 | **本包** |
| 「最新」排序用 `updated_at`，被供给同步刷新 | 走查 | 独立工作项（影响全站列表，需字段/迁移） |
| 价格维度在页面上不可达（OPT-103 取舍） | 走查 | 独立工作项（产品口径） |
| 卡片补楼盘名 + 决策标签 | 走查 | 独立 UX 项；本包复用现有卡片，不改卡片结构 |
| `availableBefore` 有链路无控件 | 走查 | 独立工作项（列表页） |
| 价格/面积筛选桶无计数 | 走查 | 独立工作项（facet SQL） |
| facet 与列表两段串行、4 个变体重复聚合 | 走查 | 独立性能项 |

---

## 4. IA、路由与 URL 状态

### 4.1 路由

- 主路由：`src/app/(frontend)/[city]/search/page.tsx`（`export const dynamic = 'force-dynamic'`）。
- 兼容路由：`src/app/(frontend)/search/page.tsx`，无城市前缀时按默认城市 307 到 `/[city]/search`，保留 `q` / `tab` / `page`。
- 城市未开通：与列表页一致，渲染 `ComingSoonCityView` 或 404，不查库。
- 静态段 `search` 优先于 `[city]/[...rest]` 的 catch-all，不需要额外兜底。

### 4.2 URL 状态

| URL | 含义 | 索引 |
|---|---|---|
| `/[city]/search?q=陆家嘴` | `all`：三类各取 top N | `noindex, follow` |
| `?q=…&tab=listings` | 房源全量结果第 1 页 | `noindex, follow` |
| `?q=…&tab=listings&page=2` | 房源第 2 页 | `noindex, follow` |
| `?q=…&tab=buildings&page=2` | 楼盘第 2 页 | `noindex, follow` |
| `?q=…&tab=news&page=2` | 资讯第 2 页 | `noindex, follow` |
| `/search?q=…` | 兼容入口 → 307 | — |
| `/listings?q=…` | 保留：高级筛选 / 老链接 | `noindex, follow`（本包新增） |

规则：

- `tab` 白名单 `all|listings|buildings|news`，缺省/非法 → `all`。
- `page` 只在 tab 内生效；`all` 忽略 `page`（进入 `all` 时从 URL 删除 `page`）。
- 切 tab 重置 `page`；改 `q` 重置 `tab=all` 与 `page`。
- `q` 为空：渲染搜索引导页（热门区域 / 热门楼盘 / 推荐房源），不发查询、不 404。
- `q` 上限 100 字；单字查询照常执行，但结果区先给「补充一个字会更准」的建议，不阻断。
- 城市切换保留 `q` / `tab` / `page`：`city-routes.ts` 新增 `search` 页面类型，并把 `tab` / `page` 加进白名单。

### 4.3 入口行为

- 顶栏 `HeaderSearch`：提交 → `/[city]/search?q=`（**不再**去 `/listings`）。在 `/search` 上提交只改 `q` 并回到 `all`。
- 首页 `HomeSearchPill`：
  - 只填关键词 → `/search`；
  - 带了区域 / 类型 / 面积 → 仍去 `/listings`（有筛选就是房源意图，不把筛选参数带进搜索页）。
- 结果页自己的输入框：回填 `q`，提交行为与顶栏一致。
- 结果卡点击后，浏览器返回应回到原来的 tab + page（URL 已是事实源，无需额外状态）。

### 4.4 导航

- `/search` 不进主导航，不高亮任何导航项（现有 `isCurrent` 天然匹配不到）。
- 面包屑：`首页 / 搜索`；有 `q` 时页面 h1 用「搜索」+ 结果计数，不把 `q` 拼进 title。

---

## 5. 结果分组、取数与排序

### 5.1 分组

| 类型 | `all` 展示 | 独立 tab | 每页 |
|---|---|---|---|
| 房源 | top 8 | 是，24/页 | 复用 `getCachedSearchListings`（传入 `q`、`pageSize: 8`） |
| 楼盘 | top 4 | 是，12/页 | 新增 q 支持的 `buildBuildingPageQuery` |
| 资讯 | top 3 | 是，10/页 | 新增 q 查询（标题 + 摘要） |

- `all` 顺序：**房源 → 楼盘 → 资讯**；若 `q` 精确命中某个楼盘名，在三个区块之前插一张「楼盘直达卡」。
- 某类型命中为 0 时，`all` 不渲染该区块（不出现空标题）；tab 仍显示 `0`，点进去展示该类型的零结果态。
- 每个区块标题右侧给「查看全部 N 条 →」；N 是该类型总命中数，N=0 时不渲染链接。
- tab 标签显示计数：`全部 / 房源 128 / 楼盘 6 / 资讯 3`。计数为 0 的 tab 保留（显示 0）。

正常结果页的骨架：

```
[搜索框，回填 q]
[全部] [房源 128] [楼盘 6] [资讯 3]        ← 链接，aria-current
—— 房源 ——                             查看全部 128 条 →
[8 张房源卡，移动端只露 4 张]
—— 楼盘 ——                             查看全部 6 个 →
[4 张楼盘卡]
—— 资讯 ——                             查看全部 3 条 →
[3 条资讯行]
```

### 5.2 取数原则

- 只走**公开有效供给**查询，复用 `getCachedSearchListings` / 楼盘分页 / 资讯查询的既有公开谓词，不新写一套 where。
- 房源 `all` 区块只水合 8 张卡，不要为了 8 个位置水合 24 张：调用时 `pageSize: 8`；`tab=listings` 才用 24。
- 移动端 `all` 的房源区块只露前 4 张（CSS 截断），避免首屏被单一类型占满；「查看全部」仍去 tab。
- 三类计数与当前 tab 的页数据在同一个 `Promise.all` 里取；不要先算计数再发页查询。
- 空结果分支的兜底内容（热门区域 / 热门楼盘 / 推荐房源）按**城市**缓存，与 `q` 无关。

### 5.3 排序

- **房源**：相关性优先，其次精选 / 更新时间。相关性用字段权重 + 命中形态：
  - 标题完全等于 q：100；标题前缀：80；标题包含：60；
  - 楼盘名完全等于 / 前缀 / 包含：90 / 70 / 50；
  - 行政区 / 商圈 / 地铁名：40 / 35 / 30；
  - 多词命中数优先，其次字段权重；同分按 `is_featured DESC, updated_at DESC, id ASC`。
- **楼盘**：名称完全等于 / 前缀 / 包含：100 / 80 / 60；同分按在租套数降序、`recommended_order` 升序。
- **资讯**：标题命中 > 摘要命中；同分按 `publishedAt DESC`。
- 跨实体不做统一分数。`all` 的分区顺序固定，避免「谁该排第一」的争议。

### 5.4 相关性排序的落点

- 新增 SQL 片段（`CASE WHEN … THEN …`）产出 `match_score`，只用于 `/search` 的查询，不改 `/listings` 的默认排序（列表页的排序改造见 §3.3 独立项）。
- 现有 `ILIKE '%q%'` 继续用；`match_score` 只决定顺序，不改变命中集合。
- 多词查询在 SQL 里对每个词分别算分再求和；词数上限 8。

---

## 6. 模糊搜索：L1 + L2

### 6.1 L1 归一化与分词

处理顺序（纯函数，先写测试）：

1. `NFKC` 归一：全角转半角、兼容字符归一。
2. `trim` + 连续空白折叠。
3. ASCII 转小写；CJK 保持原样。
4. 去掉标点（保留 CJK、字母、数字、空格）。
5. 按空白切词；ASCII 词独立成项；不含空白的 CJK 串整体成项（v1 不做中文分词）。
6. 词项上限 8，单项上限 50 字；空项丢弃。
7. SQL 通配符转义：`\` `%` `_` 一律转义，用户输入不再当通配符。

匹配语义：

- 默认 **AND**（所有词项都要命中）；
- AND 为 0 时降级 **OR**，按「命中词数 → 字段权重」排序；
- 页面上必须标注「已放宽：忽略『整层』」之类的说明，不能把放宽结果伪装成精确命中。

### 6.2 L2 词表与查询扩展

词表来源（全部是公开可见实体）：

- 楼盘：`name` + 别名 + 全拼 + 首字母；
- 行政区 / 商圈 / 地铁站：同上；
- 城市：`name` + 别名 + 拼音。

词表数据源需要新增一条**轻量查询**：按城市返回 `id / slug / name / type / 关联区域`，覆盖全部公开楼盘与地点。不要复用 `findEffectiveBuildings`（默认 `limit 200`，会漏掉第 200 名之后的真实楼盘），也不要复用楼盘分页查询（只返回当前页）。地铁站词表当前前台没有现成查询，需从 `locations` 表按城市补一条。

v1 存储：

- 实体名与拼音由**新增的轻量词表查询**生成，按城市 memo，5 分钟或缓存 tag 失效；
- 拼音用 `pinyin-pro` 在**服务端**生成一次并缓存，不在每次请求里重算；
- 别名放 `src/domain/search/aliases.ts`（JSON 常量，PR 评审），不建表、不迁移；
- 别名量稳定后再迁到 Payload 集合（届时用 `payload migrate:create`，不手改迁移）。

查询扩展：

1. 词项是 ASCII：按「别名全等 → 全拼全等 → 首字母全等 → 全拼/首字母前缀」解析成实体；
2. 命中实体后，用实体的中文名 + 关联 ID 去搜房源（插在现有 `resolveBuildingIdsByKeyword` 的位置）；
3. 词项是中文：直接匹配实体名/别名，同时保留原词匹配标题；
4. 一个拼音命中多个实体（如 `changning` → 长宁 / 常宁）：按当前城市、在租套数排序，页面上给「你是不是想找」消歧，**不静默跨城**。

词表一次建成，服务四件事：输入联想、拼音扩展、did-you-mean、零结果实体探测。不要建四套。

### 6.3 多音字与数据质量

- 地名白名单人工校对：长宁、银行、重庆、厦门、蚌埠等；
- `pinyin-pro` 的 `pattern` / `surname` 选项按需使用；
- 词表构建脚本输出「疑似多音字」清单，进验收证据；不追求 100% 自动。

### 6.4 L3（暂缓）

- `pg_trgm` + GIN 索引只在确认 TencentDB 允许 `CREATE EXTENSION` 后做；
- 中文 2–3 字短查询的 trigram 区分度低，L3 主要补拉丁输入与错字；
- L3 不阻塞 L1/L2 上线。

---

## 7. 零结果兜底

### 7.1 四类零结果

| 类型 | 例子 | 正确动作 |
|---|---|---|
| 打错 / 拼音没对上 | 陆家咀、lujiazui | did-you-mean / 拼音改写 |
| 词太窄 | 静安 整层 500 平 | 放宽（去尾词 / OR） |
| 实体存在但无供给 | 上海中心（0 套在租） | 实体卡 + 同区域替代，不是通用零结果 |
| 完全没线索 | 乱码、外地城市 | 策展替代 + 需求捕获 |

### 7.2 决策树（服务端一次跑完）

```
精确（AND）
  ├─ 有结果 → 正常结果
  └─ 无 → 放宽（去尾词 / OR 打分，最多一层）
        ├─ 有结果 → 结果 + 「已放宽」提示
        └─ 无 → 实体探测（楼盘 / 商圈 / 地铁 / 行政区 / 其他城市）
              ├─ 命中 → 实体卡 + 同区域替代
              └─ 未命中 → did-you-mean（词表 + 拼音 + 相似度）
                    ├─ 有候选 → 建议页
                    └─ 无 → 策展零结果页（热门 + 留资）
```

约束：

- 放宽只做一层；不允许把「陆家嘴」放宽成「陆」。
- 放宽/改写必须在页面上说明，不能静默替换。
- 位置词不跨城放宽；其他城市命中时给城市切换建议，不直接返回外地房源。

### 7.3 全局零结果页结构

```
没有找到「陆家咀」相关的内容
你是不是想找：陆家嘴 · 上海中心 · 静安寺        ← 最多 3 个

[实体卡] 上海中心 · 陆家嘴 · 甲级 · 暂无在租房源  → 查看楼盘
[热门区域] 静安 128 套 · 浦东 96 套 · 徐汇 64 套 …
[热门楼盘] 4 个，带在租套数
[热门房源] 4 个（用 recommended，不写「最新」）

[提交找房需求]   [委托找房 / 服务电话]
```

- 浏览块最多 3 个；有实体卡时，实体卡替代「热门楼盘」。
- 每块必须写明「热门 / 推荐」，不能混进结果里冒充命中。
- 移动端最多 2 块，CTA 固定可见。
- 留资复用 `InquiryModal`（`pageType="search"`），不新造表单。

### 7.4 分类型零结果

- 房源 0、楼盘 > 0：房源 tab 展示楼盘结果 + 「该楼盘暂无在租房源」；`all` 正常出楼盘。
- 楼盘 0、房源 > 0：只提示「楼盘暂无结果」，不触发全局零结果。
- 资讯 0：一句话 + 「看最新资讯」。
- 只有全类型 0 才进全局零结果页。

### 7.5 明确不做

- 不做「猜你喜欢」（没有用户画像）；
- 不做搜索历史；
- 不把热门房源伪装成搜索结果；
- 不在零结果页堆超过 3 个内容块。

---

## 8. SEO

- `/search` 及其所有变体：`robots: { index: false, follow: true }`，不进 sitemap，canonical 不指向列表页。
- `/listings?q=`：保留页面能力，但 `q` 存在时 `noindex, follow`（本包顺带修掉「搜索词进索引」）。
- 页面 title 不拼 `q`；`generateMetadata` 只输出「搜索 · {城市}」与通用描述，避免搜索词进索引标题。
- 兼容 `/search` 用 307 到城市前缀；多城开关关闭时仍 noindex。
- 单地点筛选收敛到区域落地页（OPT-119）的规则不动。

---

## 9. 埋点与指标

### 9.1 事件

| 事件 | 触发 | 字段 |
|---|---|---|
| `site_search` | 搜索结果渲染（按 `q + tab` 去重） | `city`、`q_length`、`tab`、`page`、`result_total`、`result_listings`、`result_buildings`、`result_news`、`zero_result`、`relaxed` |
| `search_suggestion_click` | 点「你是不是想找」 | `position`、`source`（pinyin/alias/typo） |
| `search_fallback_click` | 点兜底块 | `block`（entity/district/building/listing）、`position` |
| `search_inquiry_open` | 零结果页打开留资 | `block` |

- **不上报 `q` 原文**；只报长度与派生结果。理由同 `ListSearchAnalytics`：搜索词属用户输入，不进埋点。
- 去重键：`event + city + normalized_q_hash + tab`（hash 只用于去重，不进属性）。

### 9.2 指标

- 零结果率 = zero_result / site_search；
- 放宽救援率 = relaxed 且有结果 / 精确零结果；
- did-you-mean 点击率；
- 兜底块点击率（分区）；
- 零结果页留资率；
- 结果点击率与改词率（同会话内再次搜索）。

先量两周再调权重；没有基线前不做「热搜榜」。

---

## 10. 缓存与性能

- 三类查询各自 `unstable_cache`，键含 `city + 归一化 q + tab + page`，`revalidate: 300`，挂现有列表 / 楼盘 / 资讯 tag。
- 当前 tab 的 `total` 与该页数据同条返回，避免「先 count 再查页」两次往返；另外两类的计数走轻量 count。
- 词表按城市 memo，5 分钟或 tag 失效；拼音只在构建词表时算一次。
- 兜底内容按城市缓存（热门区域 / 热门楼盘 / 推荐房源），不按 q 缓存。
- `all` 的房源区块 `pageSize: 8`，不要水合 24 张卡；移动端只渲染前 4 张。
- 冷启动查询预算：`all` = 3 条分类查询（各自同时返回本类 `total`）+ 词表（首次）；`tab` = 1 条当前页查询 + 2 条另外两类的轻量 count（若无 `all` 缓存可复用）。不需要为当前 tab 再单独 count。
- 不新增表、不新增迁移（v1 别名在代码里）。

---

## 11. 可访问性

- 搜索框：可见 label 或 `aria-label`，`role="search"`，Enter 提交；移动端 44px 触控目标。
- tab 用**链接**而不是 ARIA tablist（每个 tab 是独立 URL，可分享、可后退）：`<nav aria-label="搜索结果类型">` + `aria-current="page"`。这样不需要实现方向键漫游，也不会把服务端页面伪装成客户端 tab。
- 结果计数用 `aria-live="polite"` 播报「找到 N 条结果」；筛选/翻页后读屏用户能感知变化。
- 「你是不是想找」「热门区域」用列表 + 链接，不用纯 div 点击。
- 零结果页 h1 与各区块 h2 层级完整；图片卡片 alt 沿用现有规则。
- `prefers-reduced-motion` 下所有过渡关闭（沿用 `list.css` 的既有规则）。

---

## 12. 安全与权限

- 只调用公开目录查询；**不**把 staff-only 的 `search` 集合暴露给前台。
- `q` 长度 ≤ 100、词项 ≤ 8、`page` ≤ 10000、`tab` 白名单；所有值参数化，通配符转义。
- 除了 URL（用户可见、可分享）之外，不把 `q` 原文写进日志或埋点。
- 反射 `q` 只用 React 文本节点，不用 `dangerouslySetInnerHTML`。
- 搜索页无用户态数据，不需要登录；留资走现有权限与校验。

---

## 13. 数据与接口（建议文件范围）

新增：

- `src/domain/search/normalize.ts`：NFKC、切词、通配符转义；
- `src/domain/search/vocabulary.ts`：词表类型、按城市构建、拼音/首字母缓存；
- `src/domain/search/aliases.ts`：人工别名（v1 JSON）；
- `src/domain/search/expand.ts`：拼音/别名 → 实体扩展；
- `src/domain/search/rank.ts`：字段权重与命中形态打分；
- `src/domain/search/relax.ts`：放宽策略（去尾词 / OR）；
- `src/domain/search/zero-state.ts`：四类零结果判定；
- `src/domain/search/types.ts`：`SiteSearchInput`、`SiteSearchResult`、`SiteSearchCounts`。

查询层：

- `src/lib/frontend/cached-queries.ts`：`getCachedSiteSearchListings`、`getCachedSiteSearchBuildings`、`getCachedSiteSearchArticles`、`getCachedSiteSearchCounts`、`getCachedSearchFallback`；
- `src/domain/public-catalog/listing-query-sql.ts`：`match_score` 片段（仅 `/search` 使用）；
- `src/domain/public-catalog/building-search.ts` + `building-query-sql.ts`：`q` 字段与 SQL；
- 资讯查询：新增标题/摘要的 `contains` 查询与缓存。

页面 / 组件：

- `src/app/(frontend)/[city]/search/page.tsx`；
- `src/app/(frontend)/search/page.tsx`（兼容跳转）；
- `src/components/frontend/search/SiteSearchView.tsx`、`SearchTabs.tsx`、`SearchZeroState.tsx`、`SearchSuggestionList.tsx`（Phase 3）；
- 样式：`src/app/(frontend)/styles/search.css`（沿用 token，不新建颜色）。

改动既有：

- `src/lib/frontend/search-submit.ts`：新增 `buildSiteSearchHref`，保留 `buildListingSearchHref` 给首页带筛选的场景；
- `HeaderSearch.tsx`、`HomeSearchPill.tsx`：提交分流；
- `src/lib/frontend/city-routes.ts`：新增 `search` 页面类型，保留 `q` / `tab` / `page`；
- `src/lib/frontend/metadata.ts` 或搜索路由的 `generateMetadata`：noindex；
- `src/lib/frontend/analytics.ts`：`site_search` 等事件类型；
- `/listings` 的 `generateMetadata`：`q` 存在时 noindex。

不新增数据库表、不手写迁移。若后续把别名迁到集合，另开工作项并用 `payload migrate:create`。

---

## 14. 分阶段实施

| 阶段 | 内容 | 上线条件 |
|---|---|---|
| Phase 1 | `/[city]/search` 路由、三类查询、`all` 分区、tab 分页、计数、noindex、`site_search`、零结果 v1（实体 + 热门 + 留资）。实体探测先用现有 `resolveBuildingIdsByKeyword` 的中文名匹配，拼音/别名在 Phase 3 扩展 | `typecheck` / `lint` / `test` 全绿；桌面 + 375 验收 |
| Phase 2 | L1 归一化/分词/AND-OR/通配符转义 + 放宽提示 | 纯函数单测先红后绿；放宽只一层 |
| Phase 3 | L2 词表、拼音/首字母、别名、`did-you-mean`、输入联想 | 多音字清单验收；歧义不跨城 |
| Phase 4 | L3 pg_trgm（若扩展可用）、类目词理解（整层/共享办公 → 筛选）、热搜 | 单独评估 |

首发范围 = Phase 1 + 2 + 3（用户已确认 L1+L2）。Phase 4 不阻塞。

---

## 15. 测试策略

- **纯函数 TDD**：归一化、切词、转义、打分、放宽、零结果分类、拼音/别名解析、多音字。先写失败用例，再实现。
- **SQL / 真库**：`q` + 公开谓词 + 分页 + 计数；与内存路径同口径；`%`/`_`/反斜杠输入不改变语义。
- **路由 / metadata**：`/search`、兼容跳转、非法 tab/page、未开通城市、noindex。
- **E2E**：顶栏与首页两个入口、tab 切换、分页、三类零结果、实体探测、移动端 375、键盘操作、`aria-live`。
- **视觉**：1440 / 375 截图；无横向滚动；空态块不超过 3 个；reduced-motion。
- **性能**：冷/热缓存下的查询条数与耗时；`all` 不水合 24 张卡。
- **安全**：超长 q、通配符、HTML 片段、越界 page。

---

## 16. 验收

- [ ] `/[city]/search?q=陆家嘴` 返回三个区块，tab 计数与实际条数一致。
- [ ] 切 tab 重置页码；改 q 回到 `all`；`all` 忽略 page。
- [ ] 精确命中一个「零在租房源」的楼盘时，出现实体卡而不是全局零结果。
- [ ] `lujiazui` / `shzx` / `IFC` 能解析到对应楼盘或商圈（词表覆盖范围内）。
- [ ] 「静安 整层」不再必然 0：放宽后给结果并标注忽略词。
- [ ] 全局零结果页 ≤ 3 个内容块，留资入口可用。
- [ ] `/search` 与 `/listings?q=` 均 `noindex, follow`。
- [ ] `site_search` 事件含三类计数、零结果、放宽标记，不含 q 原文。
- [ ] 桌面 1440 / 移动 375 截图；键盘可完成搜索、切 tab、翻页；结果数有 aria-live。
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` 通过。
- [ ] 证据存 `artifacts/verification/OPT-122/`。

---

## 17. 风险与开放问题

| 风险 | 影响 | 处置 |
|---|---|---|
| TencentDB 不允许 `CREATE EXTENSION pg_trgm` | L3 做不了 | L1/L2 不依赖它；先确认权限再立项 |
| 拼音多音字 | 解析到错误实体 | 地名白名单 + 疑似清单人工校对 |
| 别名靠 PR 维护 | 运营不能自助 | 量稳定后迁 Payload 集合，走迁移 |
| 中文无分词 | 长句仍可能零结果 | v1 靠空格/词表；L3 或词典后续 |
| q 缓存基数大 | 缓存命中率低 | 归一化后入 key；TTL 300s；只缓存 ≤50 字 |
| 「最新」排序被同步刷新 | 兜底块文案失真 | 兜底用「推荐/热门」，不写「最新」 |
| 与 `/listings` 逻辑重复 | 两套口径漂移 | 复用 `getCachedSearchListings` 与同一 SQL，不复制筛选 |
| 跨城搜索 | 用户搜外地楼盘 | 城市作用域 + 城市切换建议，不静默跨城 |
| 小程序不一致 | 两端体验不同 | 明确非目标，另行立项 |

---

## 18. 文件地图（预期）

```
src/app/(frontend)/[city]/search/page.tsx        新增
src/app/(frontend)/search/page.tsx               新增（兼容跳转）
src/components/frontend/search/SiteSearchView.tsx 新增
src/components/frontend/search/SearchTabs.tsx     新增
src/components/frontend/search/SearchZeroState.tsx 新增
src/domain/search/*.ts                            新增
src/lib/frontend/cached-queries.ts                改动
src/lib/frontend/search-submit.ts                 改动
src/lib/frontend/city-routes.ts                   改动
src/lib/frontend/metadata.ts                      改动（或路由内 noindex）
src/components/frontend/HeaderSearch.tsx          改动
src/components/frontend/home/HomeSearchPill.tsx   改动
src/domain/public-catalog/listing-query-sql.ts    改动（match_score）
src/domain/public-catalog/building-search.ts      改动（q）
src/domain/public-catalog/building-query-sql.ts   改动（q）
src/app/(frontend)/styles/search.css              新增
tests/search/*.test.ts                            新增
tests/e2e/search.spec.ts                          新增
artifacts/verification/OPT-122/                   证据
```

---

## 19. 证据

实施完成后存放：

- `artifacts/verification/OPT-122/baseline.md`：上线前零结果率、搜索量、q 样本分布（脱敏）；
- `desktop-1440-*.png` / `mobile-375-*.png`：三类结果、tab、零结果、实体卡；
- `metadata.txt`：`curl` 的 robots / canonical / title；
- `query-count.md`：冷/热缓存的查询条数与耗时；
- `a11y.md`：键盘路径、aria-live、对比度；
- `pinyin-audit.md`：多音字疑似清单与人工校对结果。
