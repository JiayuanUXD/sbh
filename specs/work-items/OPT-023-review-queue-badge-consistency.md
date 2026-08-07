# Task Packet：OPT-023 审核队列角标一致性

> 状态：进行中（浏览器登录后待复验）  
> 创建日期：2026-08-07  
> 最后更新：2026-08-07

## 1. 目标

让审核队列侧栏角标与页面统一统计当前待审核房源，消除角标 `99+` 但页面为空的不一致。

## 2. 非目标

- 不修改审核状态机、队列交互或 `99+` 展示规则。
- 不修改、删除或回填不可变审核历史。

## 3. 权威上下文

- 页面 PRD：`docs/prd/后台管理系统_MVP_页面PRD/03_房源管理/02_房源审核_PRD.md`
- Design：`docs/superpowers/specs/2026-08-07-review-queue-badge-consistency-design.md`
- Agent：`payload-office-platform/.agent/core.md`、`backend.md`、`permissions.md`、`supply.md`、`testing.md`

## 4. 当前行为与证据

- 复现路径：登录后台，进入“审核与风控 → 审核队列”。
- 当前结果：角标显示 `99+`，表格为空。
- 根因：角标统计 2,097 条历史 `submit/pending` 审核事件；页面统计当前 `reviewStatus=pending` 房源，数量为 0。
- 期望结果：页面为空时角标不显示。

## 5. 影响范围

- 预计修改文件：导航角标领域查询及其测试。
- 数据模型/迁移：无。
- 权限：保留城市范围，字段路径与队列统一为 `building.city`。
- API/路由：响应合同和路由不变，仅数值口径变化。
- 风险：角标查询由审核历史 Collection 转至房源 Collection；需验证访问控制和构建。

## 6. 实施清单

- [x] 建立失败测试或可复现用例。
- [x] 实现最小完整闭环。
- [ ] 验证权限、类型、构建、数据和浏览器路径（自动化、类型、构建和数据已通过；浏览器因登录态过期待复验）。
- [x] 更新文档与任务状态。

## 7. 验收

- 对应 PRD条款：审核历史不可变；审核状态与审核任务状态分离。
- 自动化测试：导航角标领域与 endpoint 回归测试。
- 浏览器路径：`/admin/collections/listing-reviews`。
- 数据/迁移检查：待审核房源为 0 时角标为 0；审核历史记录总量不变；无迁移。

## 8. 结果

- 修改文件：`navigation-badges.ts`、`admin-navigation-badges.test.ts` 及 OPT-023 文档。
- 实际结果：角标改为统计 `listings.reviewStatus=pending`，城市范围改为与队列相同的 `building.city`。
- 验证摘要：导航测试 73/73、TypeScript、生产构建、数据库口径和服务健康检查通过；浏览器访问被重定向到登录页，待用户登录后复验视觉结果。
- 详细证据：`../../artifacts/verification/OPT-023/README.md`
- 剩余风险：尚未在有效后台会话中确认角标视觉消失；代码路径与 endpoint 合同已有自动化覆盖。
- 下一步：用户登录后台后刷新审核队列，确认空队列不显示角标。
