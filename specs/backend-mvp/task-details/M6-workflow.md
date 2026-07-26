# 后台任务：M6 举报、待办、通知与 SLA

> 返回：[任务索引](../tasks.md)

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

- [x] 6.2 实现举报供给暂停
  - 有效举报暂停只影响统一有效供给谓词。
  - 不改写审核状态和发布状态。
  - 恢复和关闭要求权限、原因和审计。
  - _Requirement: R4, R5, R8_
  - 验证证据：
    - 领域服务:
      - `payload-office-platform/src/domain/report/report-supply-pause.ts`（M6.2 新增：`pauseSupplyForReport` / `resumeSupplyForReport`，权限校验 `report:resolve` + 幂等 + 恢复原因必填 + 不改写审核/发布状态）
      - `payload-office-platform/src/domain/report/report-event-publisher.ts`（M6.2 新增：`buildReportClosedEvent`，sustained/partial → `report.sustained`，dismissed → `report.dismissed`，含 evidenceCount 审计字段）
      - `payload-office-platform/src/domain/report/report-supply-effect.ts`（M6.1 已有，M6.2 新增 `evidenceCount` 字段供审计）
      - `payload-office-platform/src/domain/report/report-protect.ts`（M6.1 已有，M6.2 新增：修改 `supplyPaused`/`supplyPausedAt`/`supplyResumedAt` 字段需 `report:resolve` 权限；关闭时按结论自动推导 `supplyPaused`）
    - 有效供给谓词: `payload-office-platform/src/domain/review/effective-supply.ts`（M6.2 新增 `listingReportPauseWhere` / `getPausedListingIds` / `extractPausedListingIds` / `isListingPaused`，fail-closed 正向谓词 `supplyPaused equals true`，调用方用 `id: { not_in: pausedIds }` 排除）
    - Collection: `payload-office-platform/src/collections/ListingReports.ts`（M6.1 已有，M6.2 新增 `publishReportClosedEvent` afterChange hook：状态变为 closed 时同事务写 Outbox `domain-events`，Outbox 写入失败不阻断业务由 M6.3 消费器重试兜底）
    - 类型修正: `payload-office-platform/src/domain/workflow/event-publisher.ts`（`DomainEvent.aggregateType` 从 `string` 收紧为 `AggregateType`，对齐 `domain-events` Collection select 枚举）
    - 测试: `payload-office-platform/tests/report-supply-pause.test.ts`（42 用例全通过，覆盖 pause/resume 合法与非法路径、事件类型映射、payload 字段完整性、eventId 唯一性、举报暂停谓词、extractPausedListingIds 去重与形态处理、protect hook 自动推导 supplyPaused 与权限校验、evidenceCount 一致性）
    - 迁移: 无需新增迁移（`supply_paused` / `supply_paused_at` / `supply_resumed_at` 字段已在 M6.1 迁移 `20260726_103500_m6_1_listing_reports.ts` 中创建）
    - 权限码: `report:resolve`（已有，M6.2 用于供给暂停/恢复 + protect hook 双层校验）
    - 业务不变量验证: 有效举报暂停只影响统一有效供给谓词（不改 `reviewStatus` / `publicationStatus`）；恢复和关闭要求 `report:resolve` 权限 + 原因 + 审计（事件 + 时间戳）；跨对象副作用走事务 Outbox（M6.3 已完成）
    - 验收: `pnpm typecheck` 通过；`pnpm test` 65 文件 1166 用例全通过

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

