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
- 房源 / 楼盘编辑页统一是**两个 tab**（录入项 + 展示内容）+ `ui` 分节标题（`ListingFormSectionHeading`，
  两张表共用）+ 固定列轴（基本信息节 33.333%、其余 25%、textarea 100%，row 子字段必须给 `admin.width`）
  + `.collection-edit--{listings,buildings}` 作用域内去组框。守卫：`tests/{listing,building}-form-layout.test.ts`。
  分节不用 collapsible（折叠态持久化到 preferences，收起后字段找得到却不可见）。
- ★ **后台走查陷阱**：Payload 的 `RenderFields` 套着 `RenderIfInViewport`，**没滚进视口的字段不渲染**
  （group 的 `.render-fields` 在折下时是空的）。DOM 探针 / 整页截图前必须把页面滚一遍，否则会把懒加载
  误判成「组内字段没渲染」（OPT-102 走查踩过，靠旧配置对照才发现是视口问题）。

## Payload

- 自定义组件从 `@payloadcms/ui` 使用版本匹配能力。
- 组件通过 `payload.config.ts` 注册，不手工编辑生成 import map。
- 修改 Collection/Global 后生成类型；修改组件注册后生成 import map。
- Server Components 使用 Local API，不绕行自身 REST。
- 核心逻辑不依赖社区 UI 插件。

## 后台完成门

- 页面符合对应工作项（`../specs/work-items/`）的验收标准。
- 菜单、操作、数据和字段权限均在服务端验证。
- 正常、空、错、无权、并发和版本冲突均有表现。
- 导入导出继承筛选、权限、脱敏并留审计。
- 高风险写入、事件和审计位于同一事务或可靠编排。

