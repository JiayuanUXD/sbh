# Task Packet：OPT-084 后台导航信息架构评审与重设计

> 状态：**Phase 1 已实施，待推送 / PR**（2026-09-10，分支 `feat/opt-084-admin-nav-phase1-0dd5`，实施计划见 `OPT-084-phase1-plan.md`，验收证据见 `artifacts/verification/OPT-084/phase1-acceptance.md`；Phase 2 命名收口与铃铛未开始）
> 创建日期：2026-09-10
> 来源：用户要求「对后台导航目录结构进行评审，基于页面信息架构和功能，从用户体验和运营效率角度重新设计」
> 编号说明：OPT-083 已被 PR #171（详情页参数后台可配）占用，故取 084
> 分支：`docs/opt-084-admin-nav-ia-366d`（只含本文档，未提交、未推送）

---

## 1. 一句话

现有导航是一份**按数据模型分的集合目录**：10 个一级分组、40 片叶子、最深 3 级，
把「让一套房源在前台可见」这一条业务流拆进 4 个分组；而生产上唯一在用的角色 ADM
看到的正是这棵最全最重的树。建议改成**按工作流分的 8 组**：待处理队列集中一处并在
组头汇总角标、供给链（房源 / 楼盘 / 商户 / 关系 / 导入）同组、层级压到 2 级、
单叶分组自动扁平、消息通知挪到顶栏铃铛。**菜单码、操作码、角色数据一个都不动，权限零漂移。**

## 2. 证据

### 2.1 现状树（as-is，`src/domain/admin-navigation/navigation-config.ts`）

| # | 一级分组 | 叶子（按配置顺序） | 备注 |
|---|---|---|---|
| 1 | 工作台 | 运营概览 · 我的待办 · 消息通知 · 数据看板 | 两个仪表盘 + 两个个人收件箱混在一起 |
| 2 | 房源运营 | 房源列表 · 楼盘库 · 房源投放申请 · 楼盘批量导入 · 房源批量导入 · 导入批次 | 一条导入工作流占 3 片叶子 |
| 3 | 区域管理 | 城市管理 · 行政区域 · 商圈管理 · 地铁管理 · 地理别名 | 纯地理，OPT-062 后已回归 |
| 4 | 审核与风控 | 审核队列 · 举报处理 · 信息纠错 | 三个都是「等我处理」的队列 |
| 5 | 客户运营 | 咨询线索 · 客户档案 · 跟进记录 | 生产 4 / 0 / 0 条 |
| 6 | 商户合作 | 商户管理 · 城市合伙人申请 · 楼盘商户关系 | 商户与楼盘关系是有效供给 §8–§10 的门，却离房源两个分组 |
| 7 | 团队管理 | **团队管理** · 经纪人管理 · 顾问服务时间 | 组名与首叶重名 |
| 8 | 内容管理 | 站点设置 · 城市站点配置 · 页面内容 · 资讯中心 · 素材库 | |
| 9 | 表单中心 | 表单管理 · 提交数据 | Payload 插件，生产 0 / 0 条 |
| 10 | 系统管理 | 用户管理 · 角色管理 · **基础配置 ›** 配套字典 · **高级工具 ›** 搜索索引 · 领域事件 · 审计日志 | 唯一的第三级；OPS 只为「配套字典」进这一组 |

### 2.2 量化事实

