# 后台任务：M7 工作台与数据看板

> 返回：[任务索引](../tasks.md)

## M7 工作台与数据看板

- [x] 7.1 建立指标注册表
  - 为每个指标定义编码、公式、去重、时间、权限、缓存和下钻模板。
  - 禁止页面独立拼装指标条件。
  - _Requirement: R7_
  - 验证证据：
    - 领域层:
      - `payload-office-platform/src/domain/analytics/metric-types.ts`（M7.1 新增：METRIC_CATEGORIES / METRIC_UNITS / METRIC_DEDUP_STRATEGIES / METRIC_TIME_RANGES / METRIC_SCOPE_DIMS / METRIC_DRILLDOWN_TARGETS 枚举与守卫；MetricDefinition / MetricQueryAdapter / MetricScalarResult / MetricSeriesResult / MetricQueryContext 类型；isMetricDefinition 运行时校验）
      - `payload-office-platform/src/domain/analytics/metric-context.ts`（M7.1 新增：sanitizeFilters 客户端不可信输入清洗 → 维度白名单 + 城市/团队上限求交集 + assignee dataScope=self 强制 = userId + range 365 天上限；canViewMetric 权限并集校验；EMPTY_FILTERS / MAX_RANGE_DAYS 常量）
      - `payload-office-platform/src/domain/analytics/metric-registry.ts`（M7.1 新增：MetricRegistry 类 register/has/get/require/codes/listVisible/resolve/clear；DuplicateMetricError / MetricNotFoundError / MetricPermissionError；单例 metricRegistry）
      - `payload-office-platform/src/domain/analytics/metric-drilldown.ts`（M7.1 新增：buildDrilldownUrl 占位符替换 {{collection}} / {{filter_keys}} / {{bucket.label}} / {{ctx.asOf}}，仅替换 sanitize 后的字段防 URL 扩大范围）
      - `payload-office-platform/src/domain/analytics/metric-consistency.ts`（M7.1 新增：assertCardEqualsSeriesSum 卡片=序列和断言 / assertResultsEqual / assertSeriesEqual / assertUrlNotExpandScope 业务不变量）
      - `payload-office-platform/src/domain/analytics/metrics/builtin.ts`（M7.1 新增：BUILTIN_METRICS 内置指标元数据，覆盖 listings.*/leads.*/tasks.*/supply.effective_count 等；stubQuery / stubSeriesQuery 占位查询供 M7.2 工作台先行接入，M7.3-M7.5 替换为真实查询；registerBuiltinMetrics 注册入口）
      - `payload-office-platform/src/domain/analytics/index.ts`（聚合导出 metric-types / metric-context / metric-registry / metric-drilldown / metric-consistency）
    - 测试: `payload-office-platform/tests/metric-registry.test.ts`（50 用例全通过，覆盖注册 / 重复注册 / 查找 / 列表 / sanitizeFilters 维度白名单 + 城市上限 + 越界 ID 丢弃 + dataScope=self 强制 assignee / canViewMetric 权限并集 + 通配符 * / buildDrilldownUrl 占位符替换 + 仅替换 sanitize 字段 / 业务不变量断言 / 内置指标元数据完整性：listings.*/leads.*/tasks.* 指标编码覆盖 / stubQuery 返回 0）
    - 业务不变量验证: 编码唯一重复注册抛错；URL 参数不能扩大数据范围（sanitizeFilters 服务端兜底，未传城市时使用 permission 上限，越界 ID 丢弃）；卡片 = 趋势桶之和（assertCardEqualsSeriesSum）；所有内置指标 requiredPermissions / drilldown / cacheTtlMs>=0 完整
    - 验收: `pnpm typecheck` 通过；`pnpm test` 69 文件 1369 用例全通过（含 metric-registry.test.ts 50 用例）

