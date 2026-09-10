# OPT-084 Phase 1 实施计划：后台导航整体切换（结构 + 渲染规则 + 角标 + 测试）

> 母文档：`OPT-084-admin-nav-ia-redesign.md`（§6 目标树、§9 交互规则、§10 Phase 1、§13 裁定）
> 分支：`feat/opt-084-admin-nav-phase1-0dd5`（基于 `origin/master` @ `c76e6d9`）
> 执行方式：subagent-driven-development，四个任务**串行**，每个任务一个实施代理 + 一个审查代理
> 应用目录：`E:\github\sbh\payload-office-platform`（下文路径均相对它）

## 裁定（2026-09-10，用户按建议裁定，实施时不得再议）

1. 「顾问服务时间」留在「团队与账号」。
2. 「领域事件」**退出导航**：删掉那片叶子；`DomainEvents` collection 保持 `group: false`，路由 `/admin/collections/domain-events` 仍可直达；菜单码 `domain-events` 与操作码 `events:read` 不动。
3. 「数据看板」与「运营概览」并存，都在「工作台」。
4. **命名收口拆到第二个 PR。本阶段所有叶子标签一字不改。** 只改分组、顺序、层级、渲染规则。

## 全局约束（每个任务都受约束，审查按此逐条核）

- **G1 权限零漂移**：现有每片叶子的 `href`、`menuCodes`、`requiredOperationCode`、`collectionSlug`、`badgeKey`、`id` 与 `origin/master` 上的 `navigation-config.ts` **逐字相同**。允许的差异只有三处：删 `domain-events` 叶；`information-corrections` 叶新增 `badgeKey: 'informationCorrections'`；`supply-submissions` 叶新增 `badgeKey: 'supplySubmissions'`。
- **G2 标签不动**：39 片叶子的 `label` 与 master 相同（见 Task 1 树表）。
- **G3 深度 ≤ 2**：不再存在子分组（`AdminNavSubgroup` 类型与一切 `subgroup` 渲染/状态代码删除）。
- **G4 不改权限数据**：不动 `roles` 表、`permission-codes.ts`、`src/test/factory/roles.ts`、`scripts/seed.ts`、任何迁移。
- **G5 不引新依赖**：图标只用 `@arco-design/web-react/icon`；不装包。
- **G6 只用显式 `git add <路径>`**；禁止 `git add -A` / `git add .` / `-am`；禁止 `--no-verify`；不碰 `public/prd/*`；不 push、不建 PR。
- **G7 提交前**：`pnpm typecheck && pnpm lint && pnpm test` 三项全绿（开发中可跑局部测试，提交前必须全量）。提交信息简体中文，前缀 `feat(admin-nav):` / `test(admin-nav):`。
- **G8 不改文档**：`specs/`、`artifacts/`、`CLAUDE.md`、`.agent/` 由控制者维护，实施代理不动。
- **G9 注释用简体中文**，说明「为什么」而不是「做了什么」。
- **G10 `payload.config.ts` 不动**：本阶段不新增需要注册的组件，因此**不需要**重生成 importMap；若某任务确需新增注册组件，先停下报告。

## 目标树（Phase 1 版本；标签 = master 现值）

组 `id` / 标签 / 图标键 → 叶子（`id` · 标签 · href · menuCodes · 其它选项）。所有叶子定义**从 master 原样搬运**，只换所属组与顺序。

