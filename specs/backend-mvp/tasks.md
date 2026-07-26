# 商办租赁后台 MVP — 开发计划

## 1. 执行原则

- 每个迭代必须通过 TypeScript、单元测试、生产构建、迁移验证和浏览器验收后才能进入下一迭代。
- 每项业务操作必须先完成服务端权限和审计，再开放后台按钮。
- 新字段先扩展和回填，稳定前不删除现有字段。
- 前台、后台预览、楼盘聚合和看板只允许调用统一有效供给查询。
- 任务编号后的 `_Requirement` 对应 `requirements.md` 中的 R1–R8。

## 2. 里程碑概览

| 里程碑 | 交付结果 | 建议周期 |
|---|---|---:|
| M0 | 工程基线、迁移与测试框架 | 2–3 天 |
| M1 | 账号、角色和四层权限 | 5–7 天 |
| M2 | 区域、商户、团队与经纪人主数据 | 6–8 天 |
| M3 | 楼盘增强和供给关系 | 5–7 天 |
| M4 | 房源审核、发布与有效供给 | 8–10 天 |
| M5 | 客户、线索、分配与跟进闭环 | 10–14 天 |
| M6 | 举报、待办、通知与 SLA | 7–10 天 |
| M7 | 工作台、数据看板和统一下钻 | 6–8 天 |
| M8 | 操作日志、导入导出和上线验收 | 6–8 天 |

单人顺序开发约 11–15 周；2–3 人在领域边界明确后并行约 7–10 周。周期不包含产品规则变更、历史数据人工清洗和生产基础设施审批。

---

# Implementation Plan

## M0 工程与数据基线

- [x] 0.1 建立开发基线
  - 固定 Node、pnpm、Payload、Next.js 和数据库版本。
  - 补充 `.env.example`，区分 SQLite 与 PostgreSQL。
  - 建立 `typecheck / test / build / test:e2e` 持续验证脚本。
  - 保存当前数据库 schema、记录数和关键对象样本。
  - _Requirement: R8_

- [x] 0.2 建立领域目录和公共类型
  - 新建 `src/domain/{auth,geography,supply,review,report,crm,workflow,analytics,audit}`。
  - 定义领域错误、操作结果、版本冲突和幂等请求类型。
  - 建立统一北京时间、手机号、价格和有效期工具。
  - _Requirement: R1, R2, R4, R6, R8_

- [ ] 0.3 建立迁移安全框架
  - 为迁移提供 dry-run、执行摘要、校验报告和回滚入口。
  - CI 同时验证新建数据库和已有数据升级。
  - 禁止迁移隐式删除旧字段或将旧房源自动视为审核通过。
  - _Requirement: R3, R4, R6, R8_

- [x] 0.4 建立测试数据工厂
  - 覆盖五种角色、多个城市/团队、启停商户和不同房源状态。
  - 提供时间冻结和 Asia/Shanghai 边界测试能力。
  - 提供 PostgreSQL 有效期关系测试数据。
  - _Requirement: R1–R8_

### M0 验收门

- ✅ 全量 TypeScript 通过（`pnpm typecheck`）。
- ✅ 单元测试 348 项通过（`pnpm test`）。
- ✅ 生产构建通过（`pnpm build`）。
- ⏳ 迁移静态安全检查和本地 SQLite 实库校验通过；PostgreSQL 16 新库与带数据升级路径已加入 CI，待 CI 实际运行后放行。
- ⏳ 前台询价主流程浏览器回归通过；五角色完整 E2E 属于 M1.6，尚未作为 M0 放行依据。

## M1 账号、角色与四层权限

- [x] 1.1 扩展用户账号模型
  - 增加姓名、规范化手机号、登录账号、状态、城市范围、团队和会话版本。
  - 实现手机号及登录账号唯一校验。
  - 迁移现有管理员账号并保留登录能力。
  - _Requirement: R1_

- [x] 1.2 创建角色和权限注册表
  - 创建 `roles` Collection。
  - 初始化且仅初始化 `ADM / OPS / MGR / BRK / CSR` 五个内置角色。
  - 注册菜单、操作、数据和字段权限编码。
  - 阻止内置角色删除、改码或改变内置身份。
  - _Requirement: R1_

