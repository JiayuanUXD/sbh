# Task Packet：OPT-070 房源/楼盘图集与媒体工作台的 media 外键死结

> 状态：**已修复**
> 创建日期：2026-09-05
> 来源：58b4c43（OPT-060 封面覆盖同款死结）交付说明里点名的三处遗留隐患
> 编号说明：本项**让号一次**——初编 OPT-069，与在建分支
> `feat/opt-069-media-watermark-ce5e` 上的 `OPT-069-media-watermark` 撞号，顺延至 070。
> 教训同 OPT-058 / OPT-061：开工前不仅查 `specs/work-items/`（当前 master 只到 068），
> 还要 `git branch -a` 查在建分支上的未合入编号（066 / 067 / 069 都已被占）。
> 验证记录：`../../artifacts/verification/OPT-070/`

---

## 1. 一句话

`listings_gallery.image_id`、`listings_media_items.resource_id`、
`buildings_media_items.resource_id` 三列同时是 `NOT NULL` 和 `ON DELETE SET NULL`，
互斥；删除被它们引用的 media 时 PG 撞 23502，运营只看到「Something went wrong.」。

## 2. 根因（不在本仓库）

`@payloadcms/drizzle@3.86` 的 `dist/schema/traverseFields.js`（约 749 行）对**每一个**
单值 relationship / upload 列写死 `reference: { onDelete: 'set null' }`，同时只要
`field.required` 就给列加 `notNull`。「required 的 upload 字段」必然生成这对自相矛盾
的约束，且没有任何配置开关能改 `onDelete`。

同一个死结此前出现过三次：房源硬删（`20260819_113218`）、楼盘硬删（OPT-050）、
单城「按类型浏览」封面覆盖（58b4c43 / OPT-060）。

## 3. 事实核查（2026-09-05 本地 `postgres` 库实测）

按 `pg_constraint` 扫全部指向 `media` 的外键，`attnotnull=true` 且 `confdeltype='n'`
的恰好只有这三列：

```
DEADLOCK buildings_media_items.resource_id   notnull=true ondel=n
DEADLOCK listings_gallery.image_id           notnull=true ondel=n
DEADLOCK listings_media_items.resource_id    notnull=true ondel=n
```

其余 14 个指向 media 的外键列都可空（`listings.cover_image_id`、`pages.hero_image_id`、
`site_settings.logo_id` 等），SET NULL 对它们就是正确语义。

**任务描述里「有效供给 §6 要求 gallery ≥ 3，级联删行可能让房源静默跌出有效供给」
这条顾虑不成立。** `.agent/supply.md` §6 与 `domain/review/effective-supply.ts:42-48`
都写着：媒体数量 2026-08-19 起**不再是**前台可见性条件，无图房源照常曝光并走缺省图
降级。`MIN_SUBMIT_MEDIA` 只剩「提交审核」一道门，且是提交那一刻算的、不是持续判定。
所以删图不会让任何已上架房源静默消失，最坏是「以后再提交审核得先补图」——可见且可修。

其它事实：

- `buildings_gallery.image_id` **本来就可空**，它是 `listings_gallery.image_id` 的
  结构双胞胎（都 hidden、都由 `mediaItems` 派生），房源侧多的 `required` 属历史不一致。
- `syncListingMedia` 派生 gallery 时已 `.filter(m => m.resource)`，C 端
  `mappers.ts:1043-1052` 也逐行丢弃映射不出的图——**空值在读侧已经安全**。
- 但 `galleryCount` 三处都是裸 `.length`（`review-transition.ts:161`、
  `listing-review-queue-row.ts:54`、`ListingCompletenessCardClient.tsx:94`），
  **不过滤空值**。这一条直接决定了口径怎么选，见下。
- 三张死结表的 `_order` 索引都不是唯一索引，删行留空档无害。
- 本地库 38 条房源中 36 条是「只有 legacy gallery、没有 mediaItems」的形态，
  测试必须覆盖这一支。

## 4. 口径：钩子摘除（2026-09-05 用户拍板）

`20260819_113218` 确立的三分口径是「审计表脱钩保留 / 纯关系行由钩子删除 /
有业务含义的引用拦住不删」。这三列属于第二类：`mediaItems` 行去掉 `resource`
之后，`kind`/`category`/`alt` 描述的是空气；`gallery` 行本身就只有一个 `image`。

因此：**Media 加 `beforeDelete` 钩子，删 media 之前先删掉引用它的数组子表行**，
让 PG 的 SET NULL 无行可置。