| 组 | 叶子（按顺序） |
|---|---|
| `workspace` 工作台 `dashboard` | `overview` 运营概览 `/admin` `['dashboard']` · `notifications` 消息通知（原样，含 `collectionSlug`/`notification:read`/`badgeKey:'notifications'`）· `analytics` 数据看板 `/admin/analytics` `['analytics']` |
| `inbox` 待处理 `inbox`（**新图标键**） | `my-tasks` 我的待办（原样）· `listing-reviews` 审核队列（原样，`badgeKey:'listingReviews'`）· `listing-reports` 举报处理（原样）· `information-corrections` 信息纠错（原样 **+ `badgeKey:'informationCorrections'`**）· `supply-submissions` 房源投放申请（原样 **+ `badgeKey:'supplySubmissions'`**）· `city-partner-applications` 城市合伙人申请（原样）· `form-submissions` 提交数据（原样） |
| `supply` 房源与楼盘 `building` | `listings` 房源列表 · `buildings` 楼盘库 · `merchants` 商户管理 `['merchants']` · `building-merchant-relations` 楼盘商户关系（原样）· `import-buildings` 楼盘批量导入（原样）· `import-listings` 房源批量导入（原样）· `supply-import-batches` 导入批次（原样） |
| `crm` 客户与线索 `user` | `leads` 咨询线索（原样）· `customers` 客户档案（原样）· `follow-ups` 跟进记录 |
| `content` 站点与内容 `file` | `site-settings` 站点设置（原样）· `city-site-profiles` 城市站点配置（原样）· `pages` 页面内容 · `articles` 资讯中心 · `media` 素材库 · `forms` 表单管理 `['forms']` |
| `geography` 城市与区域 `location` | `cities` 城市管理 · `districts` 行政区域 · `business-areas` 商圈管理 · `metro-lines` 地铁管理 · `location-aliases` 地理别名（原样，全部含 `collectionSlug`/`location:manage` 等原有选项） |
| `org` 团队与账号 `team` | `users` 用户管理 · `roles` 角色管理 · `teams` 团队管理 · `brokers` 经纪人管理 · `advisor-service-hours` 顾问服务时间 `['teams','brokers']` |
| `system` 设置与工具 `settings` | `amenities` 配套字典 `['dictionaries']` · `audit-logs` 审计日志（原样，`audit:view`）· `search` 搜索索引 `['search']` |

共 8 组 / 39 叶（master 是 10 组 / 40 叶 / 2 子分组）。**删除的叶子只有 `domain-events`。**

## 渲染契约（Task 1 定，Task 2 / Task 4 依赖）

- 解析结果改为判别联合：
  ```ts
  export type ResolvedAdminNavLeaf = { id: string; label: string; href: string; badgeKey?: AdminNavigationBadgeKey }
  export type ResolvedAdminNavGroup = { kind: 'group'; id: string; label: string; icon: string; children: readonly ResolvedAdminNavLeaf[] }
  export type ResolvedAdminNavFlatLeaf = { kind: 'leaf'; id: string; label: string; href: string; icon: string; badgeKey?: AdminNavigationBadgeKey }
  export type ResolvedAdminNavEntry = ResolvedAdminNavGroup | ResolvedAdminNavFlatLeaf
  export function resolveAdminNavigation(input): readonly ResolvedAdminNavEntry[]
  ```
- **单叶扁平化**：一个组解析后只剩 1 片叶子 → 输出 `kind:'leaf'` 的扁平叶，`icon` 取组的图标键，`id/label/href/badgeKey` 取叶子的；0 片 → 整组不输出；≥2 片 → 正常组。异常回退（`resolveWorkspaceFallback`）输出扁平叶 `overview`。
- DOM：
  - 组：`li.admin-navigation__group` > `button.admin-navigation__group-toggle`（含 `.admin-navigation__group-icon`、`.admin-navigation__group-label`、`.admin-navigation__chevron`）+ 面板 `.admin-navigation__group-panel` > `ul.admin-navigation__items` > `li.admin-navigation__item` > `a.admin-navigation__link`。**与 master 相同**，e2e 的 `topGroupButtons()` 靠 `.admin-navigation__group-toggle` 数组数。
  - **扁平叶**：`li.admin-navigation__group.admin-navigation__group--flat` > `a.admin-navigation__link.admin-navigation__link--flat`（内含 `.admin-navigation__group-icon`、`.admin-navigation__link-label`、可选 `.admin-navigation__badge`）。**没有 toggle 按钮**，所以不被算进组数。激活态加 `admin-navigation__link--active` 与 `aria-current="page"`。
  - 所有 `admin-navigation__subgroup*` 类名与 SCSS 删除。
  - 侧栏收起（48px）态：扁平叶只显示图标 + `title`，点击直接跳转；组仍走现有 hover 浮层。