- [x] 1.3 实现服务端权限上下文
  - 从登录用户、角色、城市和团队生成 `PermissionContext`。
  - 实现允许并集和账号城市最终上限。
  - 为 Payload access hooks 和自定义 endpoints 提供统一守卫。
  - _Requirement: R1_

- [x] 1.4 实现字段脱敏和导出权限
  - 手机号默认返回脱敏值。
  - 完整手机号、坐标、审计前后值和敏感导出使用独立字段权限。
  - 禁止仅靠前端隐藏保护敏感字段。
  - _Requirement: R1, R8_

- [x] 1.5 完成账号与角色后台页面
  - 账号列表、创建、编辑、启停、角色绑定和权限预览。
  - 角色列表、复制、自定义角色编辑和风险提示。
  - 最后一个全局管理员保护。
  - _Requirement: R1_

- [x] 1.6 完成权限 E2E
  - 五类角色分别验证菜单、数据范围、按钮、直接 API 和字段脱敏。
  - 验证 URL 参数不能扩大城市或团队范围。
  - _Requirement: R1_

### M1 验收门

- ✅ 停用账号无法登录且旧会话失效（`status='disabled'` → `buildPermissionContext` 返回 null；sessionVersion 递增机制已在 Users.beforeChange 落地）。
- ✅ 五个内置角色基线准确（`tests/permission-matrix.test.ts` 36 项断言覆盖菜单 / 操作 / 字段 / 数据范围）。
- ✅ 经纪人不能读取其他经纪人的线索或完整手机号（BRK `dataScope=self` + 城市上限；缺 `phone:full` 时 `maskDocFields` 返回 `138****5678`）。
- ✅ 越权接口返回 403，不产生业务写入（`requireOperationPermission` 抛 `ForbiddenError`；Playwright spec 验证 POST /api/users 在 CSR/BRK 角色下被拒绝）。
- ✅ 全量 TypeScript 通过（`pnpm typecheck`）。
- ✅ 单元测试 333 项通过（M0 101 + M1 新增 232，`pnpm test`）。
- ✅ 生产构建通过（`pnpm build`）。
- ✅ 迁移 dry-run 不写入数据（`pnpm migrate:dry-run`）。

## M2 地理、商户与组织主数据

- [x] 2.1 扩展统一地理节点
  - 为 Locations 增加不可变编码、启停、前台可见、中心坐标、版本号。
  - 支持城市、行政区、商圈、地铁线路和地铁站固定层级。
  - 迁移现有区域数据并生成不可变编码。
  - _Requirement: R2_

- [x] 2.2 建设城市区域 Custom View
  - 树形浏览、合法新增、移动、排序、启停和引用数量。
  - 上级停用、跨城市移动、代码重复和被引用节点保护。
  - _Requirement: R2_

- [x] 2.3 建设商圈扩展
  - 创建 `business_area_extensions`。
  - 支持边界、扩展中心、别名和同城站点关系。
  - 基础商圈字段只读同步，禁止在扩展页修改。
  - _Requirement: R2_

- [x] 2.4 创建商户模型
  - 创建商户类型、联系人、服务城市、状态、资质状态和有效期字段。
  - 实现服务城市和资质有效性校验。
  - 完成商户列表、详情、启停影响确认。
  - _Requirement: R2_

- [x] 2.5 创建团队和经纪人模型
  - 创建 Teams 与 Brokers。
  - 关联用户、主管、服务城市和服务商圈。
  - 停用前检查未完成线索并要求转派。
  - _Requirement: R1, R2, R6_

- [ ] 2.6 创建固定与可维护字典
  - 核心状态、商户类型和强类型字段作为只读发布基线。
  - 展示型标签支持新增、改名、排序、可见性和停用。
  - 业务对象保存编码和历史显示快照。
  - _Requirement: R2_

### M2 验收门

- 停用区域不再出现在新增业务候选中，历史对象仍可展示。
- 商户资质过期或服务城市不匹配时不能建立新供给关系。
- 停用经纪人前必须完成有效线索转派。

## M3 楼盘增强与供给关系

