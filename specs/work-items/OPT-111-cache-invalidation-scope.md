# Task Packet：OPT-111 收窄公开目录缓存失效范围

> 状态：**已实施，待合并**（D1 / D2 已于 2026-10-14 获用户确认；线上复测待合并后补）
> 创建日期：2026-10-14
> 来源：外部性能审计 P0-1「缓存几乎总是冷的」，2026-10-14 逐条对照 master `c339d62` 核实后，用户裁定从本项开始
>
> **For agentic workers:** 按 Task 顺序执行，每个 Task 自带测试闭环；步骤用 `- [ ]` 勾选。

**目标：** 一次房源 / 楼盘保存只清掉**真正受影响城市**的公开缓存，内部字段或草稿的保存不清缓存，采集发布一整轮只清一次。

**做法：** 供给缓存条目不再挂 `SITEMAP_TAG`（失效集合仍照发，站点地图聚合条目照收）；Listings / Buildings 的失效 hook 前面加一个纯函数判定「这次写入能不能影响公开页面」；采集发布从「每段有发布就清」改成「整个阶段结束清一次」。

**技术栈：** Next 16 `unstable_cache` + `revalidateTag`、Payload 3.86 collection hook、Vitest。

---

## 1. 现状与证据（2026-10-14，master `c339d62`）

| # | 事实 | 证据 |
|---|---|---|
| E1 | **每个**供给缓存条目都挂 `SITEMAP_TAG` | `payload-office-platform/src/lib/frontend/cached-queries.ts:117-133`（`listingCacheTags` / `buildingCacheTags`，所有供给条目经它们取 tag） |
| E2 | 每次供给失效都**发送** `SITEMAP_TAG` | `src/domain/public-catalog/cache-tags.ts:134-144`（`cityLevelSafeInvalidationTags`） |
| E3 | 由 E1+E2：**保存任意一城的一条房源，全站所有城市的供给缓存一起硬过期**，资讯与内容页缓存也连带过期（它们同样挂 `SITEMAP_TAG`，`cached-queries.ts:618-647`） | 推论；Task 1 的测试把它钉成可执行事实 |
| E4 | 失效 hook 不看上架状态、不看改了什么字段：草稿保存、只改内部字段也清 | `src/domain/public-catalog/supply-cache-hook.ts:173-191`；挂载 `src/collections/Listings.ts:322,325`、`src/collections/Buildings.ts:230,238` |
| E5 | 采集发布每段（≤100 条、20s 预算）只要发布了一条就按**全城市类目兜底**清一次；5.7 万条 ≈ 570 次 | `src/domain/supply-sync/source-sync-publish.ts:256`（传 `[]` → 类目级兜底），由后台 `SourceSyncViewClient.tsx` 逐段循环调用 |
| E6 | Next 16 嵌套 `unstable_cache` **不会**把内层 tag 传给外层条目 | `next/dist/server/web/spec-extension/unstable-cache.js`：`case 'unstable-cache': isNestedUnstableCache = true; break;`（只有 prerender 分支累积 tag） |
| E7 | 站点地图清单 / 出售存在性两条聚合条目**只**挂 `SITEMAP_TAG`，内部调用分片查询 | `src/app/(frontend)/_lib/sitemap-shards.ts:59,70` |
| E8 | 公开供给查询不读城市站点配置（`serviceStatus` 等），城市可见性在页面层判断 | `rg serviceStatus src/domain/public-catalog src/lib/frontend/cached-queries.ts` 零命中 |
| E9 | 公开可见的前置条件：房源 `publicationStatus === 'published'`，楼盘 `status === 'published'` | `src/domain/review/effective-supply.ts:10,92`、`src/domain/public-catalog/effective-supply-sql.ts:22`、`src/domain/supply/public-building.ts:65-74` |
| E10 | `updatedAt` 参与公开排序（「最近维护」过渡口径、首页精选） | `src/domain/public-catalog/stable-sort.ts:18,61`、`listing-scan.ts:198`、`supply-adapter.ts:237` |

