# 测试、浏览器与完成规则

## 静态与自动化

按影响范围执行：

```bash
pnpm generate:types
pnpm payload generate:importmap
pnpm typecheck
pnpm test
pnpm migrate:dry-run
pnpm build
```

顺序与 `.github/workflows/quality.yml` 一致，本地按此自检可避免只在 PR 才暴露的失败。

- 未改 Collection/Global 可省略类型生成；但生成前确认 `.env.local` 有占位 `COS_*`，否则会静默删掉 `Media.prefix`。
- 未改后台组件注册可省略 import map；改了没重生成 → `/admin` 整站 hydration 白屏（资源全 200）。
- 未改 `src/migrations/` 可省略 `migrate:dry-run`。
- 不删除、跳过失败测试或新增 suppress。
- PostgreSQL 专属约束必须在 PostgreSQL 验证。

## 浏览器与 UI 验收铁律

页面、路由、表单、权限或状态变化必须在真实浏览器中验证，**严禁仅凭静态代码推断**：

- **目标路由与环境**：目标路由、一个相邻路由和控制台；
- **前台视口**：375×812、768×1024、1440×900、1920×1080；
- **后台深浅色与微观色值对账（反“全局盲视”）**：
  - 严禁仅看“大背景是否变黑”就过关；
  - 必须逐个审查微观控件：输入框、下拉选框（Select）、Radio/Tab 切换条、Tag 徽标、空状态（Empty）底色是否符合 `--theme-elevation-*`，严禁在 Dark Mode 下残留 `#FFFFFF` 白底；
  - 必须通过脚本或点击主动触发**展开态（Dropdown Popup、Modal、Tooltip、Popconfirm）**，截取展开状态并核验浮层是否完成深色适配。
- **表单与持久化三步铁证（反“内存自嗨”）**：
  - **第 1 步 抓包核验**：拦截实际发出的 `POST/PATCH` 请求体（Request Payload），核验所有字段与嵌套数组行数据是否完整序列化并提交；
  - **第 2 步 状态码与响应核验**：确认服务端返回 `200/201` 且响应中的 Document 包含正确的最新持久化结构；
  - **第 3 步 强刷重载核验**：执行完整页面刷新（`page.goto` / `page.reload`），重新进入目标 Tab/区域，核验 DOM 回显与数量是否 100% 保持，杜绝删图残留或调序瞬态复原。
- **复杂拖拽与交互隔离**：
  - 存在拖拽（Drag & Drop）的容器，所有子控件（按钮、下拉框、删除确认、链接）必须显式阻止冒泡（`stopPropagation`）或做 target 过滤，严禁让拖拽手势劫持点击事件；
  - 自定义 array 字段组件的本地 state **只能作展示投影**，增删改序一律走 Payload 行级 action（`addFieldRow` / `removeFieldRow` / `moveFieldRow`，以及针对 `<path>.<行号>.<子字段>` 的 `UPDATE`）。**严禁用 `setValue` 往 array 父路径写整个数组**——Payload 对有行的 array 会设 `disableFormData=true`，该路径提交时被整体跳过，写进去的内容根本不会落库（真实教训：新上传的媒体在已有媒体的楼盘上静默丢失）。

## 可访问性与性能

- 前台目标 WCAG 2.2 AA；全键盘完成核心流程。
- Modal/Drawer 具焦点锁定、Esc、焦点归还和背景隔离。
- 触控目标 ≥44px，颜色不是唯一表达。
- 移动 p75 目标：LCP ≤2.5s、INP ≤200ms、CLS ≤0.1。

## 证据

详细输出（长日志、截图等）存入 `../artifacts/verification/<工作项编号>/` 或 PR 描述，禁止粘贴长日志到 Tasks。

## 完成定义

只有以下全部成立才能勾选与汇报完成：

- 用户结果符合工作项（`../specs/work-items/`）声明的验收标准；无工作项时符合本会话确认的目标。
- 服务端权限、状态机和数据范围正确。
- 关键正常、异常、越权、并发路径有测试。
- 类型（`pnpm typecheck`）、相关测试、构建通过。
- 浏览器目标和相邻流程通过，具备**抓包 Request Payload、刷新回显 DOM 与深色展开态截图**三重铁证，无新增控制台错误。
- 迁移/数据变化有 PostgreSQL 证据和回滚说明。
- 任务包、Tasks 状态、风险和未验证项已更新。

无法执行的验证必须逐项报告，严禁在无真实证据前笼统声称完成。

