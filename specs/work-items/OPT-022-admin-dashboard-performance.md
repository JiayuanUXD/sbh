# Task Packet：OPT-022 后台登录后工作台性能优化

> 状态：已完成
> 创建日期：2026-08-07
> 最后更新：2026-08-07

## 1. 目标

消除后台 Dashboard 有效供给统计的 N+1 查询，并让统计异步加载、不阻塞登录后的后台框架。

## 2. 非目标

- 不增加缓存、预聚合或数据迁移。
- 不改变有效供给、权限、Dashboard 指标含义和候选上限。

## 3. 权威上下文

- 页面 PRD：`docs/prd/后台管理系统_MVP_页面PRD/README.md` 的工作台入口。
- Agent：`payload-office-platform/.agent/core.md`、`backend.md`、`permissions.md`、`testing.md`。

## 4. 当前行为与证据

- 复现路径：后台登录成功后进入 `/admin`。
- 当前结果：登录接口约 138ms，随后 `/admin` 应用代码约 23.5s。
- 期望结果：后台框架不等待统计；500 个候选的关系查询由 500 次串行收敛为一次批量查询。
- 修改前证据：独立测量 500 个候选总计约 6.3s，其中串行关系查询约 5.8s。

## 5. 影响范围

- 预计修改文件：有效供给快照、公开供给适配器、Dashboard 统计服务/接口/组件、配置和测试。
- 数据模型/迁移：无。
- 权限：接口继续要求登录，统计 Local API 继续携带 `req` 且不扩大 access。
- API/路由：新增 `GET /api/dashboard-stats`。
- 缓存/事件：无。
- 风险：客户端错误态、批量关系分组、重叠关系 fail-closed、开发环境 Node 24 与声明 Node 22 不一致。

## 6. 实施清单

- [x] 建立失败测试或可复现用例（聚焦 Vitest 覆盖批量解析、统计、接口和 Widget 合同）。
- [x] 实现共享批量有效供给解析（500 候选本地 PostgreSQL 实测为 1 次关系 Local API 查询）。
- [x] 实现统计服务、鉴权接口和异步 Widget。
- [x] 验证权限、重叠关系、加载与错误边界（匿名 401、异常通用 500、重叠/畸形关系 fail-closed，以及真实浏览器 loading/error/retry/恢复成功态已验证；无权但已登录角色矩阵仍列为剩余限制）。
- [x] 更新验证证据与任务状态。

## 7. 验收

- 自动化测试：批量有效供给、统计服务、接口鉴权、Widget 合同、全量 Vitest。
- 静态检查：TypeScript、生产构建。
- 浏览器路径：`/admin`，成功/加载/错误态与控制台。
- 数据/迁移检查：无迁移；对本地 PostgreSQL 做查询次数与耗时测量。

## 8. 结果

- 修改文件：有效供给批量解析、Dashboard 统计服务/端点、异步 Widget 与对应测试（详见 Git diff）。
- 实际结果：500 个候选的关系解析在本地 PostgreSQL 上由逐项查询收敛为 1 次关系 Local API 查询，resolver 三次实测为 146.21–161.94 ms；后台 shell 不再同步执行统计。
- 验证摘要：最终复核后聚焦 36/36、全量 Vitest 2,363/2,363、typecheck、相关文件 scoped ESLint 通过；Node 22.23.2 下全量测试、typecheck、lint 和 build 通过。build 仅以内联本地非敏感 `NEXT_PUBLIC_SITE_URL=http://localhost:3717` 验证编译/静态生成，不验证生产配置或部署。未认证 Dashboard stats 实测 401；认证本地 `/admin` 的 loading、受控错误/重试和恢复成功态均通过且无控制台 error。
- 详细证据：`../../artifacts/verification/OPT-022/README.md`
- 剩余风险：默认交互式开发服务仍运行在 Node 24；无权但已登录角色、viewport/light-dark 完整矩阵、生产配置/部署和生产环境性能基准尚未完成。
- 下一步：在 Node 22 CI/目标部署环境复现质量门，并在冷启动、代表性网络和角色矩阵下复测端到端性能。