| 指标 | 数值 | 取证方式 |
|---|---|---|
| 一级分组 / 叶子 / 子分组 / 最深层级 | 10 / 40 / 2 / 3 级 | 配置 + 本地 dev（e2e-adm）DOM 计数 |
| 全部展开后的导航内容高度 | 999 px（1440×1100 视口） | `.admin-navigation` 的 `scrollHeight`；首屏只看到 5 个半分组，其余靠滚动 |
| 生产后台用户 | 3 人，**全部 ADM**；OPS / MGR / BRK / CSR 为 0 | 2026-09-10 只读 SQL，`users` × `users_rels` × `roles` |
| 生产有数据的对象 | listings 2.2k · listing_reviews 4.2k · media 17k · locations 1.7k · buildings 83 · articles 100 · building_merchant_relations 48 · merchants 8 · supply_import_batches 9 · city_site_profiles 7 · pages 2 · leads 4 | 同上 |
| 生产为 0 的对象 | customers · follow_ups · listing_reports · information_corrections · supply_submissions · city_partner_applications · forms · form_submissions · tasks · notifications · location_aliases · domain_events | 同上 |
| 近 30 天有更新的对象 | listings · buildings · media · listing_reviews · merchants · supply_import_batches · audit_logs · pages | 同上 |
| 有效供给谓词涉及的分组 | 4 个（房源运营 / 区域管理 / 商户合作 / 审核与风控） | `.agent/supply.md` §1–§12 |
| 手工补 3 个楼盘商户关系 | 约 18 次点击 | OPT-045 §2.2 |

结论只有一句：**运营真实的日常在供给侧**（房源、楼盘、媒体、审核、导入、商户），
而这条链被切成了四段；CRM / 风控 / 表单 / 待办这些模块目前是空壳，却各占一个一级位置。

### 2.3 五角色实际看到的树（配置 × 生产 `roles` 表 × e2e `ROLE_NAVIGATION`）

| 角色 | 分组数 | 叶子数 | 结构问题 |
|---|---|---|---|
| ADM | 10 | 40 | 最深 3 级；全树高于视口 |
| OPS | 8 | 26 | 「系统管理 › 基础配置 › 配套字典」——为一片叶子走 3 级 |
| MGR | 4 | 12 | 「工作台」无数据看板，三片叶子里两片是空收件箱 |
| BRK | 3 | 7 | 「房源运营」只有一片叶子「房源列表」，组头纯开销 |
| CSR | 3 | 7 | 「表单中心」占三分之一导航，生产 0 条 |

### 2.4 导航相关的历史事故（说明这块是事故高发区，重构要带守卫）

- OPT-023：审核队列角标口径与页面不一致（`listing-reviews` 事件流 vs `listings.reviewStatus`）。
- OPT-045 D4 / OPT-049：三个集合漏收编、原生导航隐藏选择器写错、左下角出现「集合」区块。
- OPT-062：「城市站点配置」夹在五个地理项中间，被当成「城市管理」的第二入口，用户提问后才挪走。
- `tests/admin-nav-leaf-coverage.test.ts` 头注释：「审核队列」入口在线上消失两天无人发现，3200 单测全绿。
- OPT-056 T1：1024–1440px 视口导航可见但不可点。

## 3. 问题清单（按影响排序）