**为什么 E6/E7 决定了做法：** 站点地图清单条目只认 `SITEMAP_TAG`，所以供给失效**必须继续发送** `SITEMAP_TAG`，否则新上架房源进不了站点地图。要拆掉的是「把它挂在非站点地图条目上」这一侧。

---

## 2. 范围

### 做

1. **Task 1** 去掉非站点地图条目上的 `SITEMAP_TAG`：供给、资讯、内容页三类。
2. **Task 2** 供给失效 hook 前加「公开相关性」判定：保存前后都不可能公开的跳过；只改内部字段的跳过；判断不了一律失效（fail-safe）。
3. **Task 3** 采集发布改成阶段结束清一次。
4. **Task 4** 本地生产构建上做前后对照，上线后用运行日志复测。

### 不做（各有归属，别顺手扩）

- 失效改为 stale-while-revalidate：`IMMEDIATE_CACHE_EXPIRE_PROFILE` 的硬过期是「下架后不得再被看到」的正确性要求（`cache-tags.ts` 注释与 `tests/public-cache-immediate-expiry.test.ts`），本项不碰。
- 跨实例失效 / 共享缓存（Redis）：`OPT-042`，仍待裁定。本项不让它变差：失效面缩小只影响「本来就会被清」的条目。
- 启动预热、TTL 调整、P0-2 查询代价、详情页高德阻塞：各自另开工作项。
- 按 listingId 精确失效：`unstable_cache` 只能静态声明 tag（见 `public-cache-revalidation.ts` 中 `invalidateCityLevelSupplyCache` 的注释），城市级粒度保持不变。

### 待你确认的两个行为变化（我的建议都是「接受」）

- **D1** 只改内部字段（见 Task 2 的名单）的保存不再清缓存。连带结果：该房源按 `updatedAt` 排序的位置要等 TTL（≤300s）后才前移（E10）。按 `.agent/core.md`「不以 `updated_at` 代替业务时间」，「改内部备注就把房源顶上去」本身就不该是对外语义。
- **D2** 采集发布进行中，新发布的房源最长 300s 后才出现在前台（靠 TTL），阶段结束时统一刷新。中途停止的，同样由 TTL 兜底。新增可见性晚到是良性的；「下架必须立即不可见」不受影响，回滚端点仍立即失效。

---

## 3. 全局约束

- 失效档位保持 `IMMEDIATE_CACHE_EXPIRE_PROFILE`（`{ expire: 0 }`），不得改为 `'max'`。
- 所有失效集合**继续包含** `SITEMAP_TAG`：既有 `tests/supply-public-cache-hook.test.ts`、`tests/fp-06-content-seo-cache-acceptance.test.ts`、`tests/media-delete-cache-invalidation.test.ts` 中的 `toContain(SITEMAP_TAG)` 断言保持不变。
- 拿不准时失效：判定函数遇到缺字段、形状不认识、比较不出结果，一律返回「要失效」。
- 不改表结构，不加迁移，不动 collection 字段定义（只动 hook 内部逻辑）。
- 改到既有测试时，只能改成表达**真实的公开变化**的夹具；不得删用例、不得跳过（`.agent/core.md`）。

## 4. 评审重点（测试不容易覆盖、最可能咬人的输入）

1. **软删（`deletedAt` 置值）而状态仍是 `published`**：必须失效。判定只看「前后任一可能公开」，与 `deletedAt` 无关。→ Task 2 测试 `soft-delete`。
2. **换楼盘 / 换城市**：`building` 字段变化属于公开字段，新旧两城都要失效。既有 `collectCitySlugs` 已处理，不得因新判定短路。→ Task 2 测试 `building-change`。
3. **关系字段一侧是 id、另一侧是展开对象**（hook 拿到的 `doc` / `previousDoc` 深度不一致）：深比较判为「变了」→ 失效（安全方向）。→ Task 2 测试 `populated-vs-id`。
4. **批量 `payload.update({ where })`**（商户停用连带下架 `handleMerchantStopBatchListings`）：逐条走 hook，`published → unpublished` 每条都失效。→ 由 Task 2 的状态迁移用例覆盖，不另写。
5. **有人日后把内部字段做成公开展示**，而忘了从名单里删：Task 2 的源码契约测试在公开代码目录里扫到该字段名即红。

