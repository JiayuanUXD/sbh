# 线索分析 PRD

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 编号 | 06-03 |
| 版本 | V1.1 |
| 状态 | 评审修订 |
| 所属模块 | 数据看板 / 线索分析 |
| 负责人角色 | 平台管理员、运营人员、销售主管 |
| 更新时间 | 2026-07-17 |

## 2. 页面概述

本页按来源、分配、阶段、跟进、带看、终态、人员和供给归因分析线索质量与处理效率。成功标准是每个漏斗阶段有可验证事件证据，线索合并、转派、入公海和人员转组不会重复计数或改变历史归因。MVP 的“已转化”仅表示线索转化事实，不表示合同、支付、成交报备或结算完成。

## 3. 用户与权限

平台管理员须具备“数据看板-线索分析”菜单权限并可查看全量；运营人员须具备该菜单权限且仅查看授权城市及其来源和供给归因；销售主管须具备该菜单权限且仅查看所属团队和下属经纪人；经纪人、客服无本页菜单，使用我的客户、线索池或工作台。聚合导出另需“线索分析导出”操作权限。客户姓名、手机号、公司、跟进正文和附件不进入聚合图表；下钻到明细时仍执行字段权限和脱敏。数据范围取账号授权、当前筛选及指标约定归属快照的交集；无权团队、经纪人或来源成员不显示。

## 4. 页面入口与关联

- 菜单入口：`数据看板 > 线索分析`；经营概览 OP-04 至 OP-08 可带入来源、房源和周期。
- 上游：Lead、Customer、LeadMerge、LeadStageHistory、LeadAssignmentHistory、PublicPoolHistory、FollowUpRecord、ViewingRecord、Broker、Team、Building、Listing、来源参数及权限快照。
- 下游：线索池、我的客户、公海客户、跟进记录、经纪人管理、团队管理、楼盘列表和房源列表。
- 返回：保留周期、归因模型、漏斗阶段、来源、归属、意向楼盘/房源和排序。

## 5. 页面结构

页面包括时间/范围栏、来源与接入卡片、分配和首次跟进 SLA、阶段漏斗、跟进与带看效率、转化与流失原因、经纪人/团队绩效，以及来源到楼盘/房源归因表。默认近 30 日；`LE-05` 漏斗固定以所选期间 `effective_created_at` 的合并目标线索为单一 cohort，并统计该 cohort 截至查询快照的阶段到达，不提供独立阶段流入口径。存量指标单独标注截至时点。来源归因使用接入时保存的 `source_*`、`source_building_id`、`source_listing_id` 快照，不以当前房源关系回填历史。

## 6. 查询与筛选

| 条件 | 规则 |
|---|---|
| 时间范围 | 今日、近 7 日、近 30 日、自定义；默认近 30 日，最长 365 天，按北京时间自然日闭区间。 |
| 时间口径 | 创建（即合并解析后的 `effective_created_at`）、首次分配、首次跟进、带看完成、终态；切换时只更新使用该字段的非漏斗图表。`LE-05` 始终以 `effective_created_at` 选择 cohort，不能切换为阶段事件时间。 |
| 城市/区域/商圈 | 取线索意向位置；若缺失则显示“未知意向位置”，不得以负责人城市替代。 |
| 来源 | 委托找房、预约看房、电话咨询、前台咨询、客服录入、经纪人录入、导入及其他有效来源；可按来源参数切分。 |
| 商户/团队/经纪人 | 流量按事件时归属历史，当前积压按查询时负责人；切换时在图表说明中显示归因时间。 |
| 楼盘/房源/租售意向 | 使用线索创建时或记录时保存的不可变 ID；已下架对象仍可查询历史归因。 |
| 阶段/公海/流失原因 | 公海为归属位置，不与阶段混合；流失原因仅在已流失终态下可选。 |

筛选和图表排序保留在 URL，清空恢复近 30 日及账号默认范围；开始时间不得晚于结束时间。