1. **分组按数据对象而非工作流切分。** 一条「房源上线」流程要在 楼盘库（房源运营）→ 楼盘商户关系（商户合作）→ 房源列表（房源运营）→ 审核队列（审核与风控）之间来回。有效供给的 12 条谓词分散在 4 个分组，运营排查「这套房源为什么前台看不到」没有一个地方能看全。
2. **待处理的东西散在 5 个分组里，且组头不显示角标。** 7 个角标分别挂在 我的待办 / 消息通知 / 审核队列 / 举报处理 / 咨询线索 / 提交数据 / 城市合伙人申请 上；分组默认折叠，折叠后角标不可见（`NavigationLeaf` 才渲染角标，`group-toggle` 没有）。角标存在的意义就是把注意力拉过去，默认态却把它藏起来了。
3. **广度过大，默认态信息量低。** ADM 10 组 40 叶，全部展开 999px 高；默认只展开当前所在组，其余 9 个组头只是 9 个名字，叶子要点开才知道。
4. **第三级只为一片叶子存在。** 「系统管理 › 基础配置」下只有「配套字典」，e2e 甚至把「只保留配套字典」写成断言；OPS 为这一片叶子要进 3 级。
5. **同一件工作两个入口、两种口径。** 「审核队列」（`/admin/collections/listing-reviews` 自定义视图）与 运营概览「待审核房源」（`/admin/collections/listings?reviewStatus=pending`）指向不同页面；OPT-023 的角标事故正是这种双口径的症状。导入工作流拆成 楼盘批量导入 / 房源批量导入 / 导入批次 三片叶子。
6. **两个仪表盘并列，职责边界不清。** 「运营概览」（今日待办 + 供给健康度）与「数据看板」（趋势 / 分布 / 流量）同在工作台，指标有重叠（房源数、可租数、线索数），用户不知道「首页」是哪一个。
7. **个人收件箱混进全局树。** 「消息通知」是「给我的」，放在与「房源列表」同级的树里不合惯例；生产 0 条也没有任何入口提示它存在。惯例是顶栏铃铛 + 未读数。
8. **空模块占一级位置。** 表单中心（0 / 0）、客户运营（4 / 0 / 0）、团队管理（1 / 1）、城市合伙人申请（0）在生产里都还没开始用，却与「房源运营」平级。这不是删功能，是它们不该在当前阶段占首屏。
9. **命名不一致、组叶重名、开发词汇外露。** 「团队管理 › 团队管理」相邻出现；「提交数据」不知道是什么的提交；「导入批次」「搜索索引」「领域事件」是工程概念；「顾问服务时间」（前台预约带看时段的配置）挂在团队管理下；「城市站点配置」要 `location:manage` 却放在内容管理。
10. **单叶分组没有兜底。** 菜单码按对象授予，角色被裁剪后常剩下「一个组头 + 一片叶子」（BRK 的房源运营、OPS 的系统管理，MGR 的商户合作被 collection access 整组隐藏也是同一机制）；解析器没有扁平化规则。
11. **找一条具体记录没有快捷路径。** Cmd/Ctrl+K 只搜地理数据；2.2k 房源、83 楼盘的日常是「找到那一套」，只能进列表再筛。导航层管不了这个，但目标 IA 要给它留位置。

## 4. 设计原则

- **P1 按工作流分组。** 每个一级分组回答「我来后台是要做什么」：处理（队列）/ 维护（资料库）/ 配置（设置）。
- **P2 最多 2 级、一级不超过 8 组。** 不再有子分组类型；默认展开态能看到当天要用的全部叶子。
- **P3 收件箱思维。** 所有「等我处理」的对象集中在一个分组，组头显示汇总角标，折叠和收起成侧栏图标时也能看到数字。
- **P4 一物一入口。** 同一工作队列只有一个 href；概览卡片、角标、导航叶子共用 `navigation-config.ts` 里的那一条。
- **P5 组叶不重名、单叶不成组。** 解析后只剩一片叶子的分组，直接扁平成一级叶子。
- **P6 用运营的语言命名。** 去掉「管理 / 中心 / 列表 / 库」这类后缀，去掉工程词汇；导航叶子标签 = 集合 `labels.plural` = 页面 h1。
- **P7 权限零漂移。** 只改分组、顺序、标签、渲染规则；`menuCodes` / `requiredOperationCode` / `collectionSlug` 逐条原样保留（OPT-062 的原则：挪位置不等于放权）。

## 5. 方案对比

| 方案 | 做法 | 收益 | 代价 / 风险 | 结论 |
|---|---|---|---|---|
| A 微调 | 保留 10 组；修重名、拍平第三级、组头汇总角标、通知挪顶栏、导入三合一 | 风险最低，纯配置 | 不解决 F1「工作流被切成四段」与 F8「空模块占一级」 | 作为 B 的第一阶段内容吸收 |
| **B 按工作流重组（推荐）** | 8 组 / ≤2 级 / 待处理集中 / 供给链同组 / 单叶扁平 / 通知进顶栏 | 直接命中 F1–F10；菜单码不动，权限零漂移 | 三处测试要重写（配置树、e2e 角色矩阵、geography-admin 的「只保留配套字典」）；组件小改 | **推荐** |
| C 按角色独立树 | ADM / 运营 / 销售 各一棵树 | 每个角色最贴身 | 5 棵树维护；自定义角色（角色复制已有）无法映射；生产只有 3 个 ADM，收益暂时为零 | 不做 |