---

## Task 1：`SITEMAP_TAG` 只挂在站点地图聚合条目上

**Files:**
- Modify: `payload-office-platform/src/lib/frontend/cached-queries.ts:117-133`（`listingCacheTags` / `buildingCacheTags` 删 `SITEMAP_TAG`）、`:618-647`（四个 pages / articles 条目删 `SITEMAP_TAG`）
- Modify: `payload-office-platform/src/domain/public-catalog/cache-tags.ts` 头注释「不变量」段：补一句「`SITEMAP_TAG` 只挂在站点地图聚合条目（`sitemap-shards.ts`）上，所有失效集合照发」
- Test: `payload-office-platform/tests/public-cache-tag-scope.test.ts`（新建）

**Interfaces:**
- Produces：无新导出。行为契约：除 key 以 `public-sitemap-` 开头的条目外，任何 `unstable_cache` 条目的 tags 都不含 `SITEMAP_TAG`。

- [x] **Step 1：写失败测试** `tests/public-cache-tag-scope.test.ts`

  沿用 `tests/mini-api-cached-queries.test.ts:20` 的 `vi.mock('next/cache', …)` 范式：mock `unstable_cache` 记录 `{ keyParts, tags }`，返回 `async () => undefined`。分别以 `'shanghai'`、`'hangzhou'` 调用 `cached-queries.ts` 全部 `getCached*` 导出（含 sitemap 分片两个），并 import `sitemap-shards.ts` 触发两条聚合条目登记。断言：

  ```ts
  it('非站点地图条目都不挂 SITEMAP_TAG', () => {
    const offenders = captured.filter(
      (e) => !e.keyParts[0].startsWith('public-sitemap-') && e.tags.includes(SITEMAP_TAG),
    )
    expect(offenders.map((e) => e.keyParts.join('|'))).toEqual([])
  })
  it('站点地图清单与出售存在性条目仍挂 SITEMAP_TAG', () => {
    for (const key of ['public-sitemap-manifest-v1', 'public-sitemap-sale-exists-v1']) {
      expect(captured.find((e) => e.keyParts[0] === key)?.tags).toContain(SITEMAP_TAG)
    }
  })
  it('失效上海不波及杭州的任何供给条目', () => {
    const fired = new Set(cityLevelSafeInvalidationTags('shanghai'))
    const hit = captured.filter(
      (e) => e.keyParts.includes('hangzhou') && e.tags.some((t) => fired.has(t)),
    )
    expect(hit.map((e) => e.keyParts.join('|'))).toEqual([])
  })
  it('资讯失效只波及声明了资讯依赖的条目', () => {
    const fired = new Set([ARTICLES_CATEGORY_TAG, SITEMAP_TAG])
    const hit = captured.filter(
      (e) => !e.keyParts[0].startsWith('public-sitemap-')
        && !e.tags.includes(ARTICLES_CATEGORY_TAG)
        && e.tags.some((t) => fired.has(t)),
    )
    expect(hit.map((e) => e.keyParts.join('|'))).toEqual([])
  })
  ```

  首页条目挂 `ARTICLES_CATEGORY_TAG` 是正当依赖（首页有资讯区），由 `!e.tags.includes(ARTICLES_CATEGORY_TAG)` 放行，不另做豁免。`getCachedPlatformStats` 每次只传**一个**城市调用：它的 key 是排序后的城市清单，传两城会合法地同时挂两城 tag，误触第 3 条断言。

