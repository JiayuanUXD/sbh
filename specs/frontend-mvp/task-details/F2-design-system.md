# 前台任务：F2：全局视觉系统与页面外壳

> 返回：[任务索引](../tasks.md)

## 4. F2：全局视觉系统与页面外壳

- [x] 2.1 实现视觉 token 与字体
  - 落地已确认的颜色、字体、字号、间距、栅格、圆角、阴影和动效 token。
  - 使用字体子集和有限字重，配置系统回退。
  - 实现 light 视觉基线和 `prefers-reduced-motion`；MVP 不强制前台 dark。
  - _Requirement: R1, R10；Design: §6_

- [x] 2.2 实现响应式站点框架
  - 建立全局 Header、主导航、城市入口、移动菜单、Footer 和内容容器。
  - 保证 skip link、键盘导航、焦点样式和语义 landmark。
  - 当前单城市不可制造无效选择流程。
  - _Requirement: R1；Page PRD: FP-01 §3.1_

- [x] 2.3 建立公开 UI 基础组件
  - 实现 Button、Link、Field、Select、Tag、Price、Media、Breadcrumb、EmptyState、ErrorState、Skeleton 和 Modal/Drawer 原语。
  - 不引入 shadcn-ui；必要交互原语必须满足无障碍要求。
  - 统一 loading、disabled、focus、error 和 reduced-motion 状态。
  - _Requirement: R1–R8, R10；Design: §6, §13, §14_

- [x] 2.4 实现房源卡片
  - 使用 `ListingCardViewModel`，不接收 Payload 文档。
  - 展示固定比例媒体、楼盘/区域、面积、类型、标准化价格和最多三个亮点。
  - 完整卡片可点击且保留语义化链接、键盘焦点和图片失败状态。
  - _Requirement: R4；Page PRD: FP-02 §4.1_

- [x] 2.5 建立 Story/fixture 状态走查页
  - 展示长标题、无图片、极值价格、三种租金单位、出售、无亮点、加载、空和错误状态。
  - 该页面仅开发环境可用，不进入公开 sitemap。
  - _Requirement: R10；Design: §15.4_

### F2 验收门

- [x] 四档视口下全局框架无溢出、遮挡和不可达操作。
- [x] 组件状态满足键盘、对比度和减少动效要求。
- [x] 前台依赖中不存在 shadcn-ui 或全局第三方 reset。