## 6. 目标树（to-be）

href / 菜单码 / 操作码 全部沿用现状；「角标」列为组头汇总的来源。★ 为新增角标查询。

| 一级分组（图标） | 叶子 | href | 来自现状 | 角标 |
|---|---|---|---|---|
| **工作台** (dashboard) | 概览 | `/admin` | 运营概览 | |
| | 数据看板 | `/admin/analytics` | 数据看板 | |
| **待处理** (inbox) | 我的待办 | `/admin/collections/tasks` | 工作台 › 我的待办 | tasks |
| | 房源审核 | `/admin/collections/listing-reviews` | 审核队列 | listingReviews |
| | 房源举报 | `/admin/collections/listing-reports` | 举报处理 | listingReports |
| | 信息纠错 | `/admin/collections/information-corrections` | 信息纠错 | ★ 未关闭数 |
| | 投放申请 | `/admin/collections/supply-submissions` | 房源投放申请 | ★ `status=pending`（概览已算） |
| | 合伙人申请 | `/admin/collections/city-partner-applications` | 城市合伙人申请 | cityPartnerApplications |
| | 表单提交 | `/admin/collections/form-submissions` | 表单中心 › 提交数据 | formSubmissions |
| **房源与楼盘** (building) | 房源 | `/admin/collections/listings` | 房源列表 | |
| | 楼盘 | `/admin/collections/buildings` | 楼盘库 | |
| | 商户 | `/admin/collections/merchants` | 商户合作 › 商户管理 | |
| | 楼盘商户关系 | `/admin/collections/building-merchant-relations` | 商户合作 › 楼盘商户关系 | |
| | 批量导入 | `/admin/import/listings`（落地页含楼盘 / 房源两种模式 + 导入记录 tab） | 楼盘批量导入 + 房源批量导入 + 导入批次 | |
| **客户与线索** (user) | 咨询线索 | `/admin/collections/leads` | 咨询线索 | leads |
| | 客户档案 | `/admin/collections/customers` | 客户档案 | |
| | 跟进记录 | `/admin/collections/follow-ups` | 跟进记录 | |
| **站点与内容** (file) | 站点设置 | `/admin/globals/site-settings` | 站点设置 | |
| | 城市站点配置 | `/admin/collections/city-site-profiles` | 城市站点配置 | |
| | 页面 | `/admin/collections/pages` | 页面内容 | |
| | 资讯 | `/admin/collections/articles` | 资讯中心 | |
| | 素材库 | `/admin/collections/media` | 素材库 | |
| | 表单 | `/admin/collections/forms` | 表单中心 › 表单管理 | |
| **城市与区域** (location) | 城市 | `/admin/geography/cities` | 城市管理 | |
| | 行政区 | `/admin/geography/districts` | 行政区域 | |
| | 商圈 | `/admin/geography/business-areas` | 商圈管理 | |
| | 地铁线路 | `/admin/geography/metro-lines` | 地铁管理 | |
| | 地名别名 | `/admin/collections/location-aliases` | 地理别名 | |
| **团队与账号** (team) | 用户 | `/admin/collections/users` | 系统管理 › 用户管理 | |
| | 角色 | `/admin/collections/roles` | 系统管理 › 角色管理 | |
| | 团队 | `/admin/collections/teams` | 团队管理 › 团队管理 | |
| | 经纪人 | `/admin/collections/brokers` | 经纪人管理 | |
| | 顾问服务时段 | `/admin/globals/advisor-service-hours` | 顾问服务时间 | |
| **设置与工具** (settings) | 配套字典 | `/admin/collections/amenities` | 系统管理 › 基础配置 › 配套字典 | |
| | 审计日志 | `/admin/collections/audit-logs` | 高级工具 › 审计日志 | |
| | 搜索索引 | `/admin/collections/search` | 高级工具 › 搜索索引 | |
| | 领域事件 | `/admin/collections/domain-events` | 高级工具 › 领域事件 | 见 §13-2，建议退出导航 |
| 顶栏 | 通知铃铛（未读数） | `/admin/collections/notifications` | 工作台 › 消息通知 | notifications |

