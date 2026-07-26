# Task Packet：DOC-CTX-001 项目上下文优化

> 状态：已完成  
> 创建日期：2026-07-26  
> 最后更新：2026-07-26

## 1. 目标

降低前后台开发任务的默认上下文体积，同时保留业务不变量、任务状态和验证可追踪性。

## 2. 非目标

- 不修改产品需求、状态机、权限和数据口径。
- 不修改业务代码、数据库或已完成任务状态。

## 3. 权威上下文

- 根级 `payload-office-platform/AGENTS.md`
- 前台 `payload-office-platform/FRONTEND_AGENT.md`
- `specs/backend-mvp/tasks.md`
- `specs/frontend-mvp/tasks.md`

## 4. 影响范围

- 将 Agent 长文档拆为路由入口和按需专项规则。
- 将前后台 Tasks 拆为索引和里程碑文件。
- 新增 Task Packet 与验证证据模板。

## 5. 结果

- 根级 Agent 改为上下文路由入口。
- 前台 Agent 改为轻量入口。
- 新增 `payload-office-platform/.agent/` 七个专项规则文件。
- 后台 M0–M8、前台 F0–F7 分文件维护，复选框状态保留。
- 新增 `specs/work-items/TEMPLATE.md`。
- 新增 `artifacts/verification/README.md`。

## 6. 验证

- UTF-8 和 Markdown 链接检查。
- 里程碑任务总数、完成数和索引摘要一致性检查。
- `git diff --check`。