## 五角色预期（Task 1 单测快照 + Task 4 e2e 矩阵的依据）

按生产 `roles` 表（与 `src/test/factory/roles.ts` 一致）推演；`canReadCollection` 按 master 上 e2e `ROLE_NAVIGATION` 反推（MGR 看不到「城市合伙人申请」= 该 collection 对 MGR 不可读）。

| 角色 | 组（按顺序） | 扁平叶 | 叶子总数 |
|---|---|---|---|
| ADM | 工作台 · 待处理 · 房源与楼盘 · 客户与线索 · 站点与内容 · 城市与区域 · 团队与账号 · 设置与工具 | 无 | 39 |
| OPS | 工作台(3) · 待处理(**5**：我的待办/审核队列/举报处理/房源投放申请/提交数据) · 房源与楼盘(7) · 站点与内容(4：页面内容/资讯中心/素材库/表单管理) · 城市与区域(4：无别名) | 配套字典 | **24** |

> OPS 行订正（终审 + 浏览器实测）：「信息纠错」需 `correction:read`（内置 OPS 没有），「城市合伙人申请」的读范围对非 ADM 且 `cityIds:'all'` 返回 false，两片叶子按既有 collection 读权限被隐藏，master 上同样如此。计划初稿按 `canReadCollection` 恒 true 推演成 26，是错的。
| MGR | 工作台(2：运营概览/消息通知) · 待处理(2：我的待办/房源投放申请) · 房源与楼盘(2：房源列表/楼盘库) · 客户与线索(3) · 团队与账号(3：团队管理/经纪人管理/顾问服务时间) | 无 | 12 |
| BRK | 工作台(2) · 客户与线索(3) | 我的待办 · 房源列表 | 7 |
| CSR | 工作台(2) · 待处理(2：我的待办/提交数据) · 客户与线索(2：咨询线索/客户档案) | 表单管理 | 7 |

若 Task 1 的单测快照与此表不一致，以**代码解析结果为准**并在报告里写明差异原因（不得为凑表改权限数据，见 G4）。

---

## Task 1：结构切换——配置树、类型、解析器、状态、客户端渲染、单测

**目标**：`ADMIN_NAV_GROUPS` 换成目标树；删子分组；解析器加单叶扁平化；客户端按新契约渲染；单测全部更新并新增守卫。完成后 `typecheck`/`lint`/`test` 全绿，本地 dev 后台导航按新树显示。

