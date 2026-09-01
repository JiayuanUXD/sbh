# 软删除误用全库排查（2026-08-22）

排查任务，**未改任何代码、未改任何数据、未跑迁移**。生产库只执行只读 `SELECT`。
起因：OPT-041 Task 9 做真库探针时发现 `payload.delete({ trash: true })` 实为硬删除。

排查范围：`payload-office-platform/src/`、`scripts/`、`tests/`、`tests/e2e/`，
分支 `master` 与 `feat/opt-041-bulk-import-e227`，以及生产共享库 `postgres`
（EnvId `sbh-d9gnr8h5ef7e22e30`）。

---

## 1. 前提确证：`trash` 参数不是软删开关

Payload **3.86.0**，`node_modules/payload/dist/collections/operations/deleteByID.js`：

| 行 | 内容 | 含义 |
|---|---|---|
| 62–65 | `appendNonTrashedFilter({ enableTrash: collectionConfig.trash, trash, where })` | `trash` 只参与**查找待删文档的 where 条件**——是否把已软删的文档也算进候选 |
| 126 | `req.payload.db.deleteOne({ collection, req, select, where: { id } })` | 无条件物理删除 |
| 全文 | 零处写 `deletedAt` | 不存在软删分支 |

`delete.js`（批量删）同构。结论：

> **`payload.delete()` 恒为硬删除。`trash: true` 只是"连回收站里的也一起删"，不是"删到回收站"。**

软删除只有两条路径：

1. `payload.update({ collection, id, data: { deletedAt: <ISO> } })`
   —— 项目里 `src/domain/supply/building-dedup-service.ts:327` 就是正确写法。
2. 后台 UI 的 `PATCH /api/<collection>/:id`，body `{ deletedAt }`
   —— 见 `@payloadcms/ui/dist/elements/DeleteDocument/index.js:93`。

---

## 2. 调用点清单

### 2.0 总览

**`src/` 应用代码里 `payload.delete` 调用点数量：0。**
`master` 与 `feat/opt-041-bulk-import-e227` 均为 0
（OPT-041 的 `src/domain/supply-import/batch-rollback.ts` 走 `update` 下架，`rg "\.delete\("` 零命中，干净）。

误用集中在两处：**脚本 / 测试**，以及**后台 UI 的永久删除路径**。

### 2.1 A 类：意图软删、实际硬删（真误用）

| 位置 | 意图 | 实际行为 | 影响评估 |
|---|---|---|---|
| `payload-office-platform/scripts/verify-location-counts.ts:127` | 上一行注释写死「已删楼盘：**trash 置 deleted_at**」 | 物理删除 `buildings` 整行 | 楼盘属**已引用主数据**，AGENTS.md 第 4 条禁止物理删除。脚本头注释声称打本地库 `sbh_dev_geo`，但实际库完全由 `.env.local` 的 `DATABASE_URL` 决定，**无目标库守卫**（对比 `scripts/seed-media.ts` 有 `assertSeedTargetFromProcessEnv()`）。生产 `buildings.deleted_at` 全为 NULL，无直接证据证明打过生产 |

### 2.2 B 类：意图即硬删，但对象属宪章保护类

| 位置 | 对象 | 备注 |
|---|---|---|
| `scripts/verify-opt033.ts:206` | `listing-reviews`（审核记录） | `finally` 里清理自造 fixture，范围限于自己创建的房源；但删的是宪章点名的「审核」类，且该脚本无目标库守卫 |
| `scripts/verify-opt033.ts:209` | 自造 `listings` / `buildings` 等 | 同上 |
| `tests/city-partner-notify-postgres.test.ts:64` | `domain-events` | `src/collections/DomainEvents.ts:56` 明写「Outbox 只追加：不允许删除（trash: false）」——**collection 契约与测试清理逻辑直接冲突** |
| `tests/city-partner-notify-postgres.test.ts:40/51/118/198/199` | `payload-jobs` | 队列行，硬删无争议 |
| `tests/city-partner-notify-postgres.test.ts:67`、`tests/city-partner-details-postgres.test.ts:28` | `city-partner-applications` | 业务申请单；该 collection 未开 trash，硬删是唯一可能 |

### 2.3 C 类：行为与意图一致，无问题

- `scripts/seed-media.ts:156`、`scripts/seed-test-data.ts:784` —— `media` 未开 trash，意图即清理占位图。
  `seed-media.ts` 有生产守卫，`seed-test-data.ts` **没有**。