- [x] **Step 2：确认红**：`pnpm exec vitest run tests/public-cache-tag-scope.test.ts`，预期第 1、3、4 条红（E1/E3），第 2 条绿。

- [x] **Step 3：实现**：按 Files 删掉 `SITEMAP_TAG`，补 `cache-tags.ts` 注释。`sitemap-shards.ts` 不动。

- [x] **Step 4：确认绿**：上条命令全绿；再跑 `pnpm exec vitest run tests/supply-public-cache-hook.test.ts tests/fp-06-content-seo-cache-acceptance.test.ts tests/media-delete-cache-invalidation.test.ts tests/home-sitemap-cache-performance.test.ts tests/sitemap-static-routes.test.ts`，全绿且未改动。

- [x] **Step 5：提交** `perf(cache): OPT-111 供给/资讯/内容页缓存条目不再挂 sitemap tag`

---

## Task 2：供给失效前判定「这次写入能否影响公开页面」

**Files:**
- Create: `payload-office-platform/src/domain/public-catalog/supply-cache-relevance.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/supply-cache-hook.ts:173-191`（两个 hook 工厂先过判定）
- Test: `payload-office-platform/tests/supply-cache-relevance.test.ts`（新建）；`tests/supply-public-cache-hook.test.ts`（夹具更新，见 Step 6）

**Interfaces:**
- Produces（`supply-cache-relevance.ts`）：

  ```ts
  export type SupplyCollection = 'listings' | 'buildings'
  export type SupplyCacheDecisionReason =
    | 'created_public' | 'became_or_was_public' | 'public_field_changed' | 'deleted_public'
    | 'never_public' | 'internal_fields_only' | 'unknown_shape'
  export type SupplyCacheDecision = Readonly<{ invalidate: boolean; reason: SupplyCacheDecisionReason }>

  /** 保存前后都确定不可能公开时为 false；状态字段缺失或不认识时为 true（fail-safe）。 */
  export function couldBePublic(collection: SupplyCollection, doc: unknown): boolean

  export const INTERNAL_ONLY_SUPPLY_FIELDS: Readonly<Record<SupplyCollection, readonly string[]>>

  export function decideSupplyCacheInvalidation(input: Readonly<{
    collection: SupplyCollection
    doc: unknown
    previousDoc?: unknown       // 缺省表示 create 或 delete
    operation: 'change' | 'delete'
  }>): SupplyCacheDecision
  ```

- 状态字段：`listings → publicationStatus`，`buildings → status`；值为 `'published'` 视为可能公开（E9）。
- 内部字段名单（初版，每项都已核实公开代码零引用；Step 1 的契约测试持续守护）：
  - `listings`：`updatedAt`、`createdAt`、`version`、`dataSource`、`roomNumber`、`contactBroker`
  - `buildings`：`updatedAt`、`createdAt`、`version`、`dataSource`、`verificationStatus`

  **不在名单里**（核实为公开展示或影响有效供给）：`verificationInfo`（`mappers.ts:913,1074,1128`）、`reviewStatus`、`supplyVisibilityHold`、`isFeatured`、`recommendedOrder`。

- 判定规则（按顺序，第一条命中即返回）：
  1. `operation === 'delete'`：`couldBePublic(doc)` ? `deleted_public` 失效 : `never_public` 跳过。
  2. 无 `previousDoc`（create）：`couldBePublic(doc)` ? `created_public` 失效 : `never_public` 跳过。
  3. `doc` 或 `previousDoc` 不是对象：`unknown_shape` 失效。
  4. 前后都 `!couldBePublic`：`never_public` 跳过。
  5. 前后公开性不同：`became_or_was_public` 失效。
  6. 取两侧顶层键的并集，去掉内部字段名单，逐键 `node:util` 的 `isDeepStrictEqual`；有任一不等：`public_field_changed` 失效，否则 `internal_fields_only` 跳过。

