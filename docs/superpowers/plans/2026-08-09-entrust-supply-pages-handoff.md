# 交接文档：委托找房 / 投放房源双落地页

> 最后更新：2026-08-10。本文档记录最终交付状态；实施细节以 `2026-08-09-entrust-supply-pages.md` 和 git 历史为准。

## 当前结论

12 个计划任务已在本地分支全部完成并通过最终验收。`/entrust` 与 `/publish` 均已实现为静态落地页，公开提交链路、权限、幂等、通知重试、埋点、sitemap、迁移和永久 E2E 已闭环。

- 分支：`claude/delegated-search-listing-pages-7eeeef`
- 工作树：`E:\github\sbh\.claude\worktrees\delegated-search-listing-pages-7eeeef`
- 最终代码提交：`95288fc fix(supply): 收紧角色分页边界`
- 远端状态：未 push、未创建 PR、未部署（需要用户明确授权）

## 任务状态

| 任务 | 状态 | 主要提交 |
|---|---|---|
| Task 1 导航与页脚 | ✅ 完成 | `3b29379` |
| Task 2 投放房源纯函数 | ✅ 完成 | `73d30fc` |
| Task 3 集合与初始迁移 | ✅ 完成 | `5836f1c` |
| Task 4 公开提交端点 | ✅ 完成 | `c00a8bf` |
| Task 5 entrust 来源与无姓名兜底 | ✅ 完成 | `469f08d` |
| Task 6 落地页骨架组件与样式 | ✅ 完成 | `64a6355` |
| Task 7 `/entrust` | ✅ 完成 | `4b7ba79` |
| Task 8 `/publish` | ✅ 完成 | `0280cbb` |
| Task 9 站内通知 | ✅ 完成 | `e40ad32`，后由 Task 12 加固为持久任务 |
| Task 10 转化漏斗埋点 | ✅ 完成 | `26772cc` |
| Task 11 sitemap | ✅ 完成 | `56827f9` |
| Task 12 E2E、构建、迁移与安全收口 | ✅ 本地完成 | `aeabd68`..`95288fc` |

## Task 12 收口提交

- `aeabd68`：抽离限流测试状态，消除 Route Handler 非法导出与迁移数量阻断。
- `e0b5e5d`：增加双落地页永久 Playwright E2E 与可覆盖的探活 URL。
- `1c1dd34`：E2E 同时捕获开发 ConsoleAdapter 和生产 DataLayerAdapter。
- `6085f30`：以不含 PII 的 sessionStorage 指纹在刷新后复用业务幂等 requestId。
- `e76e9be`：集合匿名 create fail-closed、角色权限矩阵、转换双权限和追加式角色迁移。
- `adcb35c`：以 DomainEvent + Payload Jobs 持久化通知任务，增加历史重复预检与回滚守卫。
- `83dbf77`：通知逐个使用独立事务，23505 仅在精确回查确认后视为幂等成功。
- `6413682`：分页读取全部 active roles，最终收件人仍稳定限制为前 50。
- `95288fc`：拒绝陈旧页、跳页、自环及满页缺元数据，避免漏角色或无限循环。

## 最终验证证据

- Vitest：168 files / 2552 tests passed。
- TypeScript：`pnpm typecheck` exit 0。
- ESLint：0 errors，18 条既有 warnings。
- 永久 Playwright：生产 `next start`、DataLayerAdapter，8/8 passed；包含两条真实 POST、响应式/无障碍关键路径、严格 console/pageerror 与埋点无 PII 断言。
- Webpack production build：exit 0；`/entrust`、`/publish` 均为 `○ Static`。
- 迁移状态：37 code / 37 applied / 0 pending。
- 迁移 dry-run：0 BLOCK，2 条既有 location 类型变更 warning。
- 迁移 verify：151 checks / 0 fail / 13 条既有缺 JSON warning。
- 通知恢复真实烟测：队列写入失败时 submission/event/job 同事务回滚；通知失败后任务重试并只生成一条通知，成功任务行按 Payload 行为删除。
- 本地端口：3719 已停止；主工作树 3717 未触碰。

## 已知限制与上线前事项

1. 默认 `pnpm build` 的 Turbopack 在当前 Windows 深 worktree 中仍因 pnpm 深路径解析产生既有 module-not-found；同一代码的 `next build --webpack` 完整通过。这是环境限制，不是业务或类型错误。
2. 旧 Payload 生成迁移的标准 `down` 受已有枚举数据与删除顺序限制。遵守“生成迁移正文不手改”约束，现以 `pnpm rollback:supply:preflight` 对 8 类数据 fail-closed。该项状态是 **MITIGATED**，不得声称可直接 `migrate:down`；如确需回滚，必须走受控 DBA 流程。
3. `landing-config.ts` 中运营数字与品牌短标签仍需上线前确认真实、可辩护口径。
4. 当前通知最终收件人上限为稳定排序后的前 50 名，这是既定防爆规格；active roles 会完整分页读取，不再受 100 个角色限制。
5. 本地隔离库仅有一个有效通知用户，因此未制造持久双收件人夹具；独立事务与部分补投边界由红绿单测覆盖，真实数据库烟测覆盖单收件人失败恢复。

## 授权后的远端动作

当前不再需要代码修改。若用户决定发布，按顺序执行：

1. 再确认 `git status --short` 为空。
2. `git push -u origin claude/delegated-search-listing-pages-7eeeef`。
3. 创建 draft PR，正文注明上面的运营占位与回滚限制。
4. 合并/部署前在目标 PostgreSQL 副本运行迁移 dry-run、verify 和 rollback preflight；不要直连生产做试验。

未经明确授权，不执行上述 push、PR 或部署动作。