- `tests/e2e/geography-admin.spec.ts:198`（`business-area-extensions`）、
  `tests/e2e/permission-matrix.spec.ts:386`（`roles`，`trash: false`）、
  `tests/e2e/admin-navigation.spec.ts:597`（`forms`）—— 均走 REST `DELETE`，对象都未开 trash。

### 2.4 D 类：真正波及生产的路径（不在任何 `rg payload.delete` 结果里）

`src/collections/Listings.ts:212` 与 `src/collections/Buildings.ts:101` 声明了 `trash: true`，
但两者的 `access` **只配了 `read: () => true`，没有配 `delete`**，也没有使用
`createCollectionAccess`（其余 9 个 collection 都用了）。Payload 的默认 delete access 是
「任何登录用户」，而 `listing:delete` / `building:delete` 这两个权限码在
`src/domain/auth/permission-codes.ts:74/81` 已定义却**未接入**。

叠加 `@payloadcms/ui/dist/utilities/shouldPermanentlyDelete.js`：

```js
return isTrashView || !hasTrashPermission || (hasDeletePermission && deletePermanently)
```

`hasTrashPermission` / `hasDeletePermission` 均由
`@payloadcms/next/dist/views/Document/getDocumentPermissions.js:65-66` 用同一条
`access.delete` 分别带 / 不带 `deletedAt` 求值得出。当前配置下两者都恒为 true，
于是：**任何登录后台用户，在房源/楼盘详情页勾一下「永久删除」，或进回收站页删一次，
就会发出 `DELETE /api/listings/:id` 硬删。**

---

## 3. 生产是否已经发生过

共享库 `postgres`（`current_database()` 实测），2171 条已发布房源，确认为线上库。

### 3.1 只读探针结果

| 探针 | 结果 |
|---|---|
| `SELECT count(*) FROM listings WHERE deleted_at IS NOT NULL` | **0** —— trash 机制在生产上从未被使用过 |
| `SELECT count(*) FROM buildings WHERE deleted_at IS NOT NULL` | 0 |
| `SELECT count(*) FROM listing_reviews WHERE listing_id IS NULL` | **1** |
| `SELECT count(*) FROM listing_reports` | 0 行，无孤儿 |
| `SELECT count(*) FROM listings` / `max(id)` / 序列 `last_value` | 2213 / **2462** / **2464** |
| `SELECT count(*) FROM buildings` / `max(id)` / `last_value` | 72 / 157 / 157 |
| `SELECT count(*) FROM listings WHERE building_id IS NULL` | 0 |

孤儿审核行明细：

```
id=4197  listing_id=NULL  decision=fast_track  created_at=2026-08-19 23:25:37.699 +0800
```

### 3.2 与审计表的时间对齐

`audit_logs` 全表仅 4 行。第 4 行：

```
id=4  audit_id=aud_mt08u2jr232kl1vw
action=listing.review_fast_track  result=success
object_collection=listings  object_id=2464
after.slug="test08192325"  after.title="test08192325"
subject_user_id=3  subject_role_codes=["ADM"]
method=POST  path=https://localhost:80/api/listings
created_at=2026-08-19 23:25:37.77 +0800
```

与孤儿审核行 4197 的 `created_at`（23:25:37.699）严丝合缝。

### 3.3 结论

**生产上至少发生过一次房源硬删除。** listing 2464（测试房源 `test08192325`）被创建、
自动发布，随后被物理删除；序列 `last_value=2464` 而 `max(id)=2462`，说明 2463、2464 均已消失。
`listings.deleted_at` 全表为 0 佐证了这不是"先进回收站再清空"以外的软删——回收站从未被用过。

留下的残迹：1 条脱钩的 `listing_reviews`（id 4197）+ 3 条 `audit_logs`
（object_id 2461/2462/2464，其中仅 2464 悬空）。

业务价值上删掉的是测试数据，但**路径已被走通**，且宪章禁止物理删除的「审核记录」
确实被留成了孤儿。

### 3.4 不能当证据的东西

`listings` 249 个、`buildings` 85 个 id 空洞**不构成硬删证据**——PostgreSQL 序列在失败事务中
同样吃号，批量导入回滚会大量制造空洞。

---

## 4. 与 `artifacts/verification/listing-hard-delete-fk/` 的关系

该目录**只在主工作树 `E:\github\sbh` 里以未跟踪状态存在**，git 全历史中从未提交；
对应迁移 `src/migrations/20260819_113218_listing_hard_delete_nullable_refs.ts` 已入库。