- [x] **Step 1：写失败测试** `tests/supply-cache-relevance.test.ts`

  表驱动，夹具最小化。每行一个 `it`，名称即场景：

  | 场景 | collection | previousDoc → doc | 期望 |
  |---|---|---|---|
  | `draft-to-draft` | listings | `{publicationStatus:'draft', rent:1}` → `{…, rent:2}` | 跳过 `never_public` |
  | `publish` | listings | draft → published | 失效 `became_or_was_public` |
  | `unpublish` | listings | published → `unpublished` | 失效 `became_or_was_public` |
  | `public-field` | listings | published `rent:1` → `rent:2` | 失效 `public_field_changed` |
  | `internal-only` | listings | published，只改 `roomNumber`、`updatedAt`、`version` | 跳过 `internal_fields_only` |
  | `soft-delete` | listings | published → published + `deletedAt` | 失效 `public_field_changed` |
  | `building-change` | listings | published `building:5` → `building:6` | 失效 |
  | `populated-vs-id` | listings | `building:5` → `building:{id:5}` | 失效（安全方向） |
  | `missing-status-changed` | listings | `{rent:1}` → `{rent:2}`（两侧都缺状态字段） | 失效 `public_field_changed`（`couldBePublic` fail-safe 为 true，规则 4 不跳过） |
  | `no-op-save` | listings | published，只有 `updatedAt` / `version` 变 | 跳过 `internal_fields_only` |
  | `create-draft` / `create-published` | buildings | 无 → `{status:'draft'}` / `{status:'published'}` | 跳过 / 失效 |
  | `delete-draft` / `delete-published` | buildings | delete `{status:'draft'}` / `{status:'published'}` | 跳过 / 失效 |
  | `building-internal-only` | buildings | published，只改 `verificationStatus` | 跳过 |

  另加源码契约用例 `内部字段在公开代码中零引用`：对 `INTERNAL_ONLY_SUPPLY_FIELDS` 每个字段（`updatedAt` / `createdAt` / `version` 三个元字段除外，它们按 E10 有已知的排序用途，见 D1），在 `src/domain/public-catalog`、`src/lib/frontend`、`src/app/(frontend)`、`src/components/frontend`、`src/lib/mini-program`、`src/domain/mini-program`、`src/app/api/mini` 下按 `\b<field>\b` 扫，期望零命中。

- [x] **Step 2：确认红**：`pnpm exec vitest run tests/supply-cache-relevance.test.ts`，预期模块不存在。

- [x] **Step 3：实现** `supply-cache-relevance.ts`，签名与规则见 Interfaces。`isDeepStrictEqual` 来自 `node:util`。

- [x] **Step 4：确认绿**：同上命令。

- [x] **Step 5：接线** `supply-cache-hook.ts`：`createAfterChangeHook` / `createAfterDeleteHook` 增加 `collection: SupplyCollection` 参数；在既有 `SKIP_SUPPLY_CACHE_INVALIDATION` 判断之后、`invalidateForDocs` 之前调用 `decideSupplyCacheInvalidation`。不失效时打一行 `console.info('[supply-cache-invalidation] skipped', { collection, id, reason })`（后台单条保存频率低，Task 4 的本地对照要数这行）。导出的四个 hook 名不变，`Listings.ts` / `Buildings.ts` 不改。

- [x] **Step 6：更新既有夹具** `tests/supply-public-cache-hook.test.ts`：现有用例的 `doc` 与 `previousDoc` 相同且无状态字段，新规则下会落到 `internal_fields_only`。逐条改成**真实的公开变化**：两侧补 `publicationStatus: 'published'`（楼盘用 `status`），并让 `previousDoc` 的一个公开字段不同（如 `rent`）。断言（失效哪些 tag、换城市两侧都失效、城市解析不出走类目兜底）一律不改。新增两条：草稿保存不调用 `revalidateTag`；只改 `roomNumber` 不调用 `revalidateTag`。

