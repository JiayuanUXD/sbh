# Review Queue Badge Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让审核队列侧栏角标与页面使用同一“当前待审核房源”统计口径。

**Architecture:** 保留导航角标的统一查询执行器，仅将 `listingReviews` 查询目标从历史事件 `listing-reviews` 切换为当前实体 `listings`。查询使用 `reviewStatus = pending` 和队列一致的 `building.city` 权限路径，不触碰不可变审核历史。

**Tech Stack:** TypeScript、Payload CMS 3.86、Vitest、pnpm

## Global Constraints

- 包管理器固定为 pnpm。
- 禁止修改或删除不可变审核历史。
- 权限必须由服务端查询强制执行。
- 未经用户确认不得提交、推送或创建 PR。

---

### Task 1: 统一审核队列角标统计口径

**Files:**
- Modify: `payload-office-platform/tests/admin-navigation-badges.test.ts`
- Modify: `payload-office-platform/src/domain/admin-navigation/navigation-badges.ts`
- Create: `specs/work-items/OPT-023-review-queue-badge-consistency.md`
- Create: `artifacts/verification/OPT-023/README.md`

**Interfaces:**
- Consumes: `buildReviewCityScopeWhere(permission, field)` 和 `buildAdminNavigationBadgeQueries(permission, asOf)`。
- Produces: `listingReviews` badge query `{ collection: 'listings', where: reviewStatus=pending + building.city scope }`。

- [x] **Step 1: Write the failing regression expectations**

```ts
expect(queryByKey(queries, 'listingReviews')).toMatchObject({
  collection: 'listings',
  where: { reviewStatus: { equals: 'pending' } },
})

expect(queryByKey(cityScopedQueries, 'listingReviews').where).toEqual({
  and: [
    { reviewStatus: { equals: 'pending' } },
    { 'building.city': { in: [11, 12] } },
  ],
})
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `cd payload-office-platform && pnpm exec vitest run tests/admin-navigation-badges.test.ts`

Expected: FAIL because the implementation still queries `listing-reviews.taskStatus` through `listing.building.city`.

- [x] **Step 3: Implement the minimal query change**

```ts
collection: 'listings',
where: combineWhere(
  { reviewStatus: { equals: 'pending' } },
  buildReviewCityScopeWhere(permission, 'building.city'),
),
```

Add `'listings'` to `AdminNavigationBadgeQuery['collection']` and remove the now-unused `'listing-reviews'` member.

- [x] **Step 4: Run focused and navigation regression tests**

Run: `cd payload-office-platform && pnpm exec vitest run tests/admin-navigation-badges.test.ts tests/admin-navigation-endpoint.test.ts tests/admin-navigation-config.test.ts`

Expected: PASS with no snapshots or suppressions changed.

- [ ] **Step 5: Verify type, build, data, and browser behavior**

Run: `cd payload-office-platform && pnpm exec tsc --noEmit --pretty false && pnpm build`

Expected: both commands exit 0. Query local Payload/PostgreSQL counts to confirm current pending listings are zero while historical review events remain intact, then open `/admin/collections/listing-reviews` and confirm an empty queue has no badge and no new console error.

- [x] **Step 6: Record evidence without committing**

Update `specs/work-items/OPT-023-review-queue-badge-consistency.md` and `artifacts/verification/OPT-023/README.md` with commands, results, browser route, data check, and remaining risks. Do not run `git commit` or `git push` without a new explicit user confirmation.