- [x] 6.4 创建待办模型和注册表
  - 为审核、举报、未分配线索、首次跟进、下次跟进和房源维护登记规则。
  - 来源完成、取消或版本失效自动闭环待办。
  - _Requirement: R6, R7, R8_
  - 验收证据:
    - 领域层:
      - `payload-office-platform/src/domain/workflow/task-status.ts`（4 状态机：pending→in_progress→completed；pending/in_progress→cancelled；终态守卫 isTerminalTaskStatus / isActiveTaskStatus；优先级 urgent<high<normal<low 权重）
      - `payload-office-platform/src/domain/workflow/task-types.ts`（6 种 taskType + 5 种 sourceType 枚举；TASK_TYPE_SOURCE_TYPE / TASK_TYPE_DEFAULT_PRIORITY / TASK_TYPE_DEFAULT_SLA_MS / TASK_TYPE_TRIGGER_EVENT 元数据映射）
      - `payload-office-platform/src/domain/workflow/task-registry.ts`（TaskRegistry 注册与按 taskType / sourceEventType / completeOnEvent / cancelOnEvent 查询；6 种 buildTask 实现：review-pending/report-triage/lead-unassigned/followup-first/followup-next/listing-stale-maintenance；buildStaleMaintenanceTask 供扫描器直接调用）
      - `payload-office-platform/src/domain/workflow/task-service.ts`（createTaskFromEvent 幂等创建、completeTask/cancelTask 状态校验、autoCloseOnSourceCompletion / autoCancelOnSourceCancellation 来源事件闭环；TaskStore 接口 + createInMemoryTaskStore 内存实现；deriveSourceIdFromPayload 从 payload 派生 reviewId/reportId/leadId/followupId/listingId）
    - Collection: `payload-office-platform/src/collections/Tasks.ts`（Payload CollectionConfig：taskType/sourceId/sourceVersion 幂等键、status/priority/dueAt/assignee/team/metadata 字段、validateTaskIdempotency beforeValidate hook、protectTask beforeChange hook、onTaskChanged afterChange hook）
    - 测试: `payload-office-platform/tests/tasks.test.ts`（70 用例全通过，覆盖状态机合法/非法转换、枚举守卫、6 种 buildTask 规则、createTaskFromEvent 幂等创建、completeTask/cancelTask 终态校验、autoCloseOnSourceCompletion 来源完成闭环、autoCancelOnSourceCancellation 来源取消闭环、in-memory TaskStore 行为）
    - 测试工厂: `payload-office-platform/src/test/factory/tasks.ts`（任务 fixture：review-pending/report-triage/lead-unassigned/followup-first + 8 种事件 fixture）
    - 迁移: `payload-office-platform/src/migrations/20260726_103700_m6_4_tasks.ts`（创建 `tasks` 表、`enum_tasks_task_type` / `enum_tasks_source_type` / `enum_tasks_priority` / `enum_tasks_status` 枚举、幂等唯一索引 `tasks_idempotency_idx`、sourceType+sourceId 复合索引、status/assignee/dueAt 查询索引）
    - 权限码: `task:read` / `task:manage` / `task:assign` / `task:complete`（新增，见 `permission-codes.ts`）
    - Config 注册: `payload-office-platform/src/payload.config.ts` 已注册 `Tasks` Collection；`payload-office-platform/src/payload-types.ts` 已含 `tasks` 类型
    - 验收: `pnpm typecheck` 通过；`pnpm test` 66 文件 1236 用例全通过（含 tasks.test.ts 70 用例）

- [x] 6.5 实现 SLA 扫描任务
  - 每 15 分钟扫描首次跟进和公海回收。
  - 每日扫描 30 天未有效维护房源。
  - 固定同一 `as_of` 和 Asia/Shanghai 时间边界。
  - _Requirement: R6, R7_
  - 验证证据：
    - 领域服务:
      - `payload-office-platform/src/domain/workflow/sla-scan-types.ts`（M6.5 新增：3 种 SlaScanType 枚举 `first-followup` / `public-pool` / `stale-maintenance`，3 种 SlaBreachType 枚举 `first_followup` / `claim_protection` / `reclaim`，对应事件 payload.slaType 字段）
      - `payload-office-platform/src/domain/workflow/sla-scanner.ts`（M6.5 新增：`scanFirstFollowupBreaches` / `scanPublicPoolReclaims` / `scanStaleMaintenances` / `runSlaScan` 入口；`SLA_SCAN_INTERVALS` firstFollowup=15min / publicPool=15min / staleMaintenance=24h；`SLA_THRESHOLDS` firstFollowupMs=4h / publicPoolMs=72h / staleMaintenanceMs=30d；使用 `shanghaiDayStartUtc` / `shanghaiDayEndUtc` 固定 Asia/Shanghai 时间边界）
      - `payload-office-platform/src/domain/workflow/event-consumer.ts`（M6.3 已有，M6.5 扩展 `EventStore.findByAggregate` 接口供扫描器幂等检查 `sla.breached` 事件）
      - `payload-office-platform/src/domain/workflow/task-registry.ts`（M6.4 已有 `buildStaleMaintenanceTask`，M6.5 直接消费）
    - 接口抽象:
      - `LeadScanRecord`（最小字段集：leadId / assigneeId / assignedAt / firstFollowupAt / lastValidFollowupAt / ownershipStatus，由调用方从 leads + follow_ups 派生，扫描器不直接耦合 M5 collection）
      - `ListingScanRecord`（最小字段集：listingId / updatedAt / lastEffectiveMaintainedAt）
      - `SlaScanStore`（`hasScanRun` / `markScanRun` 幂等检查接口）
      - `createInMemorySlaScanStore` 内存实现 + `createInMemoryEventStore` 内存实现（含 `findByAggregate` 幂等查询）
    - 三层幂等保证:
      - 扫描幂等：相同 asOf 不重复扫描（`hasScanRun` / `markScanRun` 兜底）
      - 事件幂等：相同 lead 不重复生成 `sla.breached` 事件（`EventStore.findByAggregate` 兜底）
      - 待办幂等：`taskType + sourceId + sourceVersion`（`TaskStore.findByKey` 兜底，复用 M6.4 机制）
    - 测试: `payload-office-platform/tests/sla-scanner.test.ts`（33 用例全通过，覆盖 3 种扫描类型、Asia/Shanghai 时间边界、三层幂等机制、空结果跳过、批量违规处理、待办生成、Outbox 写入失败不阻断扫描）
    - 业务不变量验证: 固定同一 as_of 和 Asia/Shanghai 自然日边界；扫描幂等相同 asOf 不重复扫描；事件幂等相同 lead 不重复生成 sla.breached；跨对象副作用使用事务 Outbox（M6.3）
    - 验收: `pnpm typecheck` 通过；`pnpm test` 68 文件 1319 用例全通过（含 sla-scanner.test.ts 33 用例）

