# OPT-034 收敛房源商户关系：删除 listing_merchant_relations

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实施。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 删除 `listing_merchant_relations` 表，前台有效供给判定从「关系在有效期内 + 关系商户合格」改为「`listings.merchant` 有值 + 该商户合格」。

**Architecture:** 分两段。**先改读侧**（判定、SQL、商户停用传播全部改看 `listings.merchant`），此时表还在、数据不动，任何一步都可单独回滚；**读侧全绿后再删表**（迁移 + 移除 collection/hook/domain 模块）。顺序反过来会出现「代码还在查已被删的表」的窗口期。

**Tech Stack:** Payload 3.86 + PostgreSQL（`push:false`，只走显式迁移）、Vitest、Playwright。

## Global Constraints

- 生产库 `push:false`，字段/约束/表变化**必须**生成显式迁移，且提供 `down()` 与回滚说明。
- **CI 当前不可用**（GitHub Actions 配额，job 拿不到 runner）。每个任务的验收**必须本地跑完** `pnpm typecheck && pnpm lint && pnpm test`；迁移额外跑 `pnpm migrate:dry-run`。
- 提交只用显式 `git add <路径>`，禁用 `git add -A` / `git commit -am`。
- 改 collection 但无表结构变化时用 `SKIP_MIGRATION_CHECK=1` 并在提交信息里说明理由。
- 改 `payload.config` 或新增 client 组件后必须 `pnpm payload generate:importmap` 并提交。
- 提交 `payload-types.ts` 前 `grep -c "prefix" src/payload-types.ts` **必须是 2**。
- 分支：`pnpm branch:new refactor collapse listing merchant relations`。
- 本地 `.env.local` 已是本地库 + 无 COS（磁盘存储），**不要**指向生产。

## 生产实况（2026-08-20 实测，决定本方案可行）

| 指标 | 值 |
|---|---|
| 关系 : 房源 | 2208 : 2208（严格 1:1） |
| 设了 `effective_to` 的 | **0** |
| 未来生效的 | **0** |
| `listings.merchant_id` 与关系商户不一致 | 3（全是「字段有值但无关系」） |
| 切换前可见房源 | 2169 |
| 切换后可见房源 | 2172（+3） |
| **切换后会消失的房源** | **0** |

有效期机制上线至今从未被使用。切换是纯增量，无房源下线风险。

## 文件结构

| 文件 | 职责变化 |
|---|---|
| `src/domain/review/effective-supply.ts` | 精筛去掉 `relationPeriod`，新增 `NO_SUPPLY_MERCHANT` 排除码 |
| `src/domain/review/effective-supply-snapshot.ts` | 删 `loadRelationPeriod` / `loadEffectiveRelations`，商户改从 `listing.merchant` 取 |
| `src/domain/public-catalog/supply-adapter.ts` | 两处原始 SQL：删 `active_rel` CTE，改 `JOIN merchants ON id = l.merchant_id` |
| `src/domain/supply/merchant-stop-listings.ts` | `listActiveListingIdsForMerchant` 改查 `listings.merchant` |
| `src/domain/review/listing-completeness.ts` | `hasValidMerchantRelation` 语义收敛为「字段有值」，不再是近似 |
| `src/endpoints/dashboard-stats-endpoint.ts` | `FIND_COLLECTIONS` 移除关系表 |
| `src/collections/ListingMerchantRelations.ts` | **删除** |
| `src/domain/supply/listing-merchant-relation{,-protect}.ts` | **删除** |
| `src/domain/supply/listing-delete-cleanup.ts` | **删除**（表没了就不需要清理） |
| `src/domain/supply/listing-relation-autocreate.ts` | **删除**（PR #74 的自动建关系随之作废） |
| `src/migrations/<ts>_drop_listing_merchant_relations.ts` | 新增，删表 |

---

### Task 0：处置 PR #74

PR #74 含两部分：默认商户预选（保留）、自动建关系（作废）。

- [ ] **Step 1: 从 #74 分支移除自动建关系**

```bash
git switch feat/default-supply-merchant-5052
git rm payload-office-platform/src/domain/supply/listing-relation-autocreate.ts \
       payload-office-platform/tests/listing-relation-autocreate.test.ts
```

- [ ] **Step 2: 摘掉 Listings 的接线**

`src/collections/Listings.ts`：删除 `autoCreateListingRelation` 的 import 与 `afterChange` 中的引用，恢复为 `afterChange: [recordAdminAutoPublish]`。

- [ ] **Step 3: 本地验收并提交**

```bash
cd payload-office-platform && pnpm typecheck && pnpm test
cd .. && git add payload-office-platform/src/collections/Listings.ts
SKIP_MIGRATION_CHECK=1 git commit -m "revert(supply): 撤回自动建关系，OPT-034 将直接删除关系表"
git push
```

---