**文件**（只允许动这些）：
- `src/domain/admin-navigation/navigation-config.ts`
- `src/domain/admin-navigation/navigation-types.ts`（删 `AdminNavSubgroup`；`AdminNavItem = AdminNavLeaf`；`AdminNavIconKey` 加 `'inbox'`；`AdminNavigationBadgeKey` 加 `'supplySubmissions' | 'informationCorrections'`）
- `src/domain/admin-navigation/resolve-navigation.ts`（新契约 + 扁平化 + 回退改扁平叶）
- `src/domain/admin-navigation/navigation-state.ts`（去子分组；`findActiveLeaf` / `deriveOpenGroupId` / `findActiveParentKeys` 适配 `ResolvedAdminNavEntry`：扁平叶激活时 `deriveOpenGroupId` 返回 `null`、`findActiveParentKeys` 返回 `[]`）
- `src/components/admin/AdminNavigation.tsx`（类型透传）
- `src/components/admin/AdminNavigationClient.tsx`（删 `NavigationSubgroup`；按渲染契约渲染组与扁平叶；`GROUP_ICONS` 加 `inbox`，用 `IconNotification`；收起态扁平叶图标 + `title`）
- `src/components/admin/AdminNavigation.scss`（删 subgroup 样式；加 `--flat` 样式，视觉与组头同一行高、同一图标位、同一字号；激活态沿用 `link--active`）
- `tests/admin-navigation-config.test.ts`（重写为新树快照：组顺序、每组叶子的 id/label/href/menuCodes）
- `tests/admin-nav-leaf-coverage.test.ts`（去掉子分组展平逻辑；其余断言保留——注意它会因 e2e 的 `ALL_LEAF_LABELS` 尚未更新而**暂时红**，这是预期，Task 4 修；本任务在报告里注明）
- 新增 `tests/admin-navigation-resolve-flatten.test.ts`：① 单叶组 → 扁平叶且 icon 取组图标；② 零叶组不输出；③ ≥2 叶保持组；④ 回退输出扁平叶 `overview`；⑤ 任意组 children 里不存在带 `children` 的项（G3 守卫）
- 新增 `tests/admin-navigation-permission-drift.test.ts`（**G1 守卫**）：把 master 版配置的叶子集合做成内嵌 fixture（用 `git show origin/master:payload-office-platform/src/domain/admin-navigation/navigation-config.ts` 读出后手工整理成 `{ id, label, href, menuCodes, requiredOperationCode?, collectionSlug?, badgeKey? }[]`，写在测试文件顶部并注明来源提交 `c76e6d9`），断言：新配置叶子 id 集合 = fixture 集合 − `{'domain-events'}`；每片叶子除 `badgeKey` 外逐字段相等；`badgeKey` 差异只允许 `information-corrections` 与 `supply-submissions` 两处新增
- 新增 `tests/admin-navigation-role-snapshot.test.ts`：用 `BUILTIN_ROLES` 五个夹具构造 `PermissionContext`（沿用 `tests/` 里既有的构造方式，`rg buildPermissionContext tests/` 找先例），`canReadCollection` 固定为：MGR 对 `city-partner-applications` 返回 `false`，其余一律 `true`；断言每个角色的组标签顺序、扁平叶标签、叶子总数与上表一致。若不一致，以代码为准修改断言并在报告里解释。

**不做**：不加组头汇总角标、不改默认展开、不加角标查询、不改 e2e（分别是 Task 2/3/4）。

**验证**：`pnpm typecheck`、`pnpm lint`、`pnpm test`（`admin-nav-leaf-coverage` 预期红，其余全绿；报告里贴该测试的失败摘要）。本地 dev 若在跑（3717），刷新 `/admin` 肉眼确认 8 个组按顺序出现即可，不要求截图。

**提交**：一个提交，`feat(admin-nav): 导航整体切换为 8 组、删子分组、单叶自动扁平（OPT-084 Phase 1）`，显式 `git add` 上述文件。

---

## Task 2：客户端交互——组头汇总角标、默认展开集、展开态持久化

**目标**：折叠的组头显示子叶角标之和；侧栏收起成 48px 时图标右上角显示同一数字；首次进入默认展开「待处理」+「房源与楼盘」+ 当前所在组；用户开合后按用户记住。

**文件**：
- `src/domain/admin-navigation/navigation-state.ts`：新增纯函数并导出
  - `sumGroupBadges(group: ResolvedAdminNavGroup, counts: AdminNavigationBadgeCounts): number`（子叶 `badgeKey` 对应计数求和，缺省 0）
  - `groupHasWarningBadge(group, counts, warningKeys: ReadonlySet<string>): boolean`（任一子叶 key ∈ warningKeys 且计数 > 0）
  - `DEFAULT_OPEN_GROUP_IDS = ['inbox', 'supply'] as const`
  - `defaultOpenGroupIds(entries: readonly ResolvedAdminNavEntry[], pathname: string): Set<string>`（默认集 ∩ 当前存在的组 ∪ 当前激活组）
  - `parseStoredOpenGroups(raw: unknown, entries): Set<string> | null`（localStorage 取回的 JSON 字符串数组 → 过滤成当前存在的组 id；非法输入返回 `null`）