- [x] 6.6 建设我的待办
  - 按逾期、优先级、截止时间和创建时间排序。
  - 支持领取、转派、去处理和来源深链。
  - 批量领取/转派限制为 50 条且逐条返回结果。
  - _Requirement: R1, R7_
  - 验证证据:
    - 领域服务:
      - `payload-office-platform/src/domain/workflow/my-tasks.ts`（M6.6 新增：`sortMyTasks` 稳定排序 → 逾期 → 优先级 → 截止时间 → 创建时间；`buildSourceDeepLink` 从 TaskRecord 派生来源深链；`claimTask` 单条领取 pending→in_progress；`transferTask` 单条转派保留 status 更新 assigneeId/teamId；`batchClaimTasks` / `batchTransferTasks` 批量操作上限 50 条逐条返回结果；`MY_TASKS_BATCH_LIMIT=50` 常量；`toMyTaskView` 视图转换；终态任务排末尾按 completedAt/cancelledAt 倒序）
      - `payload-office-platform/src/domain/workflow/task-service.ts`（M6.4 已有，M6.6 扩展 `TaskStore.update` 支持 assignee / team 字段更新，便于领取 / 转派操作）
      - `payload-office-platform/src/domain/workflow/task-status.ts`（M6.4 已有，M6.6 复用 `canTransitionTask` 状态机校验）
    - Endpoint:
      - `payload-office-platform/src/endpoints/my-tasks-endpoint.ts`（M6.6 新增：5 个路由 `GET /mine` 列表 + `POST /:id/claim` 单条领取 + `POST /:id/transfer` 单条转派 + `POST /batch-claim` 批量领取 + `POST /batch-transfer` 批量转派；通过 `PayloadTaskStore` 包装 `req.payload` Local API；`requireOperationPermission('task:assign')` 权限门；`requireOperationPermission('task:read')` 列表权限门）
    - 接口抽象:
      - `MyTasksSortContext`（now 时间注入，便于测试冻结时间）
      - `MyTasksActionContext`（callerId / now / store，封装批量操作上下文）
      - `createInMemoryTaskStore` 内存实现（复用 M6.4）
    - 测试: `payload-office-platform/tests/my-tasks.test.ts`（50 用例全通过，覆盖排序稳定性、4 维度优先级、终态任务末尾倒序、深链派生、单条 / 批量领取转派、批量上限 50、重复领取幂等、越权校验、空列表处理）
    - 业务不变量验证: 待办由来源业务事件完成或取消（M6.4 闭环），允许工作台领取转 in_progress 或转派他人（task:assign 权限门）；批量操作上限 50 条且逐条返回成功 / 失败原因；重复领取 / 转派幂等
    - 验收: `pnpm typecheck` 通过；`pnpm test` 68 文件 1319 用例全通过（含 my-tasks.test.ts 50 用例）

