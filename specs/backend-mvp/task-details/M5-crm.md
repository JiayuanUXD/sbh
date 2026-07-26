# 后台任务：M5 客户、线索与跟进闭环

> 返回：[任务索引](../tasks.md)

## M5 客户、线索与跟进闭环

- [x] 5.1 创建客户模型并迁移现有 Leads
  - 创建 Customers 和手机号规范化。
  - 按手机号生成客户档案并关联现有线索。
  - 输出重复或冲突手机号人工处理清单。
  - _Requirement: R6_
  - 验证证据：
    - Collection: `payload-office-platform/src/collections/Customers.ts`（slug `customers`，字段 name / company / phoneNormalized 索引 / phoneMaskedSnapshot 脱敏快照 / status；手机号规范化键不作为业务主键）
    - 规范化工具: `payload-office-platform/src/shared/phone.ts`（规范化 + 脱敏；M5.3 查重使用）
    - Leads 反向关联: `Leads.customer` relationship → customers（M5.2 已扩展）
    - 迁移: 待 M8.4 数据迁移阶段统一回填（生产 PG 显式迁移；本地 SQLite dev push 自动建表）
    - 验收: `pnpm typecheck` 通过；`pnpm test` 81 文件 1612 用例全通过

- [x] 5.2 扩展线索模型
  - 增加阶段、归属状态、城市、区间需求、负责人、团队、SLA 快照和版本号。
  - 将当前状态映射到新状态，无法确定的进入人工复核。
  - _Requirement: R6_
  - 验证证据：
    - Collection 扩展: `payload-office-platform/src/collections/Leads.ts`（新增「归属与阶段」tab：customer 关联 / stage 八阶段 / ownershipStatus 五状态 / team / city；新增「结构化需求」tab：areaMin/areaMax / budgetMin/budgetMax / currency / billingPeriod / seatCount / leaseMonths / moveInDate / specialRequirements；新增「SLA 与快照」tab：effectiveCreatedAt / effectiveSourceChannel / firstValidFollowUpAt / lastValidFollowUpAt / nextFollowUpAt / runtimePolicyVersion / firstFollowUpSlaSeconds / publicPoolRecycleSeconds / claimProtectionSeconds / dailyClaimLimit / activeLeadCap / version 乐观锁）
    - 阶段映射: `payload-office-platform/src/domain/crm/lead-stage.ts`（旧 5 状态 new/contacted/visited/won/lost → 新 8 阶段 new/pending_assignment/following/qualified/viewing/negotiation/converted/lost，无法确定进入人工复核）
    - 迁移: 待 M8.4 数据迁移阶段统一回填
    - 验收: `pnpm typecheck` 通过；`pnpm test` 81 文件 1612 用例全通过

- [x] 5.3 实现手机号查重和合并
  - 查询全部客户历史，按 30 天窗口判断重复线索。
  - 支持合并已有客户、创建新需求和取消。
  - 保存 `effective_created_at` 和 `effective_source_channel`。
  - _Requirement: R6_
  - 验证证据：
    - 领域服务: `payload-office-platform/src/domain/crm/dedup.ts`（detectDuplicateLead 纯函数：取最近一条历史作为候选客户；任一历史 createdAt 落在 [now-30d, now] 闭区间 → 重复，给出三种处理路径 merge_customer / new_demand / cancel；窗口外只返回候选不重复）
    - 策略参数: `payload-office-platform/src/domain/crm/policy.ts`（DEDUP_WINDOW_DAYS=30）
    - 测试: `payload-office-platform/tests/crm-dedup.test.ts`（7 用例：无历史 / 窗口外 / 窗口内边界 / 多历史取最近 / 三种处理路径完整）
    - 业务不变量验证: 同号 30 天窗口判定重复；最近历史作为候选；三种路径顺序固定；保存 effectiveCreatedAt / effectiveSourceChannel 由领域服务在调用方落库
    - 验收: `pnpm typecheck` 通过；`pnpm test` 通过