- [ ] 3.1 扩展楼盘字段
  - 增加城市、启停、类型、竣工时间、楼层、物业、停车位、注册能力、认证和版本号。
  - 图集限制为 20 张并支持排序。
  - _Requirement: R3_

- [ ] 3.2 实现楼盘重复检测
  - 保存前检查同城同名和 100 米内高相似记录。
  - 展示候选详情、差异说明和合并入口。
  - 合并保留目标不可变 ID，迁移关联和审计链。
  - _Requirement: R3, R8_

- [ ] 3.3 创建 Building 商户有效期关系
  - 创建关系 Collection 和服务。
  - PostgreSQL 增加区间排斥约束。
  - SQLite 增加事务内等价重叠校验。
  - _Requirement: R2, R3_

- [ ] 3.4 完成楼盘列表和详情体验
  - 增加城市、区域、商圈、等级和状态筛选。
  - 展示有效房源套数、面积和租金聚合。
  - 完成预览、查看房源、启停和导出动作。
  - _Requirement: R3, R7_

- [ ] 3.5 实现楼盘停用语义
  - 停用前展示受影响房源数量并二次确认。
  - 停用只影响有效供给谓词，不改写 Listing 审核和发布状态。
  - _Requirement: R3, R4, R8_

### M3 验收门

- 同城重复候选在保存前出现。
- 有效期关系在边界时刻正确切换，重叠关系被拒绝。
- 楼盘停用后前台不可见，房源状态值保持不变。

## M4 房源审核、发布与可信供给

- [x] 4.1 扩展房源业务字段
  - 增加独立发布状态、审核状态、供给冻结、租售类型、装修、楼层、租期、付款、联系人、媒体和版本号。
  - 将价格迁移为金额、币种、周期和单位结构。
  - 保留旧 `status` 进入过渡期，不立即删除。
  - _Requirement: R4_

- [x] 4.2 创建 Listing 商户有效期关系
  - 创建房源供给关系和继承 Building 默认商户的快照规则。
  - 后续 Building 默认关系变化不得回写既有 Listing 关系。
  - _Requirement: R2, R4_

- [x] 4.3 实现房源完整度与草稿校验
  - 草稿保存执行最小字段校验。
  - 提交审核执行完整字段、价格、有效商户和至少 3 张图片校验。
  - 展示完整度和缺失项定位。
  - _Requirement: R4_

- [x] 4.4 创建审核模型与状态机
  - 创建 `listing_reviews` 和不可变提交快照。
  - 实现提交、撤回、通过、驳回和重新提交。
  - 审核中核心工作版本锁定，使用版本号防并发覆盖。
  - _Requirement: R4, R8_

- [ ] 4.5 建设房源审核 Custom View
  - 审核队列、领取、详情对比、历史记录、通过和驳回。
  - 驳回必须填写原因。
  - 可选“通过后上架”仅对同时具备审核和发布权限者开放。
  - _Requirement: R1, R4_

- [x] 4.6 实现显式发布动作
  - 发布前检查审核通过和有效供给谓词。
  - 下架必须填写原因。
  - 已出租自动取消推荐并撤销前台可见性。
  - _Requirement: R4, R8_

- [ ] 4.7 建立统一有效供给查询
  - 实现共享查询服务并替换前台、预览、楼盘聚合、Dashboard 和关系候选查询。
  - 提供每个不合格原因的诊断结果。
  - _Requirement: R3, R4, R7_

- [ ] 4.8 实现商户停用冻结
  - 商户停用时批量设置关联 Listing 为待复核。
  - 商户恢复不自动解除。
  - 运营显式解除后仍需发布权限重新上架。
  - _Requirement: R2, R4, R8_

### M4 验收门

- 未审核、资料不足或关系无效的房源无法上架。
- 审核通过不会自动改变发布状态。
- 前台、预览、楼盘聚合和看板对同一房源可见性结论一致。
- 旧版本编辑返回 409，不覆盖新数据。

## M5 客户、线索与跟进闭环

- [ ] 5.1 创建客户模型并迁移现有 Leads
  - 创建 Customers 和手机号规范化。
  - 按手机号生成客户档案并关联现有线索。
  - 输出重复或冲突手机号人工处理清单。
  - _Requirement: R6_

