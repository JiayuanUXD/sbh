# 前台开发 Agent 入口

本文件是 C 端公开站的轻量入口。涉及 `app/(frontend)`、`components/frontend`、`domain/public-catalog`、公开 SEO/sitemap、缓存或 `/api/inquiries` 时读取。

## 必读

1. 根级 [`AGENTS.md`](./AGENTS.md)
2. [`.agent/frontend.md`](./.agent/frontend.md)
3. [`.agent/testing.md`](./.agent/testing.md)
4. 当前前台 Task Packet
5. 对应的一份页面 PRD

## 条件读取

- 房源、楼盘、facet、推荐、内容引用、sitemap：读取 [`.agent/supply.md`](./.agent/supply.md)。
- 咨询到 Lead、脱敏或后台数据权限：读取 [`.agent/permissions.md`](./.agent/permissions.md)。
- Collection/Lead 字段或数据库约束变化：读取 [`.agent/migrations.md`](./.agent/migrations.md)。

## 前台不可协商规则

- React 页面和组件只消费 Public Catalog DTO，不接收原始 Payload 文档。
- Server Components 为默认；只把必要交互变为 Client Component。
- URL 表达筛选状态，不用全局客户端状态复制 URL。
- 所有公开供给消费者复用唯一有效供给服务，禁止旧 `status=available` 或简化谓词降级。
- 价格必须携带币种、租售类型、周期和单位；不可跨单位聚合/排序。
- 禁止 shadcn-ui、Tailwind reset、全局第三方 reset 和通用后台式前台视觉。
- 咨询请求使用 schema、同源/CSRF、持久化幂等、共享限流和隐私版本。
- 日志、埋点、监控和公开 DTO 不得暴露姓名、完整手机号、留言、原始 IP 或内部状态。
- 视觉实现遵循已确认 Design，不临时发明第二套配色、字体或布局系统。
- 四档视口、键盘、控制台、目标页和相邻页验证完成前不得声称完成。

详细规则只在需要时从 `.agent/` 读取，不要重新加载旧版长 Agent 文档。