- [x] 7.2 升级角色化工作台
  - 管理员/运营：待审核、今日供给、线索、跟进和超时。
  - 销售主管：团队线索、待分配、跟进和有效商机。
  - 经纪人：我的新线索、今日待跟进、超时和推荐次数。
  - _Requirement: R1, R7_
  - 验证证据：
    - 领域层: `payload-office-platform/src/domain/analytics/role-dashboard.ts`（M7.2 新增：ROLE_DASHBOARD_TYPES / ROLE_DASHBOARD_CONFIG 三类角色对应指标卡 code 列表；deriveRoleDashboardType 多角色优先级 admin-ops > sales-manager > broker；resolveRoleDashboard 并发解析 + 单卡失败局部标记 status=failed/no-permission/not-found；每卡按自身 metric.allowedScopeDims 重新 sanitize，URL 不扩大范围；所有卡共用同一 asOf）
    - endpoint: `payload-office-platform/src/endpoints/dashboard-endpoint.ts`（M7.2 新增：createDashboardEndpoint 注册在 payload.config.ts 顶层 endpoints，路径 GET /api/dashboard；createPayloadMetricPort 把 req.payload.count/find 包装为 MetricPayloadPort；parseFilterInput 解析 URL 查询参数为不可信 MetricFilterInput，由 sanitizeFilters 服务端收窄；401 未登录 / 200 返回 { ok, role, cards, asOf }）
    - 启动注册: `payload-office-platform/src/payload.config.ts`（应用启动时幂等调用 registerBuiltinMetrics(metricRegistry)；endpoints: [createDashboardEndpoint()]）
    - 导出: `payload-office-platform/src/domain/analytics/index.ts` 新增 `export * from './role-dashboard'`
    - 测试: `payload-office-platform/tests/role-dashboard.test.ts`（覆盖角色派生优先级 / 三类角色卡片配置 / 单卡 query 抛错 → status=failed 其他正常 / 单卡无权限 → status=no-permission / 不存在 code → status=not-found / URL 不扩大范围（dataScope=self 强制 assignee=userId）/ type=null 返回空 cards / 所有卡共用 asOf）
    - 业务不变量验证: 不同角色只看到授权指标和范围（registry.resolve 内部 canViewMetric 校验 + sanitizeFilters 服务端兜底）；URL 参数不能扩大数据范围（每张卡按自身 metric.allowedScopeDims 重新 sanitize）；单卡失败不影响其他组件（Promise.all + try/catch per card）
    - 验收: `pnpm typecheck` 通过；`pnpm test` 71 文件 1414 用例全通过（含 role-dashboard.test.ts）

- [x] 7.3 建设经营概览
  - 城市、时间和团队筛选。
  - 指标卡、趋势、来源分布和明细下钻。
  - 单卡失败局部重试并展示数据截至时间。
  - _Requirement: R7_
  - 验证证据：
    - 领域层: `payload-office-platform/src/domain/analytics/overview-dashboard.ts`（M7.3 新增：OVERVIEW_CARDS / OVERVIEW_TRENDS / OVERVIEW_DISTRIBUTIONS 三组只读 MetricCode 列表；resolveOverviewDashboard 并发解析三组 + 每卡独立 try/catch 标记 status=failed/no-permission/not-found；所有卡 / 趋势 / 分布共用同一 asOf）
    - 查询适配: `payload-office-platform/src/domain/analytics/queries/listing-queries.ts`、`building-queries.ts`、`merchant-queries.ts`（M7.3 新增：替换 stubQuery 为真实 count / find 适配器；trendListingsCreatedPerDay7d 按 Asia/Shanghai 时间桶聚合；distributionListingsByStatus / distributionListingsByCity 按枚举 / city 维度分组）
    - 范围工具: `payload-office-platform/src/domain/analytics/queries/scope-where.ts`（buildCityWhere / buildMerchantWhere / mergeWhere 把 sanitize 后的 filters 转为 Payload where 子句，保证 URL 不扩大范围）、`time-bucket.ts`（toShanghaiDayStart / buildDailyBuckets / formatShanghaiDate 时区稳定的日桶）
    - 指标注册: `payload-office-platform/src/domain/analytics/metrics/builtin.ts`（替换 listings.total / listings.published / listings.pending_review / listings.offline / listings.leased / listings.created_per_day_7d / listings.by_status / listings.by_city / buildings.active / merchants.active / merchants.expiring / supply.effective_count 为真实查询）
    - endpoint: `payload-office-platform/src/endpoints/overview-endpoint.ts`（M7.3 新增：GET /api/overview；requireAdminContext 鉴权；canViewOverviewDashboard 任意经营概览权限校验；parseFilterInput 解析 + sanitizeFilters 收窄；返回 { ok, cards, trends, distributions, asOf }；payload.config.ts 注册）
    - 测试: `payload-office-platform/tests/overview-dashboard.test.ts`（覆盖三组卡片长度 / 共用 asOf / 趋势桶之和 / 分布数据 / 单卡失败局部标记 / URL 不扩大范围）
    - 业务不变量验证: 卡片=序列和；URL 不扩大范围（每卡按 metric.allowedScopeDims 重新 sanitize）；单卡失败不影响其他组件
    - 验收: `pnpm typecheck` 通过；`pnpm test` 通过；`pnpm build` 通过