## 7. 列表或内容展示

来源表按 `LE-02` 降序，同值按来源代码升序；漏斗按 `LE-05` 的阶段顺序固定为新建、待分配、跟进中、有效商机、带看、谈判、已转化/已流失，不因数值重排，并在标题显示 cohort 创建日期范围与查询快照时间。SLA 卡片显示达标数、应处理数、比率和超时数；绩效表显示经纪人或团队的有效跟进、带看、转化及比率，并可在切换时选择“事件时团队”或“当前团队”，默认事件时团队。归因表每行展示来源、楼盘/房源、线索、有效商机、带看、转化和数据覆盖率。

## 8. 详情及表单

本页无新增或编辑表单。口径抽屉展示指标的事件证据、状态范围、时间字段、去重与合并规则、归属模型和下钻 URL。第 12 节每个指标均必须由本页分析明细表承接，不依赖线索池、跟进记录或团队页的通用筛选：接口接收 `metric_id`、`query_snapshot_id`、服务端按指标口径解析的合并目标 `resolved_lead_ids` 和相关 `resolved_broker_ids`/`resolved_team_ids`，以及精确时间谓词；表格展示线索编号、分子/分母/未到期集合角色、`merge_target_id`、`merged_source_ids`、`effective_created_at`（适用时）、`evidence_type`、`evidence_id`、`evidence_at`、阶段或终态时间。SLA 行还必须展示 `sla_instance_id`、关联 `lead_id`、归属起点事件、实际 `sla_seconds`、`runtime_policy_version=MVP-R1`、截止时间、实例完成事件、达标/逾期/未到期状态和排除原因。业务页链接仅打开该行线索、客户或跟进记录，绝不承载派生筛选。导出支持聚合表与当前明细，继承权限、筛选、脱敏与审计，导出不包含跟进正文和附件。

## 9. 核心操作与流程

1. 用户设定周期、来源、归属和意向供给范围，系统校验其为可访问范围。
2. 系统将 Lead 合并映射到合并目标，排除 `merge_status=已合并` 来源并计算 `effective_created_at=MIN(目标及全部原始来源的 created_at)`；新建、分配 SLA 和漏斗 cohort 均用该字段，目标只计一次。非 cohort 的阶段、带看、跟进和终态指标仍按各自最早有效业务事件及归属历史，`LE-05` 单独以 `effective_created_at` 固定 cohort 并读取截至查询快照的阶段证据。
3. 用户切换漏斗、SLA、绩效和归因维度；每项均传递指标 ID、时间字段、事件时归属版本和查询快照。
4. 点击下钻后，目标页以相同 `lead_id` 集合规则重算明细，若权限或数据已变化则提示当前数据与快照差异。

查询、归因模型切换、口径查看、下钻、刷新和导出写审计；指标无法由人工在本页更正。

## 10. 状态与业务规则

统一生命周期为 `新建 → 待分配 → 跟进中 → 有效商机 → 带看 → 谈判 → 已转化/已流失`。新建是接入后的短暂阶段，已转化和已流失为终态；终态不可分配、认领或入公海。进入有效商机、带看、谈判和终态必须分别具备需求确认、成功带看、谈判说明和终态事实等业务证据；主管回退只会新增阶段历史，不覆盖原事件。公海是归属位置；入池、认领、转派、回收均产生不可变归属历史。规范化手机号查重后的手工合并保留所有来源和记录，来源写入 `merge_status=已合并` 与 `merged_into_lead_id`，仅合并目标参与统计；`effective_created_at` 始终为目标及全部原始来源 `created_at` 的最早值，来源不单独计数。