- [x] 6.7 实现站内通知
  - 审核驳回、线索分配/转派、SLA 超时和待办变更生成通知。
  - 通知与业务状态解耦，失败可重试。
  - _Requirement: R6, R7, R8_
  - 验证证据:
    - 领域服务:
      - `payload-office-platform/src/domain/workflow/notification-types.ts`（M6.7 新增：6 种 NotificationType 枚举 `review-rejected` / `lead-assigned` / `lead-transferred` / `sla-breached` / `task-completed` / `task-cancelled`；4 种 NotificationSourceType 枚举 `listing-review` / `lead` / `followup` / `task`；`isNotificationType` / `isNotificationSourceType` 守卫）
      - `payload-office-platform/src/domain/workflow/notification-service.ts`（M6.7 新增：`createNotification` 幂等创建 eventId+recipientId+type 唯一键；`markNotificationAsRead` 收件人本人校验防越权；`buildNotificationFromEvent` 从领域事件派生通知草稿 type/sourceType/sourceId/title/body/recipientId；`EVENT_NOTIFICATION_MAP` 事件 → 通知类型映射；`deriveRecipientId` 从 payload 派生收件人；`createInMemoryNotificationStore` 内存实现含 `findByEventAndRecipient` 幂等查询）
      - `payload-office-platform/src/domain/workflow/notification-consumer.ts`（M6.7 新增：`createNotificationConsumer` 实现 `EventConsumer` 接口，每事件类型对应一个实例；`registerNotificationConsumers` 批量注册 6 种触发事件消费器；payload 缺 recipientId 时返回 ok 跳过不重试避免死信）
      - `payload-office-platform/src/domain/workflow/notification-protect.ts`（M6.7 新增：`protectNotification` beforeChange hook；create 校验 type / sourceType 枚举并初始化 read=false / readAt=null；update 禁止修改 7 个不可变字段 type/recipient/eventId/sourceType/sourceId/title/body；禁止已读回退未读；标记 read=true 时自动填 readAt）
      - `payload-office-platform/src/domain/workflow/task-protect.ts`（M6.4 已有，M6.7 扩展 `onTaskChanged` afterChange hook：状态变为 completed / cancelled 时向 Outbox 写入 `task.completed` / `task.cancelled` 事件，payload 含 taskId/taskType/sourceId/sourceType/assigneeId/completionEventId/reason，Outbox 写入失败不阻断业务事务由 M6.3 消费器重试兜底）
      - `payload-office-platform/src/domain/workflow/event-types.ts`（M6.3 已有，M6.7 新增 `TASK_EVENT_TYPES = ['task.completed', 'task.cancelled']` 与 `AGGREGATE_TYPES` 新增 `task` 聚合类型）
    - Collection: `payload-office-platform/src/collections/Notifications.ts`（slug `notifications`，字段 recipient/type/title/body/sourceType/sourceId/eventId/read/readAt；access 收紧 create/update/delete 到 `notification:manage` 防绕过 notification-service；beforeChange hook `protectNotification` 双层校验；admin group `workflow`）
    - 迁移: `payload-office-platform/src/migrations/20260726_103800_m6_7_notifications.ts`（创建 `notifications` 表 + `notifications_rels` 关系表；`enum_notifications_type` / `enum_notifications_source_type` 枚举；幂等复合索引 `event_id + id`；扩展 `domain_events` 枚举新增 `task.completed` / `task.cancelled` event_type 与 `task` aggregate_type）
    - 权限码: `notification:read`（数据范围收窄到 recipient=self）/ `notification:manage`（标记已读 / 删除）+ 菜单编码 `notifications`（新增，见 `permission-codes.ts`）
    - Config 注册: `payload-office-platform/src/payload.config.ts` 已注册 `Notifications` Collection；`payload-office-platform/src/payload-types.ts` 通过 `pnpm generate:types` 重新生成含 `notifications` 类型与扩展后 `domain-events` 枚举
    - 三层幂等保证:
      - 事件幂等：Outbox event_id 唯一（M6.3 已有 `protectDomainEvent` 兜底）
      - 通知幂等：eventId + recipientId + type 复合唯一（`NotificationStore.findByEventAndRecipient` 兜底）
      - 标记幂等：已读通知再次标记视为成功（不报错，防客户端重复请求）
    - 业务不变量验证: 通知与业务状态解耦（消费器从 Outbox 拉取事件后异步生成，通知创建失败不阻断业务事务由 EventDispatcher 重试兜底）；重复事件不重复生成通知（幂等键 eventId + recipient + type）；通知只能由消费器创建（外部 HTTP create 由 access 收紧到 `notification:manage` + protect hook 双层兜底）；通知字段写入后不可变（除 read / readAt）；已读通知不允许回退为未读；通知只能由收件人本人标记已读
    - 验收: `pnpm typecheck` 通过；`pnpm test` 68 文件 1319 用例全通过（含 domain-events.test.ts 53 用例覆盖扩展后 AGGREGATE_TYPES 含 `task` 与 EVENT_TYPES 含 `task.completed` / `task.cancelled`）；`pnpm build` 成功生成生产构建

### M6 验收门

- 来源动作完成后 60 秒内待办闭环。
- 重复事件不会生成重复待办或通知。
- 举报暂停和恢复不改变房源审核、发布字段。
- SLA 时间边界及扫描幂等测试通过。