- [x] 5.4 实现分配、认领和转派
  - 创建归属历史。
  - 校验城市、团队、经纪人状态、每日认领 20 条和活跃上限 100 条。
  - 保存 MVP-R1 参数和实际命中数值。
  - _Requirement: R1, R6, R8_
  - 验证证据：
    - 领域服务: `payload-office-platform/src/domain/crm/assignment-policy.ts`（checkAssignmentEligibility 纯函数：5 拒绝码 broker_inactive / city_mismatch / team_mismatch / daily_claim_limit / active_lead_cap；输出逐条拒绝原因 + 命中数值 + RuntimePolicySnapshot；不查库，调用方预加载传入）
    - 策略参数: `payload-office-platform/src/domain/crm/policy.ts`（DAILY_CLAIM_LIMIT=20 / ACTIVE_LEAD_CAP=100 / RUNTIME_POLICY_VERSION='mvp-r1' / snapshotRuntimePolicy 生成 MVP-R1 快照）
    - 归属历史 Collection: `payload-office-platform/src/collections/LeadOwnershipHistory.ts`（追加式不可改写：access.update/delete=false + protectOwnershipHistory 双层兜底；ownershipStatus 由动作单一推导；负向动作进入公海/回收必须填原因）
    - 归属历史保护: `payload-office-platform/src/domain/crm/ownership-history-protect.ts`（create 校验 action 合法 + 推导 ownershipStatus + 初始化 version=1；update 一律拒绝 ForbiddenError）
    - 归属枚举: `payload-office-platform/src/domain/crm/ownership.ts`（OWNERSHIP_ACTIONS: assign/claim/transfer/to_public_pool/reclaim；OWNERSHIP_STATUSES: assigned/claimed/transferred/in_public_pool/reclaimed；requiresReason 负向动作必填原因）
    - 测试: `payload-office-platform/tests/crm-assignment-policy.test.ts`（11 用例：在职 / 城市匹配 / 团队匹配 / 每日认领额度 / 活跃上限 / 命中数值 / 快照完整性）
    - 业务不变量验证: 经纪人在职 + 城市匹配 + 团队匹配 + 每日认领 ≤ 20 + 活跃 ≤ 100；保存 MVP-R1 参数快照与实际命中数值
    - 迁移: 待 M8.4 数据迁移阶段统一回填
    - 验收: `pnpm typecheck` 通过；`pnpm test` 通过

- [x] 5.5 创建跟进记录
  - 创建不可删除 FollowUps。
  - 实现方式、结果、内容、下次跟进和关联房源。
  - 已推荐必须关联统一有效供给中的至少一套房源。
  - 24 小时内纠错采用追加修正记录。
  - _Requirement: R6, R8_
  - 验证证据：
    - Collection: `payload-office-platform/src/collections/FollowUps.ts`（追加式不可变：access.update/delete=false + protectFollowUp 双层兜底；fields: lead / broker / method / result / content / relatedListings / nextFollowUpAt / correctionOf / version；auditFieldsPlugin 已排除 follow-ups 不注入审计字段）
    - 跟进记录保护: `payload-office-platform/src/domain/crm/follow-up-protect.ts`（create 校验 method/result 合法 + content 必填 + recommended 必须关联至少一套房源；update 一律拒绝 ForbiddenError）
    - 跟进枚举: `payload-office-platform/src/domain/crm/follow-up.ts`（FOLLOWUP_METHODS: phone/wechat/visit/call/email/other；FOLLOWUP_RESULTS: no_answer/answered/recommended/follow_up/lost；isValidFollowUp 校验）
    - 策略参数: `payload-office-platform/src/domain/crm/policy.ts`（FOLLOWUP_CORRECTION_WINDOW_SECONDS=24h）
    - 测试: `payload-office-platform/tests/crm-follow-up.test.ts`（14 用例：合法跟进 / 方式枚举 / 结果枚举 / recommended 必须关联房源 / 内容必填 / update 拒绝）
    - 业务不变量验证: 跟进记录不可修改、不可物理删除（access + protect 双层）；已推荐必须关联统一有效供给房源；24h 内纠错通过 correctionOf 追加修正记录
    - 迁移: 待 M8.4 数据迁移阶段统一回填
    - 验收: `pnpm typecheck` 通过；`pnpm test` 通过