8 组 / 37 叶（导入三合一后；三合一未做之前是 39 叶）/ 最深 2 级。组的顺序按使用频率：
工作台 → 待处理 → 房源与楼盘 → 客户与线索 → 站点与内容 → 城市与区域 → 团队与账号 → 设置与工具。

**为什么「商户」进「房源与楼盘」而不是单独一组**：商户的启用 / 资质 / 服务城市（有效供给 §9–§10）
和楼盘商户关系（§8）决定房源能不能上前台，它们是供给链的一环，不是一个独立的「合作」业务。
生产 8 个商户、48 条关系，也撑不起一个一级分组。

**为什么「咨询线索」不进「待处理」**：线索既是队列（新线索 / 逾期跟进）也是资料库，
拆成两个入口就违反 P4。角标留在「客户与线索 › 咨询线索」上，由组头汇总。

## 7. 五角色视图对比（按现有菜单码 / 操作码 / collection access 推演）

| 角色 | 现状 | 目标 | 变化 |
|---|---|---|---|
| ADM | 10 组 / 40 叶 / 3 级 | 8 组 / 37 叶 / 2 级 | 待处理 7 项集中；供给链同组 |
| OPS | 8 组 / 26 叶 | 6 组 + 1 扁平叶（配套字典）/ 23 叶 | 「系统管理 › 基础配置 › 配套字典」三级变一级 |
| MGR | 4 组 / 12 叶 | 4 组 + 1 扁平叶（概览）/ 11 叶 | 投放申请进待处理 |
| BRK | 3 组 / 7 叶（其中一组只有 1 叶） | 1 组 + 3 扁平叶（概览 · 我的待办 · 房源）/ 6 叶 | 消灭单叶分组 |
| CSR | 3 组 / 7 叶 | 2 组 + 2 扁平叶（概览 · 表单）/ 6 叶 | 表单提交进待处理 |

角色间的差异**完全由现有权限数据决定**，本工作项不改任何一条权限。

## 8. 命名映射

| 现状 | 目标 | 理由 |
|---|---|---|
| 运营概览 | 概览 | 组名已是「工作台」 |
| 房源列表 / 楼盘库 | 房源 / 楼盘 | 去掉「列表 / 库」后缀 |
| 房源投放申请 | 投放申请 | 在「待处理」里语境已明确 |
| 楼盘批量导入 · 房源批量导入 · 导入批次 | 批量导入（页内切模式 + 导入记录 tab） | 一条工作流一个入口 |
| 城市管理 / 行政区域 / 商圈管理 / 地铁管理 / 地理别名 | 城市 / 行政区 / 商圈 / 地铁线路 / 地名别名 | 组名「城市与区域」已表意 |
| 审核队列 / 举报处理 | 房源审核 / 房源举报 | 队列里要说清对象 |
| 商户管理 | 商户 | |
| 城市合伙人申请 | 合伙人申请 | |
| 团队管理 › 团队管理 / 经纪人管理 | 团队 / 经纪人 | 消除组叶重名 |
| 顾问服务时间 | 顾问服务时段 | 它配置的是时段表（每周时段 + 例外日） |
| 页面内容 / 资讯中心 | 页面 / 资讯 | |
| 表单管理 / 提交数据 | 表单 / 表单提交 | 「提交数据」不知所指 |
| 用户管理 / 角色管理 | 用户 / 角色 | |

约束：导航叶子标签必须等于集合 `labels.plural`（Payload 用它渲染 h1 与面包屑），
改名要连 collection 配置一起改，否则 e2e 的「h1 = 叶子标签」断言会红；labels 不入库，无迁移。

## 9. 交互规则