- `src/components/admin/AdminNavigationClient.tsx`：
  - 组头：`isOpen === false` 时在 label 右侧渲染 `span.admin-navigation__group-badge`（`formatBadgeCount` 封顶 `99+`；有 warning 子叶时加 `--warning`；0 时不渲染）。展开时不渲染组头角标（子叶各自显示）。
  - 收起态（48px）：组图标右上角渲染 `span.admin-navigation__rail-badge`（同一数字），浮层内子叶各自显示；扁平叶在收起态同样在图标右上角显示自己的角标。
  - 展开集初始化：沿用现有「`setTimeout(0)` 内 `setMounted` + `setCollapsed(getInitialCollapsed())`」的模式（**不能**在首次渲染同步读 localStorage，会 SSR 不一致），在同一处读 `sbh-admin-nav-open-groups`；`parseStoredOpenGroups` 返回 `null`（首次进入或坏数据）→ 用 `defaultOpenGroupIds`；否则用存储值 ∪ 当前激活组。
  - 每次 `handleToggleKey` 后把展开集序列化写回 localStorage（try/catch 包住）。路由变化时的「把激活组并入展开集」逻辑保留。
- `src/components/admin/AdminNavigation.scss`：`__group-badge`、`__rail-badge`（绝对定位在图标右上，10.5px，warning 变体沿用现有 `__badge--warning` 的色）。深浅两套主题都要有值（该文件已有 dark 段，照它的写法）。
- 新增 `tests/admin-navigation-open-state.test.ts`：覆盖上述 5 个纯函数（含：默认集里的组当前不存在时不出现；坏 JSON → `null`；存储里含已不存在的组 id 时被过滤；`sumGroupBadges` 忽略无 `badgeKey` 的叶）。

**验证**：`typecheck`/`lint`/`test`；本地 dev：清 localStorage 后进 `/admin`，「待处理」与「房源与楼盘」默认展开；折叠「待处理」后组头出现汇总数（用现有夹具：消息通知有 2 条，但它在工作台组；若待处理组无数据可暂用「工作台」折叠后看到「2」验证机制）。

**提交**：`feat(admin-nav): 组头汇总角标、默认展开集与展开态持久化（OPT-084 Phase 1）`。

---

## Task 3：新增两条角标查询（投放申请 / 信息纠错）

**目标**：「房源投放申请」「信息纠错」两片叶子有角标。

**文件**：
- `src/domain/admin-navigation/navigation-badges.ts`：
  - `AdminNavigationBadgeQuery.collection` 联合加 `'supply-submissions' | 'information-corrections'`
  - `buildAdminNavigationBadgeQueries` 新增：
    - `supplySubmissions`：`collection: 'supply-submissions'`，`where: { status: { equals: 'pending' } }`（与 `dashboard-stats` 里 `pendingSubmissions` 的口径一致，`rg pendingSubmissions src/domain/analytics` 核对后照抄），准入 `hasMenuPermission('supply-submissions') && hasOperationPermission('supply_submission:read')`。数据范围：~~若 `SupplySubmissions` 有 `city` 字段则用 `buildBadgeDataScopeWhere`~~ **不收窄**（终审订正：`SupplySubmissions.access.read` 只判操作码、不按范围收窄，`dashboard-stats.pendingSubmissions` 同样不收窄；角标若按城市 / 团队收窄，MGR 会看到角标 0 而列表满屏待处理。角标口径 = 列表页口径，注释写明）。
    - `informationCorrections`：`collection: 'information-corrections'`，未关闭 = `status in ['new','triaged']`（用 `rg "value: '" src/collections/InformationCorrections.ts` 核对枚举值后照抄），准入 `hasMenuPermission('reports') && hasOperationPermission('correction:read')`。不收窄数据范围（该集合无城市字段；注释写明）。
  - 对应新增 `canReadSupplySubmissions` / `canReadInformationCorrections` 私有函数，风格与现有 `canReadXxx` 一致。
- `src/domain/admin-navigation/navigation-badge-request.ts`：已知 key 数组加两个新 key。
- `src/endpoints/admin-navigation-endpoint.ts`：确认按 key 泛化、无需改；若有 key 白名单则补上。
- `tests/admin-navigation-badges.test.ts`：新增用例——OPS 得到两条新查询且 where 正确；BRK / CSR 得不到；MGR 只得到 `supplySubmissions`（有 `supply_submission:read`）不得到 `informationCorrections`（无 `correction:read`）。
- `tests/admin-navigation-badge-request.test.ts`、`tests/admin-navigation-endpoint.test.ts`：按需补新 key 的解析用例。