首次进入待分配时，及每次成功分配、成功认领、重分配、重认领和系统生成/更新 SLA 时，事件必须不可变地写入 `sla_type`、适用的实际 `sla_seconds`、`runtime_policy_version=MVP-R1`、`sla_started_at` 和 `sla_due_at`；README 的 `MVP-R1` 发布常量为 `sla_type=assignment` 的 `7200` 秒（2 小时）及 `sla_type=first_follow_up` 的 `14400` 秒（4 小时），本期无 UI 配置入口。`LE-03` 读取待分配/首次分配或认领链上 `sla_type=assignment` 的事件快照，时钟起点为 `effective_created_at`；`LE-06` 只读取每个 `sla_instance_id` 上 `sla_type=first_follow_up` 的事件快照，时钟起点为该实例归属事件。历史指标绝不得使用查询时的常量重算。

## 11. 异常与边界

- 缺少来源、负责人、楼盘/房源、事件时间或阶段证据的记录进入“未知/待治理”维度，不可静默删除；其中 LE-02 与 LE-12 的缺失来源归入“未知来源”并计入各自分母，LE-09 的缺失流失原因归入“未填写”并计入分母，其余无法满足指标必要条件的记录再按该指标规则排除。
- 分配后负责人停用、团队变更或线索进入公海时，SLA 和绩效按事件时归属历史，当前积压按查询时归属；不可用当前负责人重写历史。
- 取消带看、撤回跟进、更正记录和纠正复核必须以当前有效版本判断，旧版本不重复计数。
- 分母为 0 显示 `--`；漏斗阶段不能因回退造成同一线索同一阶段多次计数。
- `LE-05` 的历史 cohort 可能比近期 cohort 有更长成熟时间，页面必须同时显示 `effective_created_at` cohort 区间和查询快照，不得把不同阶段的周期流入拼成转化漏斗。
- SLA 事件缺少实际 `sla_seconds` 或 `runtime_policy_version=MVP-R1` 时进入“发布常量快照缺失/待治理”，不进入 LE-03 或 LE-06 分子分母；未到 `sla_due_at` 且未完成的记录单列“未到期”而不作为逾期。
- 无权、空数据、聚合延迟、查询失败和 URL 越权分别显示禁止、空状态、最近成功值/时间、重试和权限收缩。

## 12. 数据与指标

数据来自 Lead、Customer、LeadMerge、来源接入快照、LeadStageHistory、LeadAssignmentHistory、PublicPoolHistory、FollowUpRecord、ViewingRecord、Broker/Team 历史、SLA 事件与楼盘/房源归因快照。所有日界与时长均按北京时间（UTC+8）计算；先将合并链解析到目标，`effective_created_at=MIN(目标及全部原始来源 created_at)`，来源 `merge_status=已合并` 排除且目标只计一次。“首次”业务事件取目标保留的最早有效事件；阶段、带看和终态时间不得改写为 `effective_created_at`。以下为本页全部展示指标，所有排除项均包含逻辑删除、测试数据、接入拒绝、被合并源和无权范围记录。