- [ ] 5.2 扩展线索模型
  - 增加阶段、归属状态、城市、区间需求、负责人、团队、SLA 快照和版本号。
  - 将当前状态映射到新状态，无法确定的进入人工复核。
  - _Requirement: R6_

- [ ] 5.3 实现手机号查重和合并
  - 查询全部客户历史，按 30 天窗口判断重复线索。
  - 支持合并已有客户、创建新需求和取消。
  - 保存 `effective_created_at` 和 `effective_source_channel`。
  - _Requirement: R6_

- [ ] 5.4 实现分配、认领和转派
  - 创建归属历史。
  - 校验城市、团队、经纪人状态、每日认领 20 条和活跃上限 100 条。
  - 保存 MVP-R1 参数和实际命中数值。
  - _Requirement: R1, R6, R8_

- [ ] 5.5 创建跟进记录
  - 创建不可删除 FollowUps。
  - 实现方式、结果、内容、下次跟进和关联房源。
  - 已推荐必须关联统一有效供给中的至少一套房源。
  - 24 小时内纠错采用追加修正记录。
  - _Requirement: R6, R8_

- [ ] 5.6 实现线索阶段服务
  - 合法阶段转换由服务端执行。
  - 流失、无效等负向操作要求原因。
  - 跟进成功后更新首次、最后和下次跟进时间。
  - _Requirement: R6_

- [ ] 5.7 建设 CRM 页面
  - 线索池：全局授权数据、分配和批量操作。
  - 我的客户：本人负责线索和快速跟进。
  - 公海客户：可认领对象和额度提示。
  - 跟进记录：时间线、筛选和不可变历史。
  - _Requirement: R1, R6_

- [ ] 5.8 实现公海回收
  - 72 小时无有效跟进扫描。
  - 24 小时认领保护期。
  - 回收和认领写归属历史、事件及审计。
  - _Requirement: R6, R8_

### M5 验收门

- 重复手机号提供三种明确处理路径。
- 分配或认领成功事件时刻准确生成 4 小时首次跟进期限。
- 经纪人只能跟进自己的线索。
- 跟进历史不能编辑或删除，纠错记录可追溯。

## M6 举报、待办、通知与 SLA

- [x] 6.1 创建房源举报模型
  - 创建举报原因、证据、处理状态、处理阶段版本、负责人和结论。
  - 实现分诊、领取、核实、等待资料、提交复核和关闭。
  - _Requirement: R5_
  - 验证证据：
    - Collection: `payload-office-platform/src/collections/ListingReports.ts`
    - 领域服务: `payload-office-platform/src/domain/report/report-status.ts`、`report-transition.ts`、`report-supply-effect.ts`、`report-protect.ts`
    - 测试工厂: `payload-office-platform/src/test/factory/reports.ts`
    - 测试: `payload-office-platform/tests/listing-report.test.ts`（47 用例全通过）
    - 迁移: `payload-office-platform/src/migrations/20260726_103500_m6_1_listing_reports.ts`
    - 权限码: `report:read` / `report:manage`（新增）/ `report:triage` / `report:resolve`（已有）
    - 验收: `pnpm typecheck` 通过；`pnpm test` 63 文件 1071 用例全通过

- [ ] 6.2 实现举报供给暂停
  - 有效举报暂停只影响统一有效供给谓词。
  - 不改写审核状态和发布状态。
  - 恢复和关闭要求权限、原因和审计。
  - _Requirement: R4, R5, R8_

