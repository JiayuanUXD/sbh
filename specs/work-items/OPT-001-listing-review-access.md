# Task Packet：OPT-001 房源审核读取权限

> 状态：已完成
> 创建日期：2026-07-26
> 最后更新：2026-07-26

## 1. 目标

房源审核记录和审核队列必须仅对具备审核菜单、审核操作权限且命中授权城市的数据开放，匿名、无审核权限和跨城市访问必须在服务端被拒绝。

## 2. 非目标

- 本项不实现任务认领、自审限制和撤回身份规则，归入 OPT-003。
- 本项不重构审核/发布事务，归入 OPT-002。
- 销售主管和经纪人的“外显结论”只读 DTO 不在本项开放；在专用脱敏接口完成前保持 fail-closed。

## 3. 权威上下文

- Task：`specs/backend-mvp/task-details/M4-listing-review-supply.md#M4`
- PRD：`docs/prd/后台管理系统_MVP_页面PRD/03_房源管理/02_房源审核_PRD.md#3-用户与权限`
- Agent：`core.md`、`backend.md`、`permissions.md`、`testing.md`

## 4. 当前行为与证据

- `listing-reviews.access.read` 对所有请求返回 true。
- Custom View 使用 `overrideAccess: true` 读取全量待审核 Listing 和历史记录。
- 期望：权限与城市范围由服务端 PermissionContext 派生，客户端参数不得扩大范围。

## 5. 影响范围

- Collection access、审核队列 Server Component、权限纯函数与测试。
- 不改变数据库结构，无迁移。
- 风险：历史上依赖匿名读取 `listing-reviews` 的调用将被拒绝；这是预期安全收口。

## 6. 实施清单

- [x] 建立审核读取权限与城市范围纯函数。
- [x] 收紧 `listing-reviews` Collection access。
- [x] 审核队列按授权城市查询，禁止无权限用户触发数据查询。
- [x] 覆盖匿名、无权限、跨城市、授权城市和管理员路径。
- [x] 完成类型、测试与生产构建验证。

## 7. 验收

- 当匿名或无审核权限用户读取审核记录时，系统应拒绝访问。
- 当运营用户只授权城市 A 时，队列和历史查询应只包含城市 A 的房源。
- 当账号城市范围为空且具备全局审核权限时，系统应允许全局读取。
- 客户端 query/body 不得扩大数据范围。

## 8. 结果

- 已完成。服务端访问规则与审核队列查询均已收口。
- 详细证据：`../../artifacts/verification/OPT-001/README.md`