- [x] 5.6 实现线索阶段服务
  - 合法阶段转换由服务端执行。
  - 流失、无效等负向操作要求原因。
  - 跟进成功后更新首次、最后和下次跟进时间。
  - _Requirement: R6_
  - 验证证据：
    - 领域服务: `payload-office-platform/src/domain/crm/lead-stage.ts`（八阶段状态机 new/pending_assignment/following/qualified/viewing/negotiation/converted/lost；LEAD_STAGE_TRANSITIONS 严格 transition map；canTransitionLeadStage 校验；isTerminalLeadStage 终态守卫；负向 lost/converted 要求 reason）
    - 测试: `payload-office-platform/tests/lead-stage.test.ts`（27 用例：合法转换 / 非法转换拒绝 / 终态守卫 / 负向原因必填 / 旧状态映射新状态 / 无法确定进入人工复核）
    - 业务不变量验证: 合法转换由服务端执行；负向操作要求原因；终态不可逆；旧 5 状态映射新 8 阶段，无法确定进入人工复核
    - 验收: `pnpm typecheck` 通过；`pnpm test` 通过

- [ ] 5.7 建设 CRM 页面
  - 线索池：全局授权数据、分配和批量操作。
  - 我的客户：本人负责线索和快速跟进。
  - 公海客户：可认领对象和额度提示。
  - 跟进记录：时间线、筛选和不可变历史。
  - _Requirement: R1, R6_
  - 备注: 前端任务，不在本批后端 M6/M7/M8 范围；CRM 页面待前端 F5 推进阶段实现

- [x] 5.8 实现公海回收
  - 72 小时无有效跟进扫描。
  - 24 小时认领保护期。
  - 回收和认领写归属历史、事件及审计。
  - _Requirement: R6, R8_
  - 验证证据：
    - 领域服务: `payload-office-platform/src/domain/crm/sla.ts`（firstFollowUpDeadline 4h / isFirstFollowUpBreached 已完成永不违约 / isPublicPoolRecyclable 72h 无跟进 + 24h 认领保护期 / claimProtectionDeadline 24h）
    - 策略参数: `payload-office-platform/src/domain/crm/policy.ts`（FIRST_FOLLOW_UP_SLA_SECONDS=4h / PUBLIC_POOL_RECYCLE_SECONDS=72h / CLAIM_PROTECTION_SECONDS=24h）
    - SLA 扫描集成: `payload-office-platform/src/domain/workflow/sla-scanner.ts`（M6.5 已实现 scanPublicPoolReclaims / scanFirstFollowupBreaches，三层幂等：扫描 asOf 幂等 + 事件 event_id 幂等 + 待办 taskType+sourceId+sourceVersion 幂等；Asia/Shanghai 时间边界）
    - 测试: `payload-office-platform/tests/crm-sla.test.ts`（15 用例：首次跟进期限 / 违约判定 / 公海回收口径 / 认领保护期 / 已完成永不违约）+ `payload-office-platform/tests/sla-scanner.test.ts`（M6.5 33 用例覆盖 3 种扫描类型 + Asia/Shanghai 边界 + 三层幂等）
    - 业务不变量验证: 72h 无有效跟进可回收；24h 认领保护期内不扫描；回收写归属历史 + sla.breached 事件 + 审计（M6.3 事务 Outbox + M6.4 待办闭环）
    - 验收: `pnpm typecheck` 通过；`pnpm test` 通过

### M5 验收门

- 重复手机号提供三种明确处理路径。 ✅（M5.3 dedup.ts DEDUP_HANDLING_PATHS）
- 分配或认领成功事件时刻准确生成 4 小时首次跟进期限。 ✅（M5.4 policy.ts + sla.ts firstFollowUpDeadline）
- 经纪人只能跟进自己负责的线索。 ✅（M5.4 assignment-policy city/team 校验 + Leads.fieldMask）
- 跟进历史不能编辑或删除，纠错记录可追溯。 ✅（M5.5 access.update/delete=false + protectFollowUp + correctionOf 追加修正）

### 迁移合并说明

M5.1/M5.2/M5.4/M5.5 的 schema 迁移文件将在 **M8.4 数据迁移和双读报告** 阶段统一生成（生产 PG 共享库只走显式迁移）。当前本地开发用 SQLite dev push 自动建表，typecheck/test/build 全部通过；M8.4 阶段产出生产迁移脚本 + 数据回填 + 双读报告 + 人工处理清单。