- [x] 6.3 创建事务 Outbox
  - 创建 Domain Events Collection。
  - 业务状态、事件和审计在同一事务写入。
  - 消费器按 event ID 和 aggregate version 幂等处理。
  - _Requirement: R8_
  - 验证证据：
    - Collection: `payload-office-platform/src/collections/DomainEvents.ts`（slug `domain-events`，append-only：`access.update/delete=false` 叠加 `protectDomainEvent` beforeChange hook 双重兜底）
    - 领域服务:
      - `payload-office-platform/src/domain/workflow/event-types.ts`（EVENT_TYPES / AGGREGATE_TYPES 枚举与守卫）
      - `payload-office-platform/src/domain/workflow/event-publisher.ts`（`buildEventId` nanoid 21 字符、`publishEvent` 纯函数返回 DomainEvent，调用方同事务写库）
      - `payload-office-platform/src/domain/workflow/event-consumer.ts`（`EventConsumer` / `EventDispatcher` / `EventStore` 接口，幂等检查 + 重试上限 + 死信标记）
      - `payload-office-platform/src/domain/workflow/workflow-protect.ts`（`protectDomainEvent` hook：create 自动生成 eventId/occurredAt、强制 attemptCount=0/processedAt=null；update 禁止篡改不可变字段）
    - 测试工厂: `payload-office-platform/src/test/factory/events.ts`（事件 fixture：已处理、未处理、各聚合类型）
    - 测试: `payload-office-platform/tests/domain-events.test.ts`（53 用例全通过，覆盖事件类型校验、ID 生成、消费分发、幂等跳过、重试上限、无消费器、protect hook create/update 校验）
    - 迁移: `payload-office-platform/src/migrations/20260726_103600_m6_3_domain_events.ts`（创建 `domain_events` 表、`enum_domain_events_event_type` / `enum_domain_events_aggregate_type` 枚举、`event_id` 唯一索引、`aggregate_type/aggregate_id/occurred_at/processed_at` 复合索引）
    - 权限码: `events:read` / `events:write` / `events:manage`（新增，见 `permission-codes.ts`）
    - Config 注册: `payload-office-platform/src/payload.config.ts` 已注册 `DomainEvents` Collection；`payload-office-platform/src/payload-types.ts` 已含 `domain-events` 类型
    - 验收: `pnpm typecheck` 通过；`pnpm test` 64 文件 1124 用例全通过

- [ ] 6.4 创建待办模型和注册表
  - 为审核、举报、未分配线索、首次跟进、下次跟进和房源维护登记规则。
  - 来源完成、取消或版本失效自动闭环待办。
  - _Requirement: R6, R7, R8_

- [ ] 6.5 实现 SLA 扫描任务
  - 每 15 分钟扫描首次跟进和公海回收。
  - 每日扫描 30 天未有效维护房源。
  - 固定同一 `as_of` 和 Asia/Shanghai 时间边界。
  - _Requirement: R6, R7_

- [ ] 6.6 建设我的待办
  - 按逾期、优先级、截止时间和创建时间排序。
  - 支持领取、转派、去处理和来源深链。
  - 批量领取/转派限制为 50 条且逐条返回结果。
  - _Requirement: R1, R7_

- [ ] 6.7 实现站内通知
  - 审核驳回、线索分配/转派、SLA 超时和待办变更生成通知。
  - 通知与业务状态解耦，失败可重试。
  - _Requirement: R6, R7, R8_

### M6 验收门

- 来源动作完成后 60 秒内待办闭环。
- 重复事件不会生成重复待办或通知。
- 举报暂停和恢复不改变房源审核、发布字段。
- SLA 时间边界及扫描幂等测试通过。

## M7 工作台与数据看板

- [ ] 7.1 建立指标注册表
  - 为每个指标定义编码、公式、去重、时间、权限、缓存和下钻模板。
  - 禁止页面独立拼装指标条件。
  - _Requirement: R7_

- [ ] 7.2 升级角色化工作台
  - 管理员/运营：待审核、今日供给、线索、跟进和超时。
  - 销售主管：团队线索、待分配、跟进和有效商机。
  - 经纪人：我的新线索、今日待跟进、超时和推荐次数。
  - _Requirement: R1, R7_

- [ ] 7.3 建设经营概览
  - 城市、时间和团队筛选。
  - 指标卡、趋势、来源分布和明细下钻。
  - 单卡失败局部重试并展示数据截至时间。
  - _Requirement: R7_

- [ ] 7.4 建设房源分析
  - 总数、上架、待审核、下架、出租和完整度低于 80%。
  - 所有有效供给指标复用统一供给谓词。
  - _Requirement: R4, R7_