| 指标 | 业务定义 | 计算公式（分子/分母） | 去重键 | 状态范围（含/排除） | 时间字段 | 时区 | 维度 | 刷新频率 | 下钻 |
|---|---|---|---|---|---|---|---|---|---|
| LE-01 新增线索数 | 周期内成功接入的新租赁或出售需求量。 | 分子：`effective_created_at` 落入周期的合并目标 Lead 数；分母：不适用。 | 合并目标 `lead_id` | 含新建至终态全部有效接入阶段；排除接入拒绝、无效测试、逻辑删除及 `merge_status=已合并` 的来源。 | `effective_created_at` | 北京时间（UTC+8） | 城市、来源、租售意向、商户、团队、经纪人、楼盘、房源。 | 每 5 分钟；创建/合并后 60 秒内失效。 | 本页分析明细表：`metric_id=LE-01`、`query_snapshot_id`、`resolved_lead_ids` 和精确谓词 `effective_created_at BETWEEN period_start AND period_end`；证据为目标/来源 ID、各原始 `created_at`、解析值和接入校验。 |
| LE-02 来源线索分布 | 各接入来源带来的新增线索量及占比，包含来源缺失的治理桶。 | 分子：来源成员内 LE-01 `lead_id` 数；分母：全部 LE-01 `lead_id` 数，包含所有已命名来源和“未知来源”桶；分母为 0 显示 `--`。 | 合并目标 `lead_id` | 含成功接入的有效来源代码；来源代码缺失、为空或不可解析时归入“未知来源”，计入分子及分母；排除接入拒绝、逻辑删除、测试、被合并源和无权范围记录，目标只计一次。 | `effective_created_at` | 北京时间（UTC+8） | 来源（含“未知来源”）、来源参数、城市、租售意向、楼盘、房源。 | 每 5 分钟；接入/合并后 60 秒内失效。 | 本页分析明细表：`metric_id=LE-02`、`query_snapshot_id`、`resolved_lead_ids`、来源成员和精确谓词 `effective_created_at BETWEEN period_start AND period_end`；“未知来源”使用缺失/空/不可解析来源谓词，证据为来源快照、目标/来源 ID 及解析创建时间。 |
| LE-03 分配 SLA 达标率 | 需分配线索中，按事件持久化的分配 SLA 在截止前首次成功分配或认领的比例；README 的 `MVP-R1` 发布常量为 2 小时。 | 分子：`first_assignment_or_claim_at <= effective_created_at + sla_seconds`（`sla_type=assignment`）的合并目标 `lead_id` 数；分母：`effective_created_at` 在周期、具有待分配 SLA 事件且截至查询快照已完成或已到 `sla_due_at` 的应分配 `lead_id` 数；未到期未完成单列但不入分母，分母为 0 显示 `--`。 | 合并目标 `lead_id` | 含成功接入、待分配事件和完整 `sla_type=assignment`、实际 `sla_seconds`/`runtime_policy_version=MVP-R1` 的记录；排除接入拒绝、终态前无需分配异常关闭、发布常量快照缺失和 `merge_status=已合并` 来源。 | cohort/起点 `effective_created_at`；完成为首次 `assigned_at` 或 `claimed_at`；SLA 使用该待分配/分配/认领事件持久化的实际 `sla_seconds`（`sla_type=assignment`）与 `runtime_policy_version=MVP-R1` | 北京时间（UTC+8） | 城市、来源、团队、分配人、租售意向。 | 每 15 分钟 SLA 扫描；分配、认领、SLA 或合并事件后 60 秒内失效。 | 本页分析明细表：`metric_id=LE-03`、`query_snapshot_id`、`resolved_lead_ids` 和精确 `effective_created_at` cohort 谓词；证据为待分配、首次分配/认领和 SLA 事件、实际 `sla_seconds`、`runtime_policy_version=MVP-R1`、`sla_due_at`、完成时间及达标/逾期/未到期状态。 |
| LE-04 有效商机数 | 所选周期内首次进入有效商机的线索量，不以新增线索 cohort 限定。 | 分子：`first_valid_opportunity_at BETWEEN period_start AND period_end` 的合并目标 `lead_id` 数；分母：不适用。 | 合并目标 `lead_id` | 含具需求确认证据且首次有效商机事件满足 `first_valid_opportunity_at BETWEEN period_start AND period_end` 的记录；排除无效接入、被合并源、无需求确认证据、撤回/更正无效事件及首次事件不在所选周期的记录。 | `first_valid_opportunity_at`，即目标保留的最早有效商机阶段事件时间。 | 北京时间（UTC+8） | 来源、城市、团队、经纪人、楼盘、房源、租售意向。 | 每 5 分钟；阶段/合并事件后 60 秒内失效，日终 01:00 回算。 | 本页分析明细表：`metric_id=LE-04`、`query_snapshot_id`、`resolved_lead_ids` 和精确谓词 `first_valid_opportunity_at BETWEEN period_start AND period_end`；证据为首次有效商机事件、其 `first_valid_opportunity_at`、需求确认证据和集合命中。 |
| LE-05 阶段漏斗 | 以所选期间 `effective_created_at` 落入范围的合并目标为唯一 cohort，统计同一 cohort 截至查询快照到达各统一生命周期阶段的数量及相邻到达转化率；不展示独立阶段流入。 | cohort `C` = `effective_created_at` 位于所选期间的合并目标 `lead_id`；阶段到达集 `R_s` = `C` 中截至 `query_snapshot_at` 存在阶段 `s` 首次有效证据的 `lead_id`。新建人数=`COUNT(C)`；其余阶段人数=`COUNT(R_s)`；相邻转化率=`COUNT(R_s) / COUNT(R_prev)`，分母为 0 显示 `--`；已转化、已流失为谈判后的两个分支，分别以谈判到达人数为分母。 | cohort 与各阶段均按合并目标 `lead_id`；阶段证据按 `lead_id + stage_code` 取首次有效事件 | 含 `C` 中截至查询快照到达新建、待分配、跟进中、有效商机、带看、谈判、已转化或已流失的线索；阶段事件可晚于 cohort 结束日但不得晚于查询快照。排除无证据跳转、撤销事件、`merge_status=已合并` 来源和“无效”伪阶段。城市/来源/意向楼盘房源取创建快照，团队/经纪人取首次分配快照并保留未分配桶，使所有阶段使用同一 cohort 维度成员。 | cohort 锚点 `effective_created_at`；`lead_stage_history.occurred_at` 仅作阶段到达证据和查询快照截止判断，终态仍使用各自的 `converted_at`/`lost_at` | 北京时间（UTC+8） | 创建时城市、来源、租售意向、楼盘、房源；首次分配团队、经纪人；阶段。 | 每 5 分钟；创建/阶段/合并后 60 秒内失效，日终 01:00 回算。 | 本页分析明细表：`metric_id=LE-05`、`query_snapshot_id`、`resolved_lead_ids`、精确 `effective_created_at` cohort 区间和阶段代码；证据为目标/来源 ID、解析创建时间、首次阶段事件及 `occurred_at`。 |
| LE-06 首次跟进及时率 | 按每个归属周期的 `sla_instance_id` 衡量首次有效跟进是否在该实例截止前完成；每次分配、认领、重分配和重认领都生成独立实例，默认 SLA 为 README 的 `MVP-R1` 发布常量 4 小时。 | 分子：统计期内 `due_at` 落入周期、且在该实例 `due_at` 前完成的 `sla_instance_id` 数；分母：同一 `due_at` 周期内已到期或已完成的全部 `sla_instance_id` 数，未到期且未完成实例单列但不入分母，分母为 0 显示 `--`。 | `sla_instance_id`；明细保留关联 `lead_id`，不得按 `lead_id` 去重。 | 含完整 `sla_type=first_follow_up`、`runtime_policy_version=MVP-R1` 和实际 `sla_seconds` 的实例；每个实例只接受其同一归属周期内的首条有效人工跟进。排除仅系统记录、已撤回/更正无效跟进、缺少常量快照的实例和 `merge_status=已合并` 来源。 | `due_at` 为统计期字段；完成为该实例归属周期首条有效人工跟进时间；SLA 使用实例持久化的实际 `sla_seconds` 与 `runtime_policy_version=MVP-R1`。 | 北京时间（UTC+8） | 城市、来源、实例归属团队、实例负责人、分配人。 | 每 15 分钟 SLA 扫描；跟进失效、分配、认领、重分配、重认领或 SLA 实例事件后 60 秒内失效。 | 本页分析明细表：`metric_id=LE-06`、`query_snapshot_id`、`resolved_sla_instance_ids`、关联 `lead_id` 与精确 `due_at` 谓词；证据为 `sla_instance_id`、归属起点事件、`runtime_policy_version=MVP-R1`、实际 `sla_seconds`、`due_at`、实例完成跟进、达标/逾期/未到期状态。 |
| LE-07 带看率 | 周期内新增线索中截至查询快照完成至少一次成功带看的比例。 | 分子：LE-01 cohort 中截至查询快照有成功带看记录的 `lead_id` 数；分母：LE-01 `lead_id` 数；分母为 0 显示 `--`。 | 合并目标 `lead_id` | 分子含带看或之后阶段且成功带看记录有效；排除取消/无效带看、查询快照后的带看、被合并源和无带看证据阶段变更。 | 分子 `viewing_record.completed_at`；分母 `effective_created_at` | 北京时间（UTC+8） | 来源、城市、团队、经纪人、楼盘、房源、租售意向。 | 每 5 分钟；带看/合并后 60 秒内失效，日终 01:00 回算。 | 本页分析明细表：`metric_id=LE-07`、`query_snapshot_id`、分子/分母 `resolved_lead_ids`；证据为成功带看 `completed_at` 与 LE-01 cohort 角色。 |
| LE-08 转化率 | 周期内终态线索中已转化的比例。 | 分子：首次进入已转化的 `lead_id` 数；分母：首次进入已转化的 `lead_id` 数 + 首次进入已流失的 `lead_id` 数；分母为 0 显示 `--`。 | 合并目标 `lead_id` | 含已转化、已流失的首次终态事件；排除非终态、无效接入、被合并源及合同/支付推断记录。 | `lead_stage_history.occurred_at`（`converted_at`/`lost_at`） | 北京时间（UTC+8） | 来源、城市、商户、团队、经纪人、楼盘、房源、租售意向。 | 每 5 分钟；终态/合并后 60 秒内失效，日终 01:00 回算。 | 本页分析明细表：`metric_id=LE-08`、`query_snapshot_id`、分子/分母 `resolved_lead_ids` 和精确 `converted_at`/`lost_at` 时间谓词；证据为首次终态事件、终态类型、时间和集合角色，不以创建时间代替。 |
| LE-09 流失原因分布 | 周期内首次流失线索按原因的数量和占比，包含原因缺失的治理桶。 | 分子：原因成员内首次已流失 `lead_id` 数；分母：全部 `lost_at BETWEEN period_start AND period_end` 的首次已流失 `lead_id` 数，包含有效原因和“未填写”桶；分母为 0 显示 `--`。 | 合并目标 `lead_id` | 含首次已流失终态事件；流失原因缺失、为空或不可解析时归入“未填写”，计入分子及分母；排除非终态、无效接入、被合并源、撤回/更正无效事件和无权范围记录。 | `lost_at`，即首次已流失终态事件时间。 | 北京时间（UTC+8） | 城市、来源、团队、经纪人、流失原因（含“未填写”）、楼盘、房源。 | 每 5 分钟；流失/更正/合并后 60 秒内失效。 | 本页分析明细表：`metric_id=LE-09`、`query_snapshot_id`、分子/分母 `resolved_lead_ids`、流失原因及精确谓词 `lost_at BETWEEN period_start AND period_end`；“未填写”使用缺失/空/不可解析原因谓词，证据为首次流失事件、`lost_at` 和原因快照。 |
| LE-10 经纪人有效活动数 | 周期内完成至少一条有效人工跟进、成功带看或转化事件的经纪人数。 | 分子：至少有一种有效活动的合格经纪人数；分母：不适用。 | `broker_id` | 含事件时经纪人启用、双核验有效、主团队启用；排除停用/资格失效、系统自动记录、撤销更正旧版本。 | `follow_up_record.created_at`，带看为 `viewing_record.completed_at`，转化为 `converted_at` | 北京时间（UTC+8） | 城市、商户、团队、经纪人、来源。 | 每 5 分钟；活动或资格事件后 60 秒内失效。 | 本页分析明细表：`metric_id=LE-10`、`query_snapshot_id`、`resolved_broker_ids` 与关联 `resolved_lead_ids`；证据为活动类型、事件时间和事件时资格。 |
| LE-11 团队转化绩效 | 以事件时团队归属统计的团队终态转化率和转化数。 | 分子：团队 LE-08 已转化 `lead_id` 数；分母：团队首次已转化 + 首次已流失 `lead_id` 数；分母为 0 显示 `--`。 | `team_id + lead_id` | 含终态事件时有效归属团队；排除无团队、无权团队、被合并源和非终态。 | `lead_stage_history.occurred_at`（终态） | 北京时间（UTC+8） | 城市、商户、团队、来源、经纪人。 | 每 5 分钟；终态/归属历史/合并后 60 秒内失效。 | 本页分析明细表：`metric_id=LE-11`、`query_snapshot_id`、`resolved_team_ids` 与分子/分母 `resolved_lead_ids`；证据为 `converted_at`/`lost_at`、终态事件时团队归属和集合角色。 |
| LE-12 来源-楼盘/房源归因转化 | 各来源归因到接入时楼盘/房源的新增、有效商机、带看和转化量及其全来源占比。 | 分子：按事件类别分别统计来源桶内的合并目标 `lead_id` 数，楼盘/房源仅为该来源桶的进一步切分；分母：同一事件类别、当前筛选范围内的全来源 `lead_id` 总数，包含“未知来源”桶。新增：`effective_created_at BETWEEN period_start AND period_end`；有效商机：`first_valid_opportunity_at BETWEEN period_start AND period_end`；带看：`first_successful_viewing_at BETWEEN period_start AND period_end`；转化：`converted_at BETWEEN period_start AND period_end`。每类占比均为该类来源桶数量/该类全来源总数，分母为 0 显示 `--`。 | 合并目标 `lead_id + source_code + source_building_id/source_listing_id` | 含接入时来源快照及可选楼盘/房源归因，历史下架对象保留；来源缺失、为空或不可解析时归入“未知来源”并计入每类分子和分母，楼盘/房源缺失时在对应来源下单列“未归因”；排除接入拒绝、被合并源、逻辑删除、测试、无权范围及无效/撤回的业务事件。 | 新增为 `effective_created_at`；有效商机为 `first_valid_opportunity_at`；带看为 `first_successful_viewing_at`；转化为 `converted_at`，四类均只使用各自首次有效事件。 | 北京时间（UTC+8） | 来源（含“未知来源”）、来源参数、城市、楼盘/房源（含“未归因”）、商户、团队、经纪人、租售意向、事件类别。 | 每 5 分钟；接入、阶段、带看、终态或合并后 60 秒内失效，日终 01:00 回算。 | 本页分析明细表：`metric_id=LE-12`、`query_snapshot_id`、事件类别、来源/供给归因键、`resolved_lead_ids` 和该类别的精确时间谓词；新增使用 `effective_created_at BETWEEN period_start AND period_end`，有效商机使用 `first_valid_opportunity_at BETWEEN period_start AND period_end`，带看使用 `first_successful_viewing_at BETWEEN period_start AND period_end`，转化使用 `converted_at BETWEEN period_start AND period_end`；“未知来源”使用缺失/空/不可解析来源谓词，证据为接入归因快照和对应事件时间。 |

