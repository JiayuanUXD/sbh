# Task Packet：AUDIT-001 供给与公开页面完成度审查

> 状态：进行中
> 创建日期：2026-07-26
> 最后更新：2026-07-26

## 1. 目标

只读核验后台 M4、前台 F1/F3/F4 的真实完成度，并对已完成代码进行质量审查，输出证据化报告与优化任务。

## 2. 非目标

- 不修改业务代码、迁移、任务复选框或产品需求。
- 不审查 M5/F5 咨询 CRM 闭环及 M6–M8/F6–F7 的全部实现。

## 3. 权威上下文

- Tasks：`specs/backend-mvp/task-details/M4-listing-review-supply.md`
- Tasks：`specs/frontend-mvp/task-details/F1-public-catalog.md`
- Tasks：`specs/frontend-mvp/task-details/F3-home-list.md`
- Tasks：`specs/frontend-mvp/task-details/F4-details.md`
- 页面 PRD：后台房源列表/审核/举报；前台首页/列表/房源详情/楼盘详情。
- Agent：core、backend、frontend、supply、permissions、migrations、testing。

## 4. 审查方法

- 任务状态与代码、测试、迁移和运行证据逐项比对。
- 完成判定：已完成 / 部分完成 / 未完成 / 被依赖阻塞 / 状态标记错误。
- 问题等级：P0–P3。
- 先只读审查，再独立提出优化任务。

## 5. 验证范围

- 静态：类型逃逸、旧查询、简化谓词、重复口径、敏感字段。
- 自动化：相关测试、全量测试、类型检查、生产构建。
- 数据：迁移、枚举、关系约束、有效供给条件。
- 浏览器：首页、列表、有效/失效详情、楼盘详情和控制台。

## 6. 结果

- 报告：`docs/reviews/2026-07-26/supply-public-frontend-audit.md`
- 优化清单：`docs/reviews/2026-07-26/optimization-backlog.md`
- 详细证据：`artifacts/verification/AUDIT-001/README.md`