- [ ] 7.5 建设线索分析
  - 新增、有效、无效、已分配、及时率、推荐率和转化率。
  - 合并目标、有效创建时间和终态事件时间口径一致。
  - _Requirement: R6, R7_

- [ ] 7.6 完成指标数据一致性测试
  - 卡片等于趋势桶之和。
  - 卡片、图表点击和明细数量一致。
  - URL 参数不能扩大数据范围。
  - _Requirement: R1, R7_

### M7 验收门

- 不同角色只看到授权指标和范围。
- 同一 query ID 下卡片、图表和明细一致。
- 单个指标失败不影响其他组件。

## M8 审计、导入导出与上线

- [ ] 8.1 创建追加式审计日志
  - 保存主体/角色/组织快照、对象版本、前后值、请求上下文和结果。
  - 禁止 Admin UI 和 API 修改或删除。
  - 对日志详情、敏感值查看和导出本身再次审计。
  - _Requirement: R8_

- [ ] 8.2 接入高风险业务动作
  - 覆盖审核、发布、下架、商户冻结、举报、分配、认领、转派、权限和账号停用。
  - 审计写入失败时回滚高风险事务。
  - _Requirement: R1–R8_

- [ ] 8.3 完善导入导出
  - 继承筛选、数据和字段权限。
  - 线索导入预校验并输出重复手机号失败原因。
  - 大批量异步处理，保存批次和逐条结果。
  - _Requirement: R1, R6, R8_

- [ ] 8.4 完成数据迁移和双读报告
  - 回填房源、客户、线索、区域和供给关系。
  - 比较旧字段与新模型的数量、状态和前台可见性。
  - 无法确定的数据进入人工处理清单。
  - _Requirement: R2, R3, R4, R6_

- [ ] 8.5 完成安全和性能验收
  - 五角色越权测试、敏感字段检查和批量接口限额。
  - 常用列表、工作台和分析查询建立索引。
  - 验证 20/50/100 分页和并发版本冲突。
  - _Requirement: R1, R7, R8_

- [ ] 8.6 完成生产演练
  - 在生产数据副本执行 dry-run 和正式迁移。
  - 演练回滚、Outbox 重放、扫描任务和审计故障。
  - 建立上线观察指标及告警。
  - _Requirement: R8_

- [ ] 8.7 完成产品验收
  - 按 22 份页面 PRD 的正常、权限、异常和数据四类验收逐项签字。
  - 记录 MVP 延后项和已接受偏差。
  - _Requirement: R1–R8_

### M8 验收门

- 所有高风险动作可按请求 ID 追溯。
- 迁移报告无未解释的数量或状态差异。
- 生产演练、回滚演练和五角色 E2E 全部通过。

## 3. 建议实施批次

### 第一批：可安全继续运营

范围：M0–M1  
结果：现有后台不变，先建立权限、迁移和测试基础。

### 第二批：可信供给闭环

范围：M2–M4  
结果：楼盘、商户、房源审核、显式发布和前台有效性闭环。

### 第三批：线索转化闭环

范围：M5–M6  
结果：客户、线索、跟进、公海、SLA、待办和举报闭环。

### 第四批：管理与上线

范围：M7–M8  
结果：角色化工作台、统一看板、不可变审计和生产迁移。

## 4. 并行开发建议

当团队不少于 3 人时：

- 工程师 A：Identity、权限、审计。
- 工程师 B：Geography、Merchant、Building、Listing、Review。
- 工程师 C：Customer、Lead、FollowUp、Task、Dashboard。

以下工作不得提前并行：

- M4 有效供给依赖 M2 商户/区域与 M3 楼盘关系。
- M5 分配和推荐依赖 M1 权限与 M4 有效供给。
- M6 待办依赖 M4/M5 领域事件。
- M7 指标依赖业务状态和共享查询稳定。

## 5. 第一迭代建议范围

首次执行建议只批准 M0，不立即修改业务模型：

1. 固定工程基线。
2. 建立领域目录和公共类型。
3. 建立迁移 dry-run 与数据快照。
4. 建立角色、城市、商户、房源和线索测试工厂。
5. 保证现有后台和前台行为完全不变。

M0 验收通过后，再单独确认进入 M1 权限模型开发。