**不冲突，是互补关系。** 那次工作解决的是「硬删房源触发 PG 23502 not_null_violation →
后台只显示 Something went wrong」，做法是把 `listing_reviews.listing_id` 与
`listing_reports.target_listing_id` 改为可空。即：**它有意把硬删路径打通了**，
同时在迁移头注释里写明「这两张表是审计记录，房源删了也该留着」。

本次排查补上的是另一半事实：应用层根本没有一条能走到软删的路，
`trash: true` 声明了但从未生效过。

### 一处待澄清（不影响主结论）

`listing-hard-delete-fk/04-e2e.txt` 的验收行写：

```
房源已删: true | 关系已清: true | 审核脱钩保留: false
```

其中 `审核脱钩保留: false` 与迁移头注释的「脱钩保留」自相矛盾。但：

- FK 定义是 `ON DELETE set null`（`src/migrations/20260725_185329_m4_4_listing_reviews.ts:34`）；
- 生产现存的孤儿行 4197 就是「脱钩保留」成立的活证据。

所以那个 `false` **极大概率是验收脚本按 listing id 反查、脱钩后自然查不到导致的口径问题**，
不是数据真的丢了。该验收脚本未入库，要坐实需要重跑一次按 review id 直查的探针。

---

## 5. 待决处置面（按风险排序，均未动手）

| # | 事项 | 风险 |
|---|---|---|
| 1 | `Listings` / `Buildings` 缺 `delete` access，`listing:delete` / `building:delete` 权限码闲置 | 唯一能从生产 UI 触发的硬删路径；任何登录后台用户可永久删房源楼盘 |
| 2 | `scripts/verify-location-counts.ts:127` 名实不符（注释说软删、代码硬删楼盘），且无目标库守卫 | 误用 + 可能误打生产 |
| 3 | `DomainEvents` collection 契约（Outbox 不可删）与 `city-partner-notify-postgres.test.ts:64` 的清理逻辑冲突 | 语义漂移 |
| 4 | `verify-opt033.ts` / `seed-test-data.ts` 缺 `assertSeedTarget` 类守卫（`seed-media.ts` 有现成实现可抄） | 可能误打生产 |
| 5 | 生产遗留：孤儿 `listing_reviews` id=4197；`audit_logs` id=4 指向已不存在的 listing 2464 | 按宪章「审计不得物理删除」，倾向保留不清理 |

---

## 附：本次执行的只读 SQL

```sql
-- 探针 1：孤儿与软删计数
SELECT 'listing_reviews.listing_id IS NULL' AS probe, count(*) AS n FROM listing_reviews WHERE listing_id IS NULL
UNION ALL SELECT 'listing_reviews total', count(*) FROM listing_reviews
UNION ALL SELECT 'listing_reports.target_listing_id IS NULL', count(*) FROM listing_reports WHERE target_listing_id IS NULL
UNION ALL SELECT 'listing_reports total', count(*) FROM listing_reports
UNION ALL SELECT 'listings total', count(*) FROM listings
UNION ALL SELECT 'listings soft-deleted', count(*) FROM listings WHERE deleted_at IS NOT NULL
UNION ALL SELECT 'listings max_id', coalesce(max(id),0) FROM listings
UNION ALL SELECT 'buildings total', count(*) FROM buildings
UNION ALL SELECT 'buildings soft-deleted', count(*) FROM buildings WHERE deleted_at IS NOT NULL
UNION ALL SELECT 'buildings max_id', coalesce(max(id),0) FROM buildings;

-- 探针 2：孤儿行明细
SELECT id, listing_id, decision, created_at, updated_at FROM listing_reviews WHERE listing_id IS NULL ORDER BY id;

-- 探针 3：审计表全量（仅 4 行）
SELECT * FROM audit_logs ORDER BY created_at;

-- 探针 4：序列与空洞
SELECT 'listings.building_id IS NULL' AS probe, count(*)::text AS n FROM listings WHERE building_id IS NULL
UNION ALL SELECT 'listings id-gap (max-count)', ((SELECT max(id) FROM listings) - (SELECT count(*) FROM listings))::text
UNION ALL SELECT 'buildings id-gap (max-count)', ((SELECT max(id) FROM buildings) - (SELECT count(*) FROM buildings))::text
UNION ALL SELECT 'listings seq last_value', (SELECT last_value::text FROM listings_id_seq)
UNION ALL SELECT 'buildings seq last_value', (SELECT last_value::text FROM buildings_id_seq);
```