1. **组头汇总角标**：组头显示子叶角标之和（`formatBadgeCount` 同样封顶 99+）；侧栏收起成 48px 图标时，图标右上角显示同一数字；浮层里各叶再显示各自的数。
2. **默认展开策略**：首次进入展开「待处理」+「房源与楼盘」+ 当前所在组；用户手动开合后按用户记住（沿用 `sbh-admin-nav-collapsed` 的 localStorage 方式，新键存展开集）。
3. **单叶分组扁平化**：`resolveAdminNavigation` 在解析后把只剩一片叶子的组替换成一级叶子（用组图标）；放在服务端解析器里，e2e 才能对五角色逐一断言。
4. **通知铃铛**：新增 `admin.components.actions` 组件，未读数来源沿用 `notifications` 角标查询；导航树里不再有「消息通知」。
5. **一物一入口**：`DashboardOverview` 的待办卡片 href 从 `navigation-config.ts` 取，不再各写一份（今天「待审核房源」指向 listings 筛选、导航指向 listing-reviews，就是两份的结果）。
6. **深度守卫**：类型上删掉 `AdminNavSubgroup`，`navigation-state.ts` / `AdminNavigationClient.tsx` 里的子分组分支一并删除——少一层就少一套开合状态。

## 10. 分阶段实施

### Phase 1 —— 纯配置 + 渲染规则（约 1 天）

- `navigation-config.ts`：按 §6 重排；导入暂保留三片叶子（楼盘批量导入 / 房源批量导入 / 导入记录）。
- `navigation-types.ts` / `resolve-navigation.ts` / `navigation-state.ts` / `AdminNavigationClient.tsx`：删子分组；加扁平化；加组头汇总角标；加默认展开集。
- `navigation-badges.ts` + `admin-navigation-endpoint.ts`：新增 `supplySubmissions`、`informationCorrections` 两条角标查询（权限判据分别沿用 `supply_submission:read`、`correction:read`）。
- 测试：重写 `tests/admin-navigation-config.test.ts`（树快照）；更新 `tests/e2e/admin-navigation.spec.ts` 的 `ALL_LEAF_LABELS` 与 `ROLE_NAVIGATION`（`admin-nav-leaf-coverage.test.ts` 会强制同步）；改 `tests/e2e/geography-admin.spec.ts` 里「基础配置只保留配套字典」的断言；新增扁平化、汇总角标、深度 ≤ 2 三条单测。
- 命名收口（§8）可与本阶段同批，也可拆出去（见 §13-4）。

### Phase 2 —— 两个小组件（约 1 天）

- 顶栏通知铃铛（`/components/admin/NotificationBell`）。
- `DashboardOverview` 待办卡片 href 改为复用导航配置。
- 批量导入落地页：`BulkImportView` 已按 pathname 解析模式，加一个模式切换与「导入记录」tab，三片叶子并成一片。

> **2026-09-10 补**：用户裁定后台任务按域纵切（见 OPT-085 §7）。Phase 1 保持为独立 PR 先行（导航是单配置文件，整体一次改）；Phase 2 的「批量导入三合一」并入房源域 OPT-086 §5.8，「通知铃铛」与「概览卡片复用导航 href」保留在本项，随第一个域一起上。

### Phase 3 —— 待裁定项

- 「领域事件」退出导航（取决于 OPT-043 的删 / 接 / 拆裁定；退出只是不进树，`group: false` 路由仍在）。
- Cmd/Ctrl+K 扩到房源 / 楼盘 / 商户（`GeographyQuickSearch` 现只搜地理），这是 F11 的正解。
- 空模块的阶段性可见性（CRM / 表单等未启用时是否对 ADM 也折到底部）——先看 Phase 1 上线后 ADM 的反馈再定，不预先建机制。

## 11. 测试守卫（新增或重写）

