# 后台任务：M0 工程与数据基线

> 返回：[任务索引](../tasks.md)

## M0 工程与数据基线

- [x] 0.1 建立开发基线
  - 固定 Node、pnpm、Payload、Next.js 和数据库版本。
  - 补充 `.env.example`，区分 SQLite 与 PostgreSQL。
  - 建立 `typecheck / test / build / test:e2e` 持续验证脚本。
  - 保存当前数据库 schema、记录数和关键对象样本。
  - _Requirement: R8_

- [x] 0.2 建立领域目录和公共类型
  - 新建 `src/domain/{auth,geography,supply,review,report,crm,workflow,analytics,audit}`。
  - 定义领域错误、操作结果、版本冲突和幂等请求类型。
  - 建立统一北京时间、手机号、价格和有效期工具。
  - _Requirement: R1, R2, R4, R6, R8_

- [ ] 0.3 建立迁移安全框架
  - 为迁移提供 dry-run、执行摘要、校验报告和回滚入口。
  - CI 同时验证新建数据库和已有数据升级。
  - 禁止迁移隐式删除旧字段或将旧房源自动视为审核通过。
  - _Requirement: R3, R4, R6, R8_

- [x] 0.4 建立测试数据工厂
  - 覆盖五种角色、多个城市/团队、启停商户和不同房源状态。
  - 提供时间冻结和 Asia/Shanghai 边界测试能力。
  - 提供 PostgreSQL 有效期关系测试数据。
  - _Requirement: R1–R8_

### M0 验收门

- ✅ 全量 TypeScript 通过（`pnpm typecheck`）。
- ✅ 单元测试 348 项通过（`pnpm test`）。
- ✅ 生产构建通过（`pnpm build`）。
- ⏳ 迁移静态安全检查和本地 SQLite 实库校验通过；PostgreSQL 16 新库与带数据升级路径已加入 CI，待 CI 实际运行后放行。
- ⏳ 前台询价主流程浏览器回归通过；五角色完整 E2E 属于 M1.6，尚未作为 M0 放行依据。