## 13. 埋点、通知与审计

埋点：`lead_analytics_view`、`lead_analytics_filter`、`lead_time_basis_change`、`lead_funnel_open`、`lead_attribution_view`、`lead_performance_switch`、`lead_analytics_drilldown`、`lead_analytics_export`。缺失来源、阶段证据、归属历史或供给归因超过 1% 时，通知具备“数据质量治理”操作权限的平台管理员及对应授权城市的运营人员；首次分配/跟进 SLA 超时由原工作台待办处理，本页不重复派发。审计保存操作者、角色、筛选、归因模型、指标 ID、快照、导出行数、脱敏策略、时间（秒）和请求 ID。

## 14. 验收标准

| 类别 | 可测试条件 |
|---|---|
| 正常 | LE-05 按固定生命周期顺序展示，所有阶段均来自 `effective_created_at` 位于所选周期的同一合并目标 cohort；阶段事件只需不晚于查询快照，相邻转化率的分子集合必须是分母集合的子集。 |
| 正常 | LE-03 以 `effective_created_at` 到首次分配或认领计算；LE-06 以每个 `sla_instance_id` 的归属起点、`due_at` 和同周期首条有效人工跟进计算。LE-06 分母仅纳入 `due_at` 落入统计期且已到期或已完成的实例，重分配/重认领全部单独计数，明细保留 `lead_id` 关联但不得按其去重；默认分别为 7200 秒（2 小时）和 14400 秒（4 小时），均使用北京时间。 |
| 正常 | LE-04 仅统计 `first_valid_opportunity_at BETWEEN period_start AND period_end` 的首次有效商机；LE-12 的新增、有效商机、带看和转化分别使用 `effective_created_at`、`first_valid_opportunity_at`、`first_successful_viewing_at`、`converted_at` 的同周期谓词，且每类来源占比的分母为该类全来源总数。 |
| 权限 | 销售主管只见本团队事件时归属，运营人员不能下钻到未授权城市客户；导出不含手机号和跟进正文。 |
| 异常 | 分母为 0 显示 `--`；LE-02 和 LE-12 的“未知来源”、LE-09 的“未填写”均计入分子和分母以保持总量守恒，楼盘/房源缺失进入“未归因”桶；更正或取消带看不重复计入；LE-06 未到期未完成实例单列，常量快照缺失进入待治理且不计入分子分母。 |
| 数据 | 历史 LE-03 和 LE-06 必须读取每条待分配、分配、认领及 SLA 事件保存的实际 `sla_seconds` 和 `runtime_policy_version=MVP-R1`，不能重算；这些值来自 README 的 `MVP-R1` 发布常量，本期无 UI 配置入口。合并来源不重复进入任一指标，阶段和终态仍按各自业务事件时间。 |
| 下钻 | LE-01 至 LE-12 均由对应 `metric_id`、`query_snapshot_id`、解析 ID 集合、精确时间谓词和逐行证据生成；LE-08 的已转化/已流失分别使用 `converted_at`/`lost_at`，不依赖线索池的泛化终态筛选。 |