- [x] **Step 7：回归**：`pnpm exec vitest run tests/supply-public-cache-hook.test.ts tests/supply-cache-relevance.test.ts tests/admin-auto-publish-hook.test.ts tests/media-delete-cache-invalidation.test.ts`，全绿。

- [x] **Step 8：提交** `perf(cache): OPT-111 草稿与内部字段保存不再清公开缓存`

---

## Task 3：采集发布每个阶段只清一次

**Files:**
- Modify: `payload-office-platform/src/domain/supply-sync/source-sync-publish.ts:255-256`
- Test: `payload-office-platform/tests/source-sync-publish.test.ts`（改断言）

**Interfaces:**
- `publishSourceSlice` 返回值形状不变。行为由「`published > 0` 时失效」改为「`done === true` 时失效一次」，参数仍为 `([], 'source_sync')`（全城市类目兜底，一轮两次：楼盘、房源各一次）。

- [x] **Step 1：改测试为新契约**（先红）：
  - `:109` 所在用例（`done: true`）：保持 `toHaveBeenCalledOnce()`。
  - `:182` 所在用例（预算耗尽，`done: false`）：改为 `expect(io.invalidate).not.toHaveBeenCalled()`，用例名改为「…预算耗尽未完成时不失效缓存」。
  - `:160` 所在用例（提交失败、`published: 0`、`done: true`）：改为 `toHaveBeenCalledOnce()`，用例名注明「阶段结束即失效一次，不论本段是否发布」：前面的段可能已发布。
  - 新增：「本段发布了但未完成（`hasNextPage: true`）时不失效」。

- [x] **Step 2：确认红**：`pnpm exec vitest run tests/source-sync-publish.test.ts`。

- [x] **Step 3：实现**：`if (published > 0)` 改为基于返回对象里的 `done` 计算后判断；注释写明 D2 与「回滚端点仍立即失效」。

- [x] **Step 4：确认绿**：同上命令，并跑 `tests/source-sync-publish-endpoint.test.ts`。

- [x] **Step 5：提交** `perf(cache): OPT-111 采集发布每阶段只失效一次公开缓存`

---

## Task 4：对照验证与证据

证据目录：`artifacts/verification/OPT-111/`。脚本随证据提交（`.agent/testing.md` 证据质量第 1 条）。

- [x] **Step 1：全量闸门**：`pnpm typecheck && pnpm lint && pnpm test && pnpm build`。

- [x] **Step 2：本地前后对照**（同一脚本跑两次：改动前 `origin/master` 构建、改动后构建）。环境按 `.agent/testing.md`「本地 `next start`」节：`CI=1`、https `NEXT_PUBLIC_SITE_URL`、本地 PG 跑完迁移 + `pnpm seed` + `pnpm seed:media`，**`MULTI_CITY_ROUTING_ENABLED=true`**（要有两个城市首页）。

  可观测量：生产模式下首页缓存未命中会打 `[public-catalog:home-cache] {"phase":"start"}`（`cached-queries.ts:145`），按 `city` 计数。脚本 `probe-home-misses.sh`：
  1. 预热 `/shanghai`、`/hangzhou` 各 3 次，记录基线计数。
  2. 以 E2E 管理员账号（`scripts/seed.ts` 夹具）经 REST `PATCH /api/listings/<上海已上架房源 id>` 分别做四种写入，每次写后各请求两城首页一次，记录新增未命中：
     - a. 改公开字段（`rent`）
     - b. 只改 `roomNumber`
     - c. 改一条草稿房源的 `rent`（种子里没有草稿房源就先 `POST` 一条；这次创建本身也应命中跳过）
     - d. `PATCH /api/articles/<id>` 改标题：**正对照**，改动前后两城都应未命中，证明观测手段在改动后仍然灵敏
  3. 期望矩阵（改动前 → 改动后）：

     | 写入 | 上海首页 | 杭州首页 |
     |---|---|---|
     | a 公开字段 | 未命中 → 未命中 | **未命中 → 命中** |
     | b 内部字段 | 未命中 → **命中** | 未命中 → **命中** |
     | c 草稿 | 未命中 → **命中** | 未命中 → **命中** |
     | d 资讯 | 未命中 → 未命中 | 未命中 → 未命中（首页有资讯区，正当） |

  先确认「改动前」那一列真的全是未命中（对照组有效，见根 `CLAUDE.md`「做对照实验时」），再看改动后。