### 4.1 不放宽 NOT NULL

沿用 OPT-050 面对同一岔路口时的原话——「**不放宽 NOT NULL**——那只会留下一堆
无意义关系行」（`domain/supply/building-delete-cleanup.ts` 头注释）。

保持 NOT NULL 还保住一条真实不变量：`galleryCount` 三处都是裸 `.length`，
只要 `image_id` 非空，行数就等于真实图片数。一旦放宽，2 张真图会被算成 3 张，
「提交审核至少 3 张」那道门被静默放松。

**推论：本工作项不改 schema，因此没有迁移。**

`buildings_gallery.image_id` 的可空/非空不一致**本次不动**：改 listings 侧成可空会
引入上面的计数缺陷，改 buildings 侧成非空是范围外的收紧。只在注释里留痕。

### 4.2 摘除范围：4 张子表

| 表 | 为什么 |
|---|---|
| `listings_media_items` | 死结列 |
| `listings_gallery` | 死结列；且它由 mediaItems 派生，必须同进退 |
| `buildings_media_items` | 死结列 |
| `buildings_gallery` | 非死结列，但由 `buildings.mediaItems` 派生；只删 media_items 不删它，两者会不一致并留下 `image IS NULL` 空行 |

**不碰标量列**（`listings.cover_image_id` / `buildings.cover_image_id` /
`pages.hero_image_id` / `site_settings.logo_id` …）：它们可空，SET NULL 就是正确语义
——字段置空、文档还在、前台走缺省图降级。这是现在已经在跑的行为，不改。

### 4.3 机制：事务内裸 SQL，不走 `payload.update`

`payload.update()` 会拖进整条房源写入流水线，其中 `adminAutoPublish`
（`domain/review/admin-auto-publish-hook.ts:41-73`）是明确的污染源：管理员删一张图，
会顺带把某条完整度达标的草稿房源推到「已发布」，并写一条 `decision=fast_track`
审核记录，把「谁把它直接放上线的」记在删图的人头上。**删一张图不该改任何房源的
发布状态。**

改走 `payload.db.sessions[transactionID].db` 的事务内 drizzle，沿用
`domain/city-partner-application/public-service.ts:117` 的 `transactionExecutor`
与 `domain/geography/location-counts.ts` 的 `Queryable` 抽象——裸 SQL 在本仓库是
既有模式。**必须在事务内**：否则 media 删除失败时子表行已经没了。

### 4.4 缓存失效

改完之后删被引用的图会**从 500 变成成功**，于是首次出现「C 端缓存里还挂着已删图片
URL」的窗口（`lib/frontend/cached-queries.ts` 的 `revalidate: 300`）。这个窗口是本次
改动造出来的，不是既有缺陷，所以 `afterDelete` 里对受影响城市调一次
`invalidateSupplyPublicCache`，复用 `domain/public-catalog/supply-cache-hook.ts`
现成的城市反查。

### 4.5 `scripts/seed-media.ts`

删掉 `deleteAllMedia` 里的手工解引用（含已过时的注释「`listings_gallery.image_id`
为 NOT NULL…」）。它正是这次事故的原型：一份要人肉跟着新表更新的清单，OPT-060
加表时没跟上就断在那儿。钩子接管后它是纯冗余。

## 5. 测试

新增 `tests/media-delete-listing-building-postgres.test.ts`（真库；mock 碰不到 DB 约束，
同 `building-delete-postgres.test.ts` 与 `media-delete-type-card-override-postgres.test.ts`
的理由）。**先写红再接钩子**，否则测不出是不是真在测死结。

1. 被 `listings.mediaItems` + 派生 gallery 引用 → 删除成功，两张子表对应行都没了，房源还在；
2. 只被 legacy `listings.gallery` 引用（无 mediaItems）→ 同上；
3. 被 `buildings.mediaItems` 引用 → 删除成功，派生的 `buildings_gallery` 行一并清掉；
4. 同一房源的其它图不受影响，`_order` 留空档后仍能按序读出；
5. 事务性：media 删除失败时子表行不消失。

## 6. 完成判据

- 上述真库测试改前红、改后绿；
- `pnpm typecheck` 干净、`pnpm test` 全绿（带 `DATABASE_URL`，真库用例不被跳过）；
- `pnpm seed:media` 跑通；
- **浏览器实测**：后台删除一张被房源图集引用的图片，返回 200，房源仍在且少一张图。
