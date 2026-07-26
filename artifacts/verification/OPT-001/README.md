# OPT-001 验证证据

## 变更

- `listing-reviews` 读取要求同时具备审核菜单、`listing:review` 操作权限及 global/city 数据范围。
- city 范围在服务端转换为 `listing.building.city` 查询条件。
- 审核队列在查询前拒绝无权限用户，并对待审核房源应用 `building.city` 服务端条件。
- 外部 Collection create/update/delete 全部关闭；可信领域服务仍可显式使用 `overrideAccess`。

## 自动验证

- `pnpm exec vitest run tests/listing-review-access.test.ts`：6/6 通过。
- `pnpm typecheck`：通过。
- `pnpm test`：93 个测试文件、1868 个测试全部通过。
- `pnpm build`：Next.js 生产构建通过。

当前本机为 Node.js 24.14.0，项目声明 Node.js 22.x；命令产生 engine 警告但未影响本轮测试和构建。部署验收仍应使用项目声明的 Node.js 22.x。

## 边界

任务认领、自审限制和撤回规则属于 OPT-003；审核、发布、审计和事件的真实事务属于 OPT-002。本项不将这两项标记为完成。