**验证**：`typecheck`/`lint`/`test`；本地 dev 用 e2e-adm 登录后 `GET /api/admin-navigation` 响应含 `supplySubmissions`、`informationCorrections` 两个 key（值可为 0）。

**提交**：`feat(admin-nav): 投放申请与信息纠错两条角标查询（OPT-084 Phase 1）`。

---

## Task 4：e2e 与守卫收口

**目标**：让 `admin-nav-leaf-coverage` 转绿；e2e 角色矩阵与断言对齐新树；`geography-admin` 的子分组断言改写。**本地不跑全量 e2e**（会被 SIGKILL，见项目记忆），只保证 `typecheck` 覆盖到 e2e 文件、单测全绿、并人工核对断言与「五角色预期」表一致。

**文件**：
- `tests/e2e/admin-navigation.spec.ts`：
  - `ALL_LEAF_LABELS`：39 个（删 `'领域事件'`），顺序按新树。
  - `ROLE_NAVIGATION`：每角色 `groups`（新组标签，按顺序）+ 新增 `flatLeaves: readonly string[]`；`allowed` 改为：ADM `{ group: '站点与内容', leaf: '页面内容', slug: 'pages' }`；OPS `{ group: '待处理', leaf: '审核队列', slug: 'listing-reviews', pageMarker: '房源审核台' }`；MGR `{ group: '团队与账号', leaf: '团队管理', slug: 'teams' }`；BRK `{ flat: true, leaf: '房源列表', slug: 'listings', rootSelector: '.listings-list' }`；CSR `{ flat: true, leaf: '表单管理', slug: 'forms' }`。
  - `expectRoleGroups`：组按钮数 = `groups.length` 且标签逐一相等；再断言每个 `flatLeaves` 项存在 `a.admin-navigation__link--flat` 且文本精确匹配；断言 `.admin-navigation__link--flat` 总数 = `flatLeaves.length`。
  - `openAllSubgroups` 删除；凡引用处改为展开全部组（点所有 `aria-expanded="false"` 的 `.admin-navigation__group-toggle`）。
  - 「记忆展开态」相关用例（`aria-expanded` 断言那几条，约 `:418-470`）：按 Task 2 的默认展开规则修正预期——首次进入 `/admin` 时「待处理」「房源与楼盘」为展开态，且点击不再互斥。
  - 角标用例（`:490-506`）：`tasks` 链接现在在「待处理」组下，选择器 `a.admin-navigation__link[href="/admin/collections/tasks"]` 不变；确认组默认展开后可见。
- `tests/e2e/geography-admin.spec.ts:233-234`：改为「设置与工具」组内存在「配套字典」叶子（`navLeafLink` 风格的定位），不再断言子分组。
- `tests/e2e/permission-matrix.spec.ts`：`rg admin-navigation` 若无引用则不动。

**验证**：`pnpm typecheck`（含 tests）、`pnpm lint`、`pnpm test` 全绿（`admin-nav-leaf-coverage` 必须绿）。报告里附一张「五角色预期表 vs `ROLE_NAVIGATION`」的逐行对照。

**提交**：`test(admin-nav): e2e 角色矩阵与叶子清单对齐新导航树（OPT-084 Phase 1）`。

---

## 控制者在四任务之后负责的事（不派给实施代理）

- 最终全分支审查（最强模型）。
- 浏览器验收（宪章）：五个夹具账号各登录本地 dev，逐组展开，组数 / 扁平叶 / 叶子数与预期表逐一对；折叠组头看汇总角标；收起侧栏看图标角标；1200px 视口组头可点、无 `inert`；深色模式逐项核对；证据写 `artifacts/verification/OPT-084/`。
- 回写 `OPT-084-admin-nav-ia-redesign.md` 状态与 §14 清单。
- 向用户确认后才 push / 建 PR。