## 15. 依赖与风险

依赖线索接入、去重合并、`effective_created_at` 解析、阶段与归属历史、分配/认领/SLA 事件快照、跟进/带看有效版本、人员资格、供给归因快照、README 的 MVP-R1 发布常量、权限、聚合和审计服务。风险包括历史线索缺来源/阶段证据、带看取消未回写、团队调整缺失有效时间、历史 SLA 事件缺 `runtime_policy_version=MVP-R1` 或实际值及前台咨询未落 `source_listing_id`；上线前应完成历史回填、合并回算、SLA 秒数/版本和时区抽样核验，以及分析明细与线索池/跟进记录/团队对象链接对账。

## 16. 截图参考

截图能力编号与证据路径以 [README 第 6 节](../README.md#6-截图能力追溯矩阵) 为准。

| 参考截图 | 采用能力 | 未采用能力 |
|---|---|---|
| 参考截图1 | 委托找房与区域/面积筛选，映射为来源和意向供给归因。 | 广告表单转化归因。 |
| 参考截图2 | 顾问咨询和房源详情，映射为来源到楼盘/房源关联。 | 消费者侧咨询 UI。 |
| 参考截图3 | 电话/咨询入口、租售和位置筛选，映射为线索来源与意向维度。 | 推广竞价效果。 |
| 参考截图4 | 顾问、房源和咨询承接，映射为有效跟进、带看及归因输入。 | 合同、支付和交易闭环。 |
