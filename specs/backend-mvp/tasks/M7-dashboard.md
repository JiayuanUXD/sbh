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