### Task 1：精筛判定改看 listings.merchant

**Files:**
- Modify: `src/domain/review/effective-supply.ts`
- Modify: `src/domain/review/effective-supply-snapshot.ts`
- Test: `tests/effective-supply.test.ts`、`tests/effective-supply-snapshot.test.ts`

**Interfaces:**
- Produces: `EffectiveSupplySnapshot` 去掉 `relationPeriod`；`EFFECTIVE_SUPPLY_EXCLUSION_CODES` 去掉 `RELATION_NOT_EFFECTIVE`、新增 `NO_SUPPLY_MERCHANT`；`buildEffectiveSnapshot(listing)` 变成单参数。

- [ ] **Step 1: 先写失败测试**

```ts
// tests/effective-supply.test.ts
it('房源没有供给商户 → NO_SUPPLY_MERCHANT', () => {
  const snap = { ...fullyEligibleSnapshot(), merchant: null }
  const r = isListingEffectivelySupplied(snap, asOf)
  expect(r.eligible).toBe(false)
  expect(r.reasons).toContain(EFFECTIVE_SUPPLY_EXCLUSION_CODES.NO_SUPPLY_MERCHANT)
})

it('不再有 RELATION_NOT_EFFECTIVE 这个码', () => {
  expect(Object.keys(EFFECTIVE_SUPPLY_EXCLUSION_CODES)).not.toContain('RELATION_NOT_EFFECTIVE')
})
```

- [ ] **Step 2: 跑测试确认失败**

`pnpm vitest run tests/effective-supply.test.ts` → 预期 FAIL（`NO_SUPPLY_MERCHANT` 未定义）。

- [ ] **Step 3: 改实现**

`effective-supply.ts`：`EffectiveSupplySnapshot` 的 `relationPeriod` 换成 `merchant: { id, status, qualificationStatus, qualificationExpiresAt, serviceCityIds } | null`；排除码把 `RELATION_NOT_EFFECTIVE` 换成 `NO_SUPPLY_MERCHANT`；`isListingEffectivelySupplied` 里 `isWithinValidity` 那段改为「`snapshot.merchant === null` → push `NO_SUPPLY_MERCHANT`」，商户资格检查保持不变。头注释同步说明「§8 半开区间关系已于 OPT-034 移除，供给商户直接取自 `listings.merchant`」。

`effective-supply-snapshot.ts`：删除 `loadRelationPeriod`、`loadEffectiveRelations`；`buildEffectiveSnapshot(listing)` 从 `listing.merchant` 取商户；`resolveEffectiveSupply` / `resolveEffectiveSupplies` 不再查关系表。

- [ ] **Step 4: 跑测试确认通过**

`pnpm vitest run tests/effective-supply.test.ts tests/effective-supply-snapshot.test.ts` → 全绿。相关用例里的 `relationPeriod` 全部改为 `merchant`。

- [ ] **Step 5: 提交**

```bash
git add payload-office-platform/src/domain/review/effective-supply.ts \
        payload-office-platform/src/domain/review/effective-supply-snapshot.ts \
        payload-office-platform/tests/effective-supply.test.ts \
        payload-office-platform/tests/effective-supply-snapshot.test.ts
git commit -m "refactor(supply): 精筛判定改看 listings.merchant，去掉关系有效期"
```

---

### Task 2：两处原始 SQL 同步改口径

**Files:**
- Modify: `src/domain/public-catalog/supply-adapter.ts`（`findEffectiveListingsByBuilding`、`sumEffectiveLeasableAreaByBuildings`）

- [ ] **Step 1: 改 SQL**

两处都删掉 `active_rel` CTE 与 `JOIN active_rel ar ...`，把 `JOIN merchants m ON m.id = ar.merchant_id` 改为：

```sql
JOIN merchants  m    ON m.id = l.merchant_id
```

并删掉 `$1`（asOf）在关系区间上的用法（`m.qualification_expires_at >= $1` 保留）。注释里的规则对照表同步更新：`ar.rel_count = 1 + 区间覆盖 asOf → §8` 那行删除。

- [ ] **Step 2: 口径比对**

```bash
cd payload-office-platform && pnpm verify:leasable-area
```

预期：逐个楼盘一致。**注意**：本地库数据量小，通过不代表生产一致；生产验证放 Task 7 之后。

- [ ] **Step 3: 全量测试 + 提交**

```bash
pnpm typecheck && pnpm test
git add payload-office-platform/src/domain/public-catalog/supply-adapter.ts
git commit -m "refactor(supply): 两处聚合 SQL 改用 listings.merchant_id"
```

---

### Task 3：商户停用传播改查 listings

**Files:**
- Modify: `src/domain/supply/merchant-stop-listings.ts:38-60`
- Test: `tests/merchant-stop-listings.test.ts`

- [ ] **Step 1: 先写失败测试**