- [x] **Step 3：浏览器走一遍**：后台改一条上海房源的租金，前台上海列表页与详情页刷新后显示新值；把它下架，列表与详情立即消失（硬过期语义未变）。四档视口不需要，本项无 UI 改动；控制台无新增错误。

- [ ] **Step 4：上线后复测**（合并即上线）：CloudRun 运行日志里按小时统计 `[public-catalog:home-cache]` `phase:start` 次数，与上线前同时段对比；同时统计 `[supply-cache-invalidation] skipped` 的 `reason` 分布。拿不到日志就如实写「未验证」。

- [x] **Step 5：回写本文件**「实施后订正」与勾选状态。

---

## 5. 回滚

纯代码改动，无迁移、无数据变化。回滚即还原提交；最坏情况是回到现状（失效面过大），不会出现「该清的没清」之外的新故障模式。唯一的单向风险是 Task 2 的内部字段名单漏判公开字段：后果是该字段改动最长 300s 后才对外可见（TTL 兜底），Step 1 的源码契约测试负责提前拦截。

## 6. 风险

- **R1 名单漂移**：新增公开展示字段时若恰好重名于内部名单，契约测试会红；新增**内部**字段不进名单只会多失效，安全。
- **R2 hook 深度不一致**：`doc` / `previousDoc` 关系字段展开深度不同 → 判为变化 → 多失效，安全。
- **R3 多实例**：本项不改变 OPT-042 的跨实例传播缺口；对外表述不得写成「多实例下失效已正确」。

## 7. 实施后订正（2026-10-14）

- **评审重点 #3 低估了问题，已修正实现。** 原写「关系字段一侧 id、一侧展开 → 判为变化，安全方向」。
  本地对照实验（Task 4）证明这会让 D1 形同虚设：`previousDoc` 恒为 depth 0，`doc` 随调用方 depth
  展开（Local API 默认 `defaultDepth=2`）；且 Listings 的 beforeChange 每次保存都由 `mediaItems` 重建
  `gallery`，数组行 id 每次都换。现在比较前归一成存储形态：带 id 与时间戳的展开文档收成 id，数组元素去掉
  行 id（顺序与内容照常比较）。认不出的裸 `{ id }` 对象仍原样比较、只多失效。
- **Task 2 Step 6 只改了一条既有夹具**：其余用例本就是新建形态或换楼盘，已经是真实的公开变化，未动。
  另补两条表外用例（`unknown_shape`、楼盘不认房源的状态字段）。
- **后台表单的「租金」输入是 `price.amount`**，不是 `rent` 列；浏览器走查按此改。
- **夹具**：种子里杭州为 coming-soon（不读首页缓存）、无草稿房源、无资讯，对照实验前由
  `setup-fixtures.sh` 把杭州置 live、一条上海房源改草稿，资讯由探针脚本经 REST 新建。
- **新建走 `previousDoc: {}`，不是 undefined**（整分支评审发现，`payload/dist/collections/operations/create.js`）。
  原实现让「新建草稿」落到规则 4 的 fail-safe、照常失效（安全方向，但没达到计划的跳过）。hook 现按
  `operation === 'create'` 把 previousDoc 归一成「无」，用例用真实形态 `{ operation: 'create', previousDoc: {} }`。
- 证据：`artifacts/verification/OPT-111/verification.md`。
