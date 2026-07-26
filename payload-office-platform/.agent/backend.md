# Payload 后台专项规则

## 实现优先级

优先使用 Payload 原生 Collection、Field、Access、Hook、Local API 和 Custom View。业务动作使用明确 endpoint/领域服务，不让客户端组合多次写入模拟事务。

## UI

- Payload 原生表单、主题和交互语义为主。
- Arco Design 仅用于 Dashboard、图表、指标和 Payload 原生能力不足的复杂区域。
- Arco 样式限制在明确命名容器内，不覆盖 Payload 全局 token。
- Light/Dark 通过 Payload `useTheme`。
- 禁止 shadcn-ui、Tailwind reset 和全局第三方 reset。
- Custom View 支持中文、暗色、空、错和无权限状态。
- 长表单使用 Tabs、Row、Collapsible 和侧栏分组，不改变字段路径。

## Payload

- 自定义组件从 `@payloadcms/ui` 使用版本匹配能力。
- 组件通过 `payload.config.ts` 注册，不手工编辑生成 import map。
- 修改 Collection/Global 后生成类型；修改组件注册后生成 import map。
- Server Components 使用 Local API，不绕行自身 REST。
- 核心逻辑不依赖社区 UI 插件。

## 后台完成门

- 页面符合对应 16 章页面 PRD。
- 菜单、操作、数据和字段权限均在服务端验证。
- 正常、空、错、无权、并发和版本冲突均有表现。
- 导入导出继承筛选、权限、脱敏并留审计。
- 高风险写入、事件和审计位于同一事务或可靠编排。