```ts
it('按 listings.merchant 找该商户供给的房源，不再查关系表', async () => {
  const find = vi.fn(async () => ({ docs: [{ id: 11 }, { id: 12 }] }))
  const ids = await listActiveListingIdsForMerchant({ find } as never, 7)
  expect(ids).toEqual([11, 12])
  expect(find).toHaveBeenCalledWith(
    expect.objectContaining({ collection: 'listings', where: { merchant: { equals: 7 } } }),
  )
})
```

- [ ] **Step 2: 跑测试确认失败**（仍查 `listing-merchant-relations`）

- [ ] **Step 3: 改实现**

```ts
const res = await payload.find({
  collection: 'listings',
  where: { merchant: { equals: merchantId }, deletedAt: { exists: false } },
  limit: 1000, depth: 0, overrideAccess: true, req,
})
const ids = new Set<number | string>((res.docs ?? []).map((d) => (d as { id: number | string }).id))
```

去掉 `now` 与区间条件。头注释更新为「OPT-034 起供给商户直接存在 `listings.merchant`」。

- [ ] **Step 4: 跑测试确认通过并提交**

```bash
pnpm vitest run tests/merchant-stop-listings.test.ts && pnpm test
git add payload-office-platform/src/domain/supply/merchant-stop-listings.ts payload-office-platform/tests/merchant-stop-listings.test.ts
git commit -m "refactor(supply): 商户停用传播改按 listings.merchant 检索"
```

---

### Task 4：完整度校验不再是近似

**Files:**
- Modify: `src/domain/review/listing-completeness.ts`（`merchant` 分支文案）
- Modify: `src/collections/listing-publish-marks.ts:26-29`（注释）
- Modify: `src/components/admin/ListingCompletenessCardClient.tsx:95`（注释）
- Modify: `src/domain/review/admin-auto-publish-hook.ts:54-56`（注释）

- [ ] **Step 1: 改文案与注释**

`listing-completeness.ts` 的 `merchant` 分支：`fail('merchant', '请选择供给商户')`。四处「这是近似 / 真实门槛判的是 listing-merchant-relations」注释全部改为「OPT-034 起 `listings.merchant` 即唯一真相，不再是近似」。

- [ ] **Step 2: 跑测试 + 提交**

```bash
pnpm test
git add payload-office-platform/src/domain/review/listing-completeness.ts \
        payload-office-platform/src/collections/listing-publish-marks.ts \
        payload-office-platform/src/components/admin/ListingCompletenessCardClient.tsx \
        payload-office-platform/src/domain/review/admin-auto-publish-hook.ts
SKIP_MIGRATION_CHECK=1 git commit -m "docs(review): 完整度的商户判定不再是近似"
```

---

### Task 5：删除 collection、hook 与 domain 模块

**Files:**
- Delete: `src/collections/ListingMerchantRelations.ts`、`src/domain/supply/listing-merchant-relation.ts`、`src/domain/supply/listing-merchant-relation-protect.ts` 及其测试
- ⚠️ **`listing-delete-cleanup.ts` 不在本任务删除**，移至 Task 6（删表之后）。表还在时删掉它，删房源会重新报 23502——正是 PR #71 刚修好的那个。
- Modify: `src/payload.config.ts`（collections 数组）、`src/collections/Listings.ts`（去掉 `beforeDelete`）、`src/endpoints/dashboard-stats-endpoint.ts:17`

- [ ] **Step 1: 删除文件与接线**

```bash
cd payload-office-platform
git rm src/collections/ListingMerchantRelations.ts \
       src/domain/supply/listing-merchant-relation.ts \
       src/domain/supply/listing-merchant-relation-protect.ts \
       src/domain/supply/listing-delete-cleanup.ts \
       tests/listing-delete-cleanup.test.ts
```

`payload.config.ts` 移除 `ListingMerchantRelations` import 与 collections 项；`dashboard-stats-endpoint.ts` 的 `FIND_COLLECTIONS` 去掉 `'listing-merchant-relations'`。

- [ ] **Step 2: 重生成生成物**

```bash
pnpm payload generate:importmap && pnpm generate:types
grep -c "prefix" src/payload-types.ts   # 必须是 2
```

- [ ] **Step 3: 全量验收 + 提交**

```bash
pnpm typecheck && pnpm lint && pnpm test
cd .. && git add <上述所有路径> payload-office-platform/src/payload-types.ts payload-office-platform/src/app/\(payload\)/admin/importMap.js
SKIP_MIGRATION_CHECK=1 git commit -m "refactor(supply): 删除房源商户关系 collection 与配套 hook"
```

---

### Task 6：删表迁移

**Files:**
- Create: `src/migrations/<timestamp>_drop_listing_merchant_relations.ts` + `.json`

- [ ] **Step 1: 生成迁移**