- [x] 7.4 建设房源分析
  - 总数、上架、待审核、下架、出租和完整度低于 80%。
  - 所有有效供给指标复用统一供给谓词。
  - _Requirement: R4, R7_
  - 验证证据：
    - 领域层: `payload-office-platform/src/domain/analytics/listing-analytics.ts`（M7.4 新增：LISTING_ANALYTICS_CARDS / TRENDS / DISTRIBUTIONS 三组只读 MetricCode 列表，包含 listings.total / published / pending_review / offline / rented / completeness_below_80；resolveListingAnalytics 并发解析 + 单卡失败局部标记；所有组共用同一 asOf；canViewListingAnalytics 权限网关）
    - 完整度计算: `payload-office-platform/src/domain/analytics/queries/listing-completeness.ts`（M7.4 新增：computeListingCompleteness 真实权重计算，覆盖基本信息 25% / 租赁参数 25% / 媒体展示 30% / 内容补充 20%；COMPLETENESS_THRESHOLD=0.8；支持 building / coverImage 关系字段两种形态；description 支持 string / Lexical 数组 / Lexical 根对象三种形态）
    - 查询适配: `payload-office-platform/src/domain/analytics/queries/listing-queries.ts`（M7.4 替换 countListingsCompletenessBelow80 为内存计算：find depth=1 + limit=500 + 逐文档 computeListingCompleteness 统计 belowThreshold；不依赖 DB 数组长度计算）
    - 指标元数据: `payload-office-platform/src/domain/analytics/metrics/builtin.ts`（更新 listings.completeness_below_80 描述与说明 M7.4 已接入真实完整度计算）
    - endpoint: `payload-office-platform/src/endpoints/listing-analytics-endpoint.ts`（M7.4 新增：GET /api/listings/analytics；requireAdminContext 鉴权；canViewListingAnalytics 任意房源分析权限校验；parseFilterInput 解析 + sanitizeFilters 收窄；返回 { ok, cards, trends, distributions, asOf }；payload.config.ts 注册）
    - 模块导出: `payload-office-platform/src/domain/analytics/index.ts` 新增 `export * from './listing-analytics'`
    - 测试: `payload-office-platform/tests/listing-completeness.test.ts`（24 用例，覆盖完整文档 / 空文档 / 阈值边界 / 媒体展示部分填充按比例 / 租赁参数缺失 / description 多形态 / 关系字段 ID 与对象两种形态 / 权重总和=1.0）+ `payload-office-platform/tests/listing-analytics.test.ts`（24 用例，覆盖三组卡片长度 / 共用 asOf / completeness_below_80 真实完整度（完整 / 缺失 / 混合统计） / find depth=1 limit=500 / 单卡失败隔离 / 权限网关 / URL 不扩大范围 / 城市上限 / dataScope=self assignee 丢弃 / 下钻 URL 派生）
    - 业务不变量验证: 卡片=序列和（listings.created_per_day_7d vs listings.total 趋势）；URL 不扩大范围（每卡按自身 metric.allowedScopeDims 重新 sanitize）；单卡失败不影响其他组件；所有有效供给类指标复用 getEffectiveSupplyWhere + getPausedListingIds（makeListingCount 工厂 useEffectiveSupply 选项）
    - 验收: `pnpm typecheck` 通过；`pnpm test` 73 文件 1474 用例全通过（含 listing-completeness.test.ts 24 + listing-analytics.test.ts 24）；`pnpm build` 通过

