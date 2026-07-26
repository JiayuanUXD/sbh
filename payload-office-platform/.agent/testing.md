# 测试、浏览器与完成规则

## 静态与自动化

按影响范围执行：

```bash
pnpm exec payload generate:types
pnpm exec payload generate:importmap
pnpm exec tsc --noEmit --pretty false
pnpm test
pnpm build
```

- 未改 Collection/Global 可省略类型生成。
- 未改后台组件注册可省略 import map。
- 不删除、跳过失败测试或新增 suppress。
- PostgreSQL 专属约束必须在 PostgreSQL 验证。

## 浏览器

页面、路由、表单、权限或状态变化必须真实浏览器验证：

- 目标路由、一个相邻路由和控制台。
- 前台视口：375×812、768×1024、1440×900、1920×1080。
- 后台 Custom View：light/dark、空、错、无权和正常。
- 记录路由、操作、预期、实际、截图/日志和未验证项。

## 可访问性与性能

- 前台目标 WCAG 2.2 AA；全键盘完成核心流程。
- Modal/Drawer 具焦点锁定、Esc、焦点归还和背景隔离。
- 触控目标 ≥44px，颜色不是唯一表达。
- 移动 p75 目标：LCP ≤2.5s、INP ≤200ms、CLS ≤0.1。

## 证据

详细输出存入 `artifacts/verification/<task-id>/README.md`。Tasks 仅保存状态、短结论和相对链接，禁止粘贴长日志。

## 完成定义

只有以下全部成立才能勾选：

- 用户结果符合对应 PRD。
- 服务端权限、状态机和数据范围正确。
- 关键正常、异常、越权、并发路径有测试。
- 类型、相关测试、构建通过。
- 浏览器目标和相邻流程通过，无新增控制台错误。
- 迁移/数据变化有 PostgreSQL 证据和回滚说明。
- 任务包、Tasks 状态、风险和未验证项已更新。

无法执行的验证必须逐项报告，不能笼统声称完成。