```bash
cd payload-office-platform && pnpm exec payload migrate:create drop_listing_merchant_relations
```

- [ ] **Step 2: 补写头注释与回滚说明**

说明：为何删（有效期机制从未使用，2208 条 1:1、0 条终止）、切换后可见房源 2169 → 2172、0 条消失。**回滚说明**：`down()` 重建表结构但**不恢复数据**——2208 条关系记录一旦删除不可逆。回滚前需先从备份恢复，或接受关系历史丢失（`listings.merchant` 仍在，供给关系本身不丢）。

- [ ] **Step 3: 更新迁移计数守卫**

`tests/preflight-migrations.test.ts` 里两处 `toBe(N)` 同步 +1。

- [ ] **Step 4: dry-run + 全量测试**

```bash
pnpm migrate:dry-run && pnpm typecheck && pnpm test
```

- [ ] **Step 5: 本地库应用并端到端验证**

```bash
pnpm exec payload migrate
```

然后建一条新房源（只填 title/building/listingType + merchant），确认 `resolveEffectiveSupply` 返回 `eligible=true`，且删除房源不再报 23502。

- [ ] **Step 6: 表删完才能摸 delete-cleanup hook**

表已不存在，清理 hook 失去意义；此前删它会让删房源重新报 23502。

```bash
cd payload-office-platform
git rm src/domain/supply/listing-delete-cleanup.ts tests/listing-delete-cleanup.test.ts
```

`Listings.ts` 移除 `beforeDelete: [cleanupListingRelations]` 及其 import。然后确认删房源仍正常（本地库实测）。

- [ ] **Step 7: 提交**

```bash
pnpm typecheck && pnpm test
cd .. && git add payload-office-platform/src/migrations/ payload-office-platform/tests/preflight-migrations.test.ts payload-office-platform/src/domain/supply/listing-delete-cleanup.ts payload-office-platform/tests/listing-delete-cleanup.test.ts payload-office-platform/src/collections/Listings.ts
git commit -m "feat(migration): 删除 listing_merchant_relations 表与配套清理 hook"
```

---

### Task 7：清理种子与脚本

**Files:**
- Modify: `scripts/seed.ts`、`scripts/seed-test-data.ts`、`scripts/data-audit.ts`、`scripts/verification/opt022-batch-resolver-measure.ts`
- Modify: `src/domain/supply/building-aggregate.ts`、`building-references.ts`、`merchant-references.ts`（仅注释）
- Modify: `payload-office-platform/.agent/supply.md`（§8 标注废除，与 §6 同样式）

- [ ] **Step 1: 种子改为直接写 `listings.merchant`**，删除关系记录创建逻辑。
- [ ] **Step 2: 三处注释与 `.agent/supply.md` §8 同步更新。**
- [ ] **Step 3: 跑种子验证 + 全量测试 + 提交。**

```bash
pnpm seed && pnpm test
```

---

### Task 8：生产上线与验证

- [ ] **Step 1: 开 PR，正文写明** 2169 → 2172、0 条消失、回滚不可恢复数据。
- [ ] **Step 2: 等 CI 配额恢复**，闸门全绿后合并。**CI 不可用期间不得强合**——本变更改的是前台可见性判定，没有 e2e 兜底不能上生产。
- [ ] **Step 3: 部署**（`workflow_dispatch`，`promote=true`）。迁移在容器启动时自动执行。
- [ ] **Step 4: 生产验证**

```sql
-- 期望 2172
SELECT COUNT(*) FROM listings l JOIN merchants m ON m.id=l.merchant_id
WHERE l.deleted_at IS NULL AND l.publication_status='published'
  AND l.review_status='approved' AND l.supply_visibility_hold='normal'
  AND m.status='active' AND m.qualification_status='valid';
```

并确认 `https://.../listings/test08192325` 返回 **200**（#2464 是本次 +3 之一）。

- [ ] **Step 5: 跑生产口径比对** `pnpm verify:leasable-area`（本地指向生产只读场景需谨慎，建议在部署后用只读 SQL 复核楼盘在租面积样本）。

---

## 自检

**规格覆盖**：读侧四处（精筛/SQL/商户停用/完整度）→ Task 1-4；删除面（collection/hook/domain/表）→ Task 5-6；周边（种子/脚本/文档）→ Task 7；上线 → Task 8。PR #74 冲突 → Task 0。

**类型一致性**：`NO_SUPPLY_MERCHANT` 在 Task 1 定义，Task 2 的 SQL 不涉及排除码；`buildEffectiveSnapshot` 单参数签名在 Task 1 确立，无其他任务改它。

**已知风险**：
1. 关系数据删除不可逆——迁移前务必确认生产已有备份。
2. CI 不可用是上线的硬阻塞，不是可绕过项。
3. 本地库数据量远小于生产，`verify:leasable-area` 本地通过不代表生产一致。