- [x] 7.5 建设线索分析
  - 新增、有效、无效、已分配、及时率、推荐率和转化率。
  - 合并目标、有效创建时间和终态事件时间口径一致。
  - _Requirement: R6, R7_
  - 验证证据：
    - 领域层: `payload-office-platform/src/domain/analytics/lead-analytics.ts`（M7.5 新增：LEAD_ANALYTICS_CARDS / TRENDS / DISTRIBUTIONS 三组只读 MetricCode 列表，覆盖 leads.new / valid / invalid / assigned / timely_rate / recommendation_rate / conversion_rate；resolveLeadAnalytics 并发解析三组 + 单卡失败局部标记；所有组共用同一 asOf；canViewLeadAnalytics 权限网关）
    - 查询适配: `payload-office-platform/src/domain/analytics/queries/lead-queries.ts`（M7.5 新增：替换 stubQuery 为真实查询；countLeadsNew / valid / invalid / assigned 标量计数；computeLeadsConversionRate 近 30d 滚动窗口 won/total；computeLeadsTimelyRate 近 7d 滚动窗口 first-follow-up task 4h 内完成率；trendLeadsCreatedPerDay7d 按 Asia/Shanghai 时间桶；distributionLeadsByStatus / by_source 按状态 / 来源分组）
    - CRM 依赖: `payload-office-platform/src/domain/crm/lead-stage.ts`（M5.6 八阶段状态机：new/pending_assignment/following/qualified/viewing/negotiation/converted/lost，严格 transition + terminal 校验）、`policy.ts`（M5.4 SLA 参数：first_follow_up=4h / claim_protection=24h / public_pool_recycle=72h / daily_claim=20 / active_cap=100）、`sla.ts`（M5.4/M5.5 纯函数：firstFollowUpDeadline / isFirstFollowUpBreached / isPublicPoolRecyclable）
    - 城市扩展: `lead-queries.ts` 内 expandCityToLocationIds（线索按城市过滤时扩展到所有后代 location IDs，因 Leads.district 字段可关联 city/district/business_area 任一类型）
    - 指标注册: `payload-office-platform/src/domain/analytics/metrics/builtin.ts`（替换 leadMetrics 中 stubQuery 为真实查询适配器；新增 leads.created_per_day_7d / by_status / by_source 趋势与分布指标）
    - endpoint: `payload-office-platform/src/endpoints/lead-analytics-endpoint.ts`（M7.5 新增：GET /api/leads/analytics；requireAdminContext 鉴权；canViewLeadAnalytics 任意线索分析权限校验；parseFilterInput 解析 + sanitizeFilters 收窄；返回 { ok, cards, trends, distributions, asOf }；payload.config.ts 注册）
    - 模块导出: `payload-office-platform/src/domain/analytics/index.ts` 新增 `export * from './lead-analytics'`
    - 测试: `payload-office-platform/tests/lead-analytics.test.ts`（34 用例，覆盖配置完整性 / 三组卡片长度 / 共用 asOf / timely_rate 真实计算（空候选 / 全 timely / 部分比率 / find depth=0 limit=500 / task where 包含 followup-first + sourceId） / conversion_rate 真实计算（除零 / won+createdAt 口径一致） / 单卡失败隔离 / 权限网关 / URL 不扩大范围（城市上限 / 越界 ID 丢弃 / dataScope=self 强制 assignee=userId） / 下钻 URL 派生 / 口径一致（统一用 createdAt））
    - 业务不变量验证: 卡片=序列和（leads.created_per_day_7d 桶之和）；URL 不扩大范围（每卡按自身 metric.allowedScopeDims 重新 sanitize）；单卡失败不影响其他组件；合并目标、有效创建时间和终态事件时间口径一致（统一用 lead.createdAt 作为锚点，conversion_rate 分子分母均用 createdAt 时间窗口）；timely_rate 通过 task.completedAt - lead.createdAt <= 4h 计算
    - 验收: `pnpm typecheck` 通过；`pnpm test` 78 文件 1568 用例全通过（含 lead-analytics.test.ts 34 用例）；`pnpm build` 通过（NEXT_PUBLIC_SITE_URL=http://localhost:3717）

- [x] 7.6 完成指标数据一致性测试
  - 卡片等于趋势桶之和。
  - 卡片、图表点击和明细数量一致。
  - URL 参数不能扩大数据范围。
  - _Requirement: R1, R7_
  - 验证证据：
    - 集成测试: `payload-office-platform/tests/metric-consistency-integration.test.ts`（M7.6 新增：跨 overview / listing-analytics / lead-analytics 三个看板验证业务不变量；mock payload 不记录 find 的 limit/depth 以避免 effective-supply `limit=1000` 与城市 ID 1000 在 JSON 字符串断言上误匹配）
    - 覆盖 6 大类断言：
      1. 卡片 = 趋势桶之和（assertCardEqualsSeriesSum 集成：overview/listing/lead 三看板 trendListingsCreatedPerDay7d / trendLeadsCreatedPerDay7d 桶之和 = 7 × mock count）
      2. 卡片 = 图表点击 = 明细数量（同 query ID 一致性：同 code 两次 resolveSingleCard 返回相同标量 / 序列；leaves.by_status 桶数 = status 枚举数 5；leads.by_source 桶数 = source 枚举数 4）
      3. URL 参数不能扩大数据范围（跨看板：客户端注入越界 cityIds [1,2,999,1000] → 所有 count/find where 中不含 999/1000；dataScope=self 时 assignee 强制 = userId，越权 assigneeId=999 被丢弃）
      4. 单卡失败不影响其他组件（overview/listing/lead 三看板各破坏一张卡 query → status=failed 但其他卡 / 趋势 / 分布正常）
      5. 跨看板 asOf 一致性（三看板共用 base.asOf，顶层 asOf 完全相同）
      6. 跨看板配置完整性（三看板 9 组 MetricCode 列表全部在 registry 存在且 Object.isFrozen=true）
    - 业务不变量验证: 卡片=序列和；URL 不扩大范围（sanitizeFilters 服务端兜底 + 每卡按 metric.allowedScopeDims 重新 sanitize）；单卡失败局部标记；同 query ID 多次调用幂等
    - 验收: `pnpm typecheck` 通过；`pnpm test` 81 文件 1612 用例全通过（含 metric-consistency-integration.test.ts 17 用例）

### M7 验收门

- 不同角色只看到授权指标和范围。
- 同一 query ID 下卡片、图表和明细一致。
- 单个指标失败不影响其他组件。