| 守卫 | 断言 |
|---|---|
| 树快照 | `ADMIN_NAV_GROUPS` 与 §6 逐项一致（组顺序、叶顺序、href、菜单码） |
| 深度 | 任意组的 children 里没有带 `children` 的项 |
| 权限零漂移 | 每个 href 的 `menuCodes` / `requiredOperationCode` / `collectionSlug` 与重构前的快照一致（重构前先把现状 dump 成 fixture） |
| 扁平化 | 只剩一叶的组解析成一级叶；两叶及以上保持为组 |
| 汇总角标 | 组头数 = 子叶之和；封顶 99+ |
| 一物一入口 | 概览待办卡片的 href 都能在导航配置里找到同一条 |
| e2e 五角色 | 每个角色的组数、扁平叶数、代表叶可达；无权叶直访 403 / 404（沿用现有用例） |
| e2e 视口 | 1200px 与 1440px 下组头可点、无 `inert`（OPT-056 T1 回归） |

## 12. 明确不做

- 不改菜单码、操作码、字段码，不改 `roles` 表数据。
- 不做方案 C（按角色独立树）。
- 不删任何路由；退出导航的集合保持 `group: false` 可直达。
- 不把 DisplayTags / LeadOwnershipHistory / exports / imports 收编（既有裁定，见 `bf0d88f` 与 OPT-049 §4）。
- 不做导航后台可配（OPT-054 说的是 C 端主导航，另一回事）。
- 不改「运营概览」与「数据看板」的页面内容，只定位它们的关系（行动 vs 洞察）。

## 13. 未决（需裁定）

1. ~~「顾问服务时段」归「团队与账号」还是「站点与内容」。~~ **已裁定（2026-09-10）：留在「团队与账号」。**
2. ~~「领域事件」是否退出导航。~~ **已裁定：退出导航**；`DomainEvents` 保持 `group:false`，路由与 `domain-events` / `events:read` 码不动；OPT-043 裁定后若要接回，只需加回一片叶子。
3. ~~「数据看板」与「概览」是否并存。~~ **已裁定：并存**，都在「工作台」。
4. ~~命名收口与结构重组同批还是拆开。~~ **已裁定：拆成第二个 PR**；Phase 1 所有叶子标签一字未改（`tests/admin-navigation-permission-drift.test.ts` 钉死）。
5. ~~批量导入三合一进 Phase 1 还是 Phase 2（要动 `BulkImportView` 路由）。~~ **已解决（2026-09-10）**：并入房源域 OPT-086 PR 5；Phase 1 保留三片叶子（楼盘批量导入 / 房源批量导入 / 导入记录）。

> 本项在整体程序中的位置：**PR 0 前置**（见 OPT-085 §7、OPT-086 §7）。上面 1–4 条裁定后即可开工，不等任何域。

## 14. 实施后的验证清单

- [x] 五个 E2E 夹具账号各登录一次，逐组展开，组数 / 叶数 / 扁平叶与预期一致（Phase 1 实测：ADM 8 组 39 叶；OPS 5 组 + 扁平「配套字典」24 叶；MGR 5 组 12 叶；BRK 2 组 + 扁平「我的待办」「房源列表」7 叶；CSR 3 组 + 扁平「表单管理」7 叶。§7 表里的 OPS 数字按 `canReadCollection` 恒真推演，实际因 collection 读权限少两片，见验收文档 §1.1）。
- [x] 组头汇总角标：用夹具里「消息通知 2 条」验证——折叠「工作台」后组头显示 2；收起侧栏后图标右上显示 2。warning 变体（审核 / 举报等）本地无数据未取样。
- [ ] 通知铃铛（Phase 2，未做）。
- [x] 1200px 视口组头可点、无 `inert`；深浅两主题角标与扁平叶核对。
- [ ] 概览待办卡片复用导航 href（Phase 2，未做）。
- [x] `pnpm typecheck && pnpm lint && pnpm test` 全绿（含 `admin-nav-leaf-coverage`）；e2e 单 spec 本地 15/16（余 1 为 `next dev` JIT 超时，CI 用生产 server）；CI 全量待推送后验证；证据 `artifacts/verification/OPT-084/phase1-acceptance.md`。
