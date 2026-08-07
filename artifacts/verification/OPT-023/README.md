# OPT-023 验证证据

日期：2026-08-07

## 变更

- `listingReviews` 导航角标从 `listing-reviews.taskStatus in [pending, processing]` 切换为 `listings.reviewStatus = pending`。
- 城市范围字段从历史事件关系路径 `listing.building.city` 切换为队列使用的当前房源路径 `building.city`。
- 未执行数据库写入、迁移、历史事件修改或删除。

## TDD

基线：

```text
pnpm exec vitest run tests/admin-navigation-badges.test.ts
13 passed / 0 failed
```

修改预期后的 RED：

```text
2 failed / 11 passed
失败差异准确显示旧 collection=listing-reviews、taskStatus 和 listing.building.city。
```

实现后的 GREEN：

```text
pnpm exec vitest run tests/admin-navigation-badges.test.ts tests/admin-navigation-endpoint.test.ts tests/admin-navigation-config.test.ts
3 files passed / 26 tests passed

pnpm exec vitest run tests/admin-navigation-*.test.ts
9 files passed / 73 tests passed
```

## 静态与构建

```text
pnpm exec tsc --noEmit --pretty false
exit 0

NEXT_PUBLIC_SITE_URL=https://example.com pnpm build
exit 0；编译、TypeScript、静态页面和路由生成均成功
```

首次直接运行 `pnpm build` 在 `/robots.txt` 数据收集阶段因本地缺少生产必填变量 `NEXT_PUBLIC_SITE_URL` 退出；按项目错误提示为验证命令注入 URL 后通过。Node 当前为 v24.14.0，项目声明 22.x，pnpm 输出 engine warning，但未影响测试、类型或构建结果。

## 数据口径

对 `.env.local` 指向的本地 PostgreSQL 执行只读计数：

```text
current_pending_listings=0
open_review_events=2097
all_review_events=4194
```

结论：新角标应为 0；2,097 条历史提交事件继续保留，不再污染当前队列角标；审核历史总量仍为 4,194。

## 服务与浏览器

生产构建与开发服务共用 `.next` 导致现有标签出现旧 CSS chunk 的 Turbopack HMR 报错。已重启开发服务消除该验证副作用：

```text
http://localhost:3717/api/health
status=ok, payload=ok, db=ok
```

应用内浏览器访问 `/admin/collections/listing-reviews` 时后台会话已过期，服务重定向至登录页。未读取浏览器凭据、未修改密码、未伪造会话，因此以下视觉项仍待有效登录后复验：

- 审核队列表格为空。
- “审核队列”菜单不显示角标。
- 有效登录后的目标页与相邻后台页无新增控制台错误。
