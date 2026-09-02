# Task Packet：OPT-064 数据看板与用户行为分析（总纲，含 OPT-065/066/067）

> 状态：**待实施**
> 创建日期：2026-08-31
> 来源：用户提出——需要一个数据看板，了解网站每日相关数据与用户行为（含关键按钮/表单
> 的点击转化、核心页面浏览时长/深度、单个用户浏览路径）
> 编号核对：`specs/work-items/` 最大到 OPT-063；`git branch -a` 无 064+ 在建分支。
> **编号占用声明**：本文件同时定义 OPT-064/065/066/067 四个子工作项，不另建同名文件，
> 实施分支直接引用本文件对应小节（§6.1–§6.4），防止同义文档漂移（宪章「多 agent 入口」条）。

---

## 1. 一句话

自托管 Umami v3 接住前端既有埋点（补齐列表页缺口与浏览时长/深度），在后台新增
`/admin/analytics` 统一看板：业务日报（接已有 `/api/overview`）+ 流量概览 + 转化漏斗
（以 `leads` 表核对最后一环），并在咨询提交时刻做线索↔浏览路径的假名化关联。

## 2. 为什么（谁受影响、现在什么样、为什么是现在）

- **谁**：运营/管理员（看每日供给、线索、流量）；销售（看某条线索转化前看过哪些房源）；
  产品决策（漏斗哪一步在流失、推荐位点击率）。
- **现在什么样**：这个能力**已经建了两套半成品，都没接通**——
  1. 服务端指标层 `src/domain/analytics/`（指标注册表 + 权限 + 缓存元数据）已注册
     4 个 API（`/api/overview`、`/api/dashboard`、`/api/listings/analytics`、
     `/api/leads/analytics`），**全仓库没有任何组件消费它们**（仅
     `payload.config.ts:342-344` 注释提及）。后台首页 widget 走的是另一条只有
     12 个标量的 `/api/dashboard-stats`。
  2. 前端采集层 `src/lib/frontend/analytics/`（collector + 白名单 + 脱敏 + 去重 +
     重试队列）定义了 27 个事件、绝大多数已打在页面上，但生产 adapter 是
     `createDataLayerAdapter()` 往 `window.dataLayer` push，而
     `(frontend)/layout.tsx` **没有任何 GTM/统计脚本**，事件堆在数组里刷新即丢。
     `.env.example:51` 的 `NEXT_PUBLIC_ANALYTICS_ENABLED` 至今注释着。
- **为什么是现在**：埋点数据不可补录，晚接一周永久少一周；且两套基础设施都已就绪，
  接通是全项目性价比最高的一段增量。

## 3. 事实核查（2026-08-31，均已核到代码）

### 3.1 前端采集层现状

| 事实 | 位置 |
|---|---|
| 27 个事件白名单（键级过滤，未知事件直接丢弃） | `src/lib/frontend/analytics/events.ts:18-64` |
| collector 丢弃未知事件；**生产环境不打任何日志**（warn 有 `NODE_ENV !== 'production'` 前置） | `src/lib/frontend/analytics/collector.ts:37-43` |
| 生产 adapter = dataLayer，开发 = console，SSR = noop | `src/lib/frontend/analytics/init.ts:47-56` |
| `AnalyticsInit` 已订阅 `visibilitychange`/`pagehide` 并 flush（page_engagement 可复用） | `src/lib/frontend/analytics/init.ts` |
| Web Vitals 已采集（`web_vital` 事件） | `src/lib/frontend/analytics/web-vitals.ts` |
| 队列带重试：adapter.send 抛错即重试（Umami 脚本未就绪时可借此缓冲） | `src/lib/frontend/analytics/queue.ts` |

### 3.2 已埋事件盘点（接通出口即可用，零改动）

- 咨询漏斗 4 步：`inquiry_open/submit/success/error`（`InquiryModal.tsx`，8 个调用点，
  error 带 `error_code` 枚举）
- 落地页表单漏斗 5 步 ×2 表单：`landing_view → landing_form_start → landing_form_submit
  → landing_form_success/landing_form_error`（EntrustForm / SupplySubmissionForm）
- CTA：`landing_bottom_cta_click`、`landing_header_cta_click`、
  `coming_soon_cta_clicked`、`city_partner_cta_clicked`
- 详情页带 rank 的四类跳转：`listing_building_click`、`recommendation_click`、
  `building_listing_click`、`related_building_click`（`DetailClickAnalytics.tsx` 委托监听）
- 其他：城市合伙人 3 步、`city_switched`、`media_view`、`city_page_view`、`web_vital`

### 3.3 已知缺陷（本工作项修复）

| 缺陷 | 位置 | 后果 |
|---|---|---|
| `correction_*` 4 个事件不在白名单，**7 个**调用点被静默丢弃，无测试覆盖 | 调用点 `CorrectionModal.tsx:122/166/186/198/210/221/229` | 信息纠错漏斗数据全丢，生产无任何日志 |
| 反向缺陷：`supply_filter` 在白名单却查无任何调用点（「定义了没埋」，与 correction 相反） | `events.ts:36` | 楼盘页供给筛选无数据；补埋列二期（§8） |
| 列表页/搜索页零埋点：`ListingResultCard/Row`、`BuildingResultCard/CompactRow`、`FilterFormC`、`MobileFilterSheet`、`ResultToolbar` 均无 track | `src/components/frontend/listing/` | 转化链路最前端（搜索→点击）盲区 |
| 生产 CSP `script-src` 只允许 self + 高德四域，跨域统计脚本会被拦 | `src/lib/security-headers.ts:29` | 不改 CSP 则 Umami 脚本静默加载失败 |

### 3.4 Lead 已有归因字段（OPT-067 的衔接点）

`idempotencyKey`(:501)/`sourcePageType`(:512)/`sourcePath`(:530)/`sourceUrl`(:539)/`sourceSection`(:589)
（`Leads.ts:490-616`「入口与目标」区块）与 UTM 营销参数字段 `campaign`（json，`Leads.ts:689`）——这是「最后一次触点」；OPT-067 补的是「转化前完整路径」。
`/api/inquiries` 成功响应形状 `{ ok: true, targetResolution }`
（`src/app/api/inquiries/route.ts:214`），OPT-067 需扩展。

### 3.5 外部事实（Umami，核查日期 2026-08-31，来源 docs.umami.is / GitHub releases）

| 事实 | 影响 |
|---|---|
| Umami v3 只支持 PostgreSQL ≥ 12.14（不再支持 MySQL） | **已核实满足**：生产实例 `postgres-ilf7zhts` 是 **PostgreSQL 17.10**（2026-09-01 查，x86_64 Linux），可复用 |
| 访客 ID = hash(IP+UA+websiteId) 加盐轮换，无 Cookie；跨天/跨设备天然断链 | 无需 Cookie 弹窗；跨会话关联必须走 `identify()` |
| Journey 报表聚合展示 3–7 步路径；Sessions 可看单会话活动 | 聚合路径/匿名会话开箱即用 |
| v3.2 起热图（点击+滚动）自托管可用，需额外挂 `recorder.js` + 网站设置开启，开启后才开始收 | 决策：只开热图，不开回放 |
| 会话回放默认 moderate 掩码（遮输入框），保留 30 天 | 本期不开（见 §8） |
| 单页停留时长按相邻 pageview 时间差推算，**会话末页恒缺失**（issue #3518 未解决） | 时长必须自埋 `page_engagement` |
| `umami.track(name, data)` / `umami.identify(id)`；无内置滚动深度/活跃时长 | 深度分桶自埋 |

## 4. 决策记录（本会话已拍板，不再重议）

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 用户行为数据落地方式 | 接第三方统计（不自建事件表） | 埋点框架已就绪，改动最小；GA4 大陆不可用性排除 |
| D2 | 统计选型 | **自托管 Umami v3** | 复用 PG、同为自有域名不被拦、有 REST API 可回抽、无 Cookie |
| D3 | 看板形态 | 后台 `/admin/analytics` 一页统一看 | 流量+业务+漏斗一页；权限走现有体系 |
| D4 | 列表页埋点缺口 | 合进 OPT-064 一次做全 | 埋点不可补录 |
| D5 | identify 策略 | **仅咨询提交成功时**关联假名化 ID | PIPL：匿名访客不 identify；提交时告知同意自然 |
| D6 | recorder 范围 | 只开热图，不开回放 | 回放存储量级大 + 隐私负担；有排障需求再议 |
| D7 | 工作项拆分 | 四步串行 064→065→066→067 | 每步独立上线，064 先跑起来攒数据 |
| D8 | Umami 版本/部署 | v3 最新，CloudRun 第二服务，TencentDB 新建独立 database，默认 `*.tcloudbase.com` 域名 | v3 才有热图；独立库避免与 Payload 表名碰撞、互不影响迁移 |
| D9 | 流量数据权限 | 新权限码 `analytics:traffic`，默认仅平台管理员，角色系统可放开 | 与现有 metric 权限模型同构 |
| D10 | 事件保留 | 暂不设清理任务 | YAGNI，量级到了再做 |
| D11 | `page_engagement` 覆盖页 | listing-detail / building-detail / listings / buildings / entrust / publish | 转化链路上的页 |

## 5. 总体架构

```
┌────────────── C 端 (Next.js frontend) ──────────────┐
│ track() → collector(白名单/脱敏/去重/队列)           │
│   └→ UmamiAdapter → window.umami.track()  ←─ script.js (自 Umami 服务加载)
│ 热图: recorder.js（仅热图，不开回放）                │
│ identify(visitorRef) ←─ 仅 /api/inquiries 成功后     │
└─────────────────────────────────────────────────────┘
          │ 事件/PV 上报（同域族，不出境）
          ▼
┌── CloudRun 服务 umami（新） ──┐     ┌── CloudRun 服务 sbh（现有） ──┐
│ Umami v3 官方镜像             │     │ /api/overview   （已有，M7.3）│
│ DB: postgres-ilf7zhts         │     │ /api/traffic    （新，服务端  │
│     新 database `umami`       │◄────┤   代理 Umami REST + 60s 缓存）│
└───────────────────────────────┘     │ /admin/analytics（新自定义视图）│
                                      └───────────────────────────────┘
```

- **Umami 用独立 database**（同实例）：Umami 走 Prisma 自管迁移，表名含
  `user`/`session`/`team` 等通用名，与 Payload 同库有碰撞风险且权责不清。
- `migrate:drift` 守卫不受影响：它比对 config 与快照 JSON，从不读真实库
  （`scripts/migrate-drift-check.ts` 文件头）。
- 路径图/热图**留在 Umami 自带 UI**，后台看板只做数字指标 + 深链跳转；
  硬搬进 Payload 后台性价比极低。

## 6. 子工作项

### 6.1 OPT-064 采集层接通与补全（本编号）

**范围**：Umami 部署 + adapter 接通 + correction 白名单修复 + 列表页新事件 +
`page_engagement` + 热图 recorder + CSP 放行 + 隐私政策更新。**无 Payload collection
变更、无迁移。**

#### 实现细节

1. **Umami 部署（运维前置见 §10）**：CloudRun 新服务 `umami`，官方
   `ghcr.io/umami-software/umami:postgresql-vX.Y.Z` 镜像（**锁具体版本 tag**，
   实施时取当时最新 stable 写死在部署配置，禁用 `latest` 浮动标签）；env：`DATABASE_URL`
   （指向新 database `umami`）、`APP_SECRET`；注意 CloudRun Port=80 与镜像默认
   3000 的对齐（Umami 尊重 `PORT` env，同 sbh 服务的教训，宪章「容器与部署机制坑」）。
   建站点条目拿 website ID；管理员账号供 OPT-066 API 登录。
2. **UmamiAdapter**（`adapter.ts` 新增 `createUmamiAdapter()`）：
   `send()` 在 `window.umami` 未就绪时抛错 → 交给现有队列重试（`queue.ts` 机制）；
   就绪后逐条 `umami.track(eventName, props)`。
3. **adapter 选择**（`init.ts:47`）：生产分支改为
   `siteConfig.analyticsEnabled && NEXT_PUBLIC_UMAMI_* 齐备 ? Umami : Noop`；
   开发保持 console。
4. **脚本注入**（`(frontend)/layout.tsx`）：`next/script` 注入
   `${NEXT_PUBLIC_UMAMI_SRC}/script.js`（`defer`、`data-website-id`），受
   `analyticsEnabled` 门控；热图另注入 `recorder.js`（同门控 + 
   `NEXT_PUBLIC_UMAMI_HEATMAP=true` 独立开关）。
   ⚠️ `NEXT_PUBLIC_*` 是构建期内联，本仓库范式是写进 **Dockerfile builder 阶段
   ENV**（先例 `Dockerfile:29-30、43-44` 的 `NEXT_PUBLIC_SITE_URL` /
   `NEXT_PUBLIC_AMAP_JS_KEY`），CloudRun 服务级 env 对 client bundle **不可见**。
   因此实施顺序必须是：先完成 §10-1~4（部署 Umami 拿到 website ID），
   再提交含 Dockerfile ENV 的 PR。
5. **CSP**（`security-headers.ts`）：`script-src` 追加 Umami 服务 origin
   （从 env 读，不硬编码域名）；`connect-src 'self' https:` 已覆盖上报请求，无需改。
6. **correction 白名单修复**（`events.ts:18` 追加 4 行，键以 3.3 调用点实际 props 为准）：
   - `correction_open: ['target_type', 'has_target']`
   - `correction_submit: ['target_type', 'category']`
   - `correction_success: ['target_type', 'category', 'idempotent']`
   - `correction_error: ['target_type', 'error_code']`
7. **新事件**（`events.ts` 白名单 + 组件埋点；只收枚举/数字/布尔，禁自由文本，
   与 `supply_filter` 先例一致）：

   | 事件 | 允许键 | 触发 |
   |---|---|---|
   | `listing_search` | city, result_count, sort, price_unit, filter_completeness, page_index | 房源列表页加载/筛选生效（客户端组件读 URL 态+服务端传入的 result_count，按导航键去重） |
   | `listing_result_click` | city, listing_id, rank, page_index, section | 结果卡/行点击（委托监听，沿 `DetailClickAnalytics` 的 `data-*` 模式新建列表页监听器） |
   | `building_search` | city, result_count, sort, filter_completeness, page_index | 楼盘列表页，同上 |
   | `building_result_click` | city, building_id, rank, page_index, section | 同上 |
   | `page_engagement` | page_type, active_ms, scroll_bucket | 见下 |

   术语定义（防实施歧义）：`filter_completeness` = 当前**已生效筛选维度个数**
   （整数 ≥0）；搜索类事件去重键 = `pathname` + 规范化后的筛选/排序/页码 query
   ——翻页、改排序都算新事件，浏览器后退命中同键不重报；`rank` = **当前页内
   1 基序号**（跨页看 page_index）。

8. **`page_engagement`**（新模块 `engagement.ts`，挂在 `AnalyticsInit`）：
   - 覆盖页：D11 六类 `page_type`；
   - `active_ms`：页面可见 **且** 距最近一次交互（pointer/scroll/key）< 60s 的
     累计时长；上限 30min；切走标签页暂停（否则挂后台的标签污染中位数）；
   - `scroll_bucket`：到达过的最大滚动深度 ∈ {0,25,50,75,90}；
   - **上报触发点（三个，缺一不可）**：①客户端路由变化——App Router 站内跳转
     **不触发** pagehide/visibilitychange，复用 `AnalyticsInit` 的 `usePathname`
     监听，报上一页并重置（缺这条会丢掉「列表→详情→下一套」主路径上几乎全部
     数据）；②`pagehide`；③`visibilitychange→hidden`（移动端切后台可能直接被杀）。
   - **增量语义**：每个页面生命周期维护 `reported_ms`；任一触发点若
     `active_ms − reported_ms ≥ 1000` 则上报增量并推进 `reported_ms`
     （scroll_bucket 报当前最大值）——切走再回来继续浏览的时长不丢；
     分析端对同一次浏览的多条记录求和。
9. **防再犯守卫测试**：静态扫描 `src/` 全部 `track('...')` 字面量，断言事件名
   ∈ `ANALYTICS_EVENTS` 键集——correction 这类「埋了但白名单漏了」的静默丢弃从此
   在 CI 红灯（这是本缺陷的根因级修复，比补 4 行白名单更重要）。
10. **隐私政策**：补「使用自托管无 Cookie 统计（Umami）收集访问数据」条款。

#### 验收标准

1. 生产构建 + `NEXT_PUBLIC_ANALYTICS_ENABLED=true` 下，浏览器 Network 可见事件
   POST 到 Umami 服务且 200；Umami 后台实时页可见 pageview 与自定义事件。
2. 未配置 env 时零请求、零报错（Noop 降级）。
3. 打开信息纠错弹窗 → Umami 收到 `correction_open`（缺陷修复验证）。
4. 房源列表页筛选 + 点击第 3 个结果 → 收到 `listing_search`（result_count 正确）
   与 `listing_result_click`（rank=3）。
5. 房源详情页停留 30s 并滚动过半后，**三种离开方式各验一遍**（点站内链接
   客户端跳转 / 关标签页 / 切后台）均收到 `page_engagement`
   （active_ms≈30000±20%，scroll_bucket≥50）。
6. 守卫测试对白名单外的 `track('x')` 字面量必红。
7. 生产 CSP 下 script.js/recorder.js 加载无 CSP 违规（DevTools console 无 report）。
8. 热图在 Umami 网站设置开启后，详情页有滚动热图数据。
9. 既有单测全绿；`typecheck` 干净。

#### 测试

| 层 | 内容 | 数量 |
|---|---|---|
| 单测 | UmamiAdapter（未就绪抛错/就绪转发/props 透传）、correction 白名单回归、page_engagement 计时与分桶纯逻辑、守卫扫描 | +6~8 |
| E2E | **跑在生产构建上**（见下），`page.addInitScript` 预置 `window.umami` 桩，走列表页断言两事件、走纠错弹窗断言 `correction_open` | +2 |
| 浏览器实测 | 按宪章铁律：本地起 Umami（docker）或连测试站点，实点全链路 | — |

⚠️ **E2E 必须跑在生产构建上，不能靠 dev**。本条第 3 点把开发环境的 adapter
保持为 console，事件根本到不了 `window.umami`，dev 下 stub 什么也观测不到——
用例要么直接失败，要么退化成与 Umami 接线无关的断言（Codex review P2 指出）。

好在 `quality.yml` 的 e2e job 本来就是 `pnpm build` + `next start` 生产 server。
落地方式：该 job 的构建步骤加上 `NEXT_PUBLIC_ANALYTICS_ENABLED=true` 与一个
指向本地桩路径的 `NEXT_PUBLIC_UMAMI_SRC`（构建期内联，见第 4 点），用例侧用
`page.addInitScript` 在导航前装好 `window.umami = { track, identify }` 收集器。
真实 Umami 脚本加载失败不影响断言——adapter 调的是 `window.umami.track`，
桩已经在那儿了。

**Files**：`src/lib/frontend/analytics/{adapter,init,events,engagement(新)}.ts`、
`src/app/(frontend)/layout.tsx`、`src/lib/security-headers.ts`、`Dockerfile`（NEXT_PUBLIC ENV）、
`src/components/frontend/listing/{ListingResultCard,ListingResultRow,BuildingResultCard,BuildingCompactRow,FilterFormC}.tsx`、
新列表页委托监听组件、隐私政策页内容、`.env.example`、`tests/*`。

**Effort**：部署 2h + adapter/事件 4h + engagement 3h + 测试 3h ≈ 1.5 天（CC）。
**回滚**：回退含 Dockerfile ENV 的提交并重发（`NEXT_PUBLIC_*` 构建期内联，改服务级 env 无效）；Umami 服务独立停用不影响主站。

### 6.2 OPT-065 业务日报页

**范围**：`/admin/analytics` 自定义 view，渲染**已有** `/api/overview` 的
卡片/趋势/分布 + `asOf`。纯前端消费，零后端改动、零迁移。

- 视图注册：`payload.config.ts` `admin.components.views`（沿地理模块先例，
  `payload.config.ts:247` 起）；**禁用 `admin.hidden` 藏路由**（OPT-053 教训：
  会连路由一起杀掉；本页不涉 Global，仅提醒）。改 config 后必须
  `pnpm payload generate:importmap`（宪章：漏了 = /admin 白屏）。
- 导航：`navigation-config.ts` `workspace` 组新增
  `leaf('analytics', '数据看板', '/admin/analytics', ['analytics'])`——挂**已注册**
  的 MENU 码 `analytics`（`permission-codes.ts:49`）。导航层只认菜单码、不跑
  metric registry；块级权限在页面内部降级（下一条）。同步
  `src/test/factory/roles.ts` 与 `scripts/seed.ts` 内置角色的菜单码
  （permission-codes.ts 文件头明文要求 fixture 同步，漏了 E2E 必红）；
  改导航必须自查 `tests/e2e/`（E2E 不在本地闸门，本地全绿 CI 才炸的前科）。
- 数据：客户端 fetch `/api/overview`（服务端已做权限过滤 + 单卡降级
  `resolveSingleCard`，前端照单渲染 status=failed/no-permission 的占位）。
- 页面内分块降级：业务块按 `canViewOverviewDashboard`（服务端 API 本就拒绝，
  UI 只是不渲染死块），流量块按 `analytics:traffic`（OPT-066 接入）；两块都无
  权限时整页 403 文案。导航可见性只由 `analytics` 菜单码决定（上一条）。
- UI：Arco（`DashboardOverview.tsx` 同风格），趋势/分布用轻量图表（优先
  Arco 内置/手绘 SVG，**不引重图表库**——新依赖须单独决策）。

**验收**：1) e2e-adm 登录可见导航项，页面渲染 7 卡 + 趋势 + 分布 + asOf；
2) 无权限角色看不到导航项、直访 403 文案、API 403；3) 单卡失败仅该卡降级；
4) importmap 已再生成（pre-commit 警告为零）；5) 浏览器实测通过。
**测试**：单测（响应形状守卫、降级渲染分支）+3；E2E（登录→导航→渲染断言）+1。
**Effort**：0.5–1 天。**回滚**：revert PR（纯增量）。

### 6.3 OPT-066 流量块 + 转化漏斗（依赖 064、065）

**范围**：`/api/traffic` 服务端代理 + 看板页新增流量块与漏斗块。零迁移。

- **`/api/traffic`**（`src/endpoints/traffic-endpoint.ts`，注册进 payload.config
  endpoints，鉴权沿 `overview-endpoint.ts` 的 `requireAdminContext` 范式）：
  - 查询参数只有 `range ∈ {'yesterday','7d','30d'}`（固定枚举，非法值 400）；
    窗口边界一律按 **Asia/Shanghai** 日界（与 `metric-types.ts` 的「今日」约定一致）。
  - 上游：服务端持 `UMAMI_URL/UMAMI_USERNAME/UMAMI_PASSWORD/UMAMI_WEBSITE_ID`
    经 `POST /api/auth/login` 拿 token（进程内缓存，401 重登一次）；调
    `GET /api/websites/:id/stats`、`/pageviews`、`/metrics?type=referrer|url|event`
    （以所装 v3 版本实测为准，路径有偏差记录在 PR 里）。
  - 响应形状（单测与 E2E stub 依此，不得实施时另定）：
    ```ts
    type TrafficResponse = { ok: true; asOf: string; traffic:
      | { status: 'ok'; pageviews: number; visitors: number
          series: Array<{ t: string; pageviews: number; visitors: number }>
          topReferrers: Array<{ name: string; visitors: number }>
          topPages: Array<{ path: string; pageviews: number }>
          funnel: { detailView: number; inquiryOpen: number
                    inquirySubmit: number; inquirySuccess: number }
          leadsInWindow: number | null; missRate: number | null }
      | { status: 'unavailable' } }
    ```
  - **缓存必须分层，禁止把整个响应按 `range` 缓存**：
    - **Umami 那部分与调用方无关**（PV / UV / series / topReferrers / topPages /
      funnel）→ 按 `range` 做 60s 进程内缓存。只读缓存，多实例各自缓存无一致性
      问题（区别于 OPT-042 的失效场景）。
    - **`leadsInWindow` / `missRate` 与调用方有关**（来自 `overrideAccess: false`
      的 count，随 `leadReadAccess` 的 dataScope 收窄）→ **每次请求单独算，
      绝不进缓存**。
    - 整体按 `range` 缓存会把 A 销售的线索聚合在 60 秒内原样返回给 B 销售
      ——Codex review P1 指出，属真实越权，不是理论风险。
  - 权限：`analytics:traffic`（`permission-codes.ts` 新增；**同步
    `src/test/factory/roles.ts` 与 `scripts/seed.ts` 内置角色**；生产授予见 §10）。
  - Umami 不可达 → `{ status: 'unavailable' }` 分支——**流量块降级，业务块
    不受牵连**（同 `resolveSingleCard` 哲学）。
- **漏斗块**（四步必须同流；`landing_view` 只在 /entrust、/publish 两个落地页
  触发，不是咨询流的祖先，**不得用作首步**）：
  `city_page_view(page_type ∈ {listing-detail, building-detail}) → inquiry_open
  → inquiry_submit → inquiry_success`，四步取自 Umami 事件计数。
  **口径写死**：按事件总数计数（不做会话去重、不校验步骤先后顺序——MVP 口径，
  UI 上标注「按事件量」）。
- **漏报率**：同窗口（Asia/Shanghai 日界）用 Local API `count` leads 核对末环。
  分母只取咨询弹窗链路的线索——判据：`sourcePageType` 非空（该字段仅
  `/api/inquiries` 链路写入；实施第一步先 grep 证实落地页表单确实不写此字段，
  判据不成立则改用入口枚举区分并记录在 PR）。计数用 `overrideAccess: false`，
  读取范围随 `leadReadAccess` 收窄（`src/domain/crm/lead-read-access.ts:42`，
  按 dataScope 生成 Where；**没有 `lead:read` 这个权限码**，勿找）。

  为使口径不随查看者漂移，**非 global dataScope 的调用方，`leadsInWindow` 与
  `missRate` 在服务端就返回 `null`**——不是「前端隐藏那一行」。隐藏 UI 不是
  权限控制（宪章原文），直接打 API 照样能拿到别人范围内的线索聚合。前端见到
  `null` 时不渲染该行即可。

  展示 **埋点漏报率** = 1 − umami_success/线索数；边界：线索数为 0
  → `missRate: null`（前端显示「—」）；计算值 < 0（埋点数大于线索数）→ 取 0
  并同时展示两个原始计数。——自建业务库对纯第三方方案的核心优势：
  不信埋点，信线索表。
- 整页统一 `asOf`；流量与业务两块各自独立失败降级。

**验收**：1) 平台管理员见流量块（昨日/近7日 PV、UV、来源 Top、落地页 Top）与
四步漏斗 + 漏报率；2) 无 `analytics:traffic` 的角色流量块整块隐藏且 API 403，
业务块照常；3) 停掉 Umami 服务 → 流量块显示「暂不可用」，页面其余正常；
4) global 范围管理员的漏斗末环数字，与后台 leads 列表按同判据（sourcePageType
非空、Asia/Shanghai 同窗口）过滤的计数一致；**team/self 范围角色直接打
`/api/traffic` 拿到的 `leadsInWindow` 与 `missRate` 就是 `null`**（不是"前端不显示"）；
且先后用两个不同 dataScope 的账号在 60 秒内连打两次，第二次拿到的线索数
必须是自己范围的，不能是第一次那个账号的缓存值；
5) 浏览器实测。
**测试**：单测（token 缓存/重登、响应形状、降级、漏报率计算、**缓存分层：
Umami 段命中缓存而 lead 段每次重算、非 global 调用方两个字段恒 null**）+6~7；
E2E（stub /api/traffic 断言两块渲染与降级）+1。
**Effort**：1 天。**回滚**：revert PR；权限码残留无害。

### 6.4 OPT-067 线索↔浏览路径关联（依赖 064；**有迁移**）

**范围**：咨询提交成功时刻做假名化 identify，把「提交前浏览路径」接到线索详情。

- **服务端**：`/api/inquiries` 请求体新增可选 `visitorRef`（严格校验 32 hex，
  非法即忽略）；成功分支：有合法回传则**复用**，否则生成
  `visitorRef = HMAC-SHA256(PAYLOAD_SECRET, idempotencyKey)` 截断 32 hex。
  写入 Lead 新字段 `visitorRef`（text、index、admin readOnly、**字段级收口
  照抄 OPT-063 的 roomNumber 范式**——`specs/work-items/OPT-063-listing-room-number.md`
  §1 与 `Listings.ts` 中 roomNumber 的字段级 access 写法：匿名 REST/GraphQL 不可读），响应扩展为
  `{ ok: true, targetResolution, visitorRef }`。**改 collection 必带迁移**
  （pre-commit 拦），纯增列可自动生成。
- **同会话多线索**：客户端把首个 visitorRef 存 `sessionStorage`，后续提交随
  请求回传——同会话第二条线索复用同一 ID。不复用的话，`umami.identify` 的
  会话级后写覆盖会让第一条线索的深链失效（idempotencyKey 含 targetSlug，
  咨询两套房源必然产生两个不同派生值）。伪造回传只能污染攻击者自己线索的
  分析归因，不触及他人数据，风险接受。
- **客户端**：`InquiryModal` 成功分支在 `analyticsEnabled` 下调
  `umami.identify(visitorRef)` 并写入 `sessionStorage`（不发生在此前任何时点
  ——D5 决策的机器保证是代码评审 + E2E 断言匿名浏览阶段无 identify 调用）。
- **后台**：线索详情加只读区块「转化前浏览路径」：深链到 Umami Sessions 按
  distinct id 过滤的视图（v3.3 支持 identity stitching）；不在 Payload 内重绘。
- **合规**：提交按钮旁告知文案 + 隐私政策补「提交咨询后我们将关联您在本站的
  匿名浏览记录用于服务跟进」条款；visitorRef 不含任何个人信息原文。

**验收**：1) 提交咨询成功后 Umami 中该会话获得 distinct id，且与 Lead.visitorRef
一致；同会话提交第二条线索，两条 Lead 的 visitorRef 相同；2) 匿名浏览全程
（提交前）无 identify 调用（E2E 断言 stub）；3) 线索详情深链可打开对应访客
profile；4) 匿名 REST 读 lead 不含 visitorRef；5) `pnpm migrate:dry-run` 通过
（静态校验，不连库），且本地**全新** PG 库从零 `pnpm exec payload migrate`
全量通过（等价生产 migrate-locked 执行路径；仓库无预发库环节）；6) 浏览器实测。
**测试**：单测（visitorRef 生成稳定性/长度、响应形状）+2；E2E +1~2。
**Effort**：0.5–1 天。**回滚**：revert 代码；已写入的 visitorRef 列保留（无害，
不含 PII），不做回滚迁移。

## 7. 依赖图与排序理由

```
OPT-064 采集接通 ──┬──────────────→ OPT-066 流量块+漏斗
                   └──────────────→ OPT-067 identify 关联
OPT-065 业务日报页 ────────────────→ OPT-066（页面壳）
```

064 最先：埋点数据不可补录，每晚一天少一天；065 与 064 无依赖可并行，但串行
更稳（宪章：没准备好上线的东西别合）；066 需要 064 的数据和 065 的页面壳；
067 合规文案确认后随时可做。

## 8. Out of scope（明确不做）

- 会话回放（D6：有排障需求再议；开启前必须先定掩码 + Block Selector 策略）
- GA4 / 百度统计 / Plausible / Clarity（D1/D2 已排除）
- 「电话咨询」按钮埋点——该功能本身不存在（`ListingDecisionCard.tsx:28-31`
  注释：仓库无可公开展示的号码字段），不是漏埋
- 首页/内容页的 page_engagement（D11 之外的页，二期看数据再扩）
- Umami 事件数据清理/归档任务（D10）
- 补齐 `supply_filter` 调用点（白名单已定义、从未埋，见 §3.3；二期随楼盘页迭代做）
- 对匿名访客的任何 identify（D5 的负面清单，永久约束而非「本期不做」）
- 重图表库引入（065 若手绘 SVG 不够用，另起决策）

## 9. 全局约束（继承宪章，逐条生效）

- 分支：`pnpm branch:new feat opt-064-...` 从最新 master；四个子项各自分支各自 PR。
- 权限在服务端执行；隐藏 UI 不是权限控制。
- 改 collection 必带迁移；改 `payload.config.ts` 必再生成 importmap。
- 提交只用显式 `git add <路径>`；简体中文；类型前缀与分支一致。
- **完成前浏览器实测**（宪章铁律：CI 全绿 ≠ 可用；后台用 e2e 夹具账号登录实点）。
- 本地验证前先 `pnpm exec payload migrate` 对齐环境（假 500 前科）。

## 10. 运维前置清单（需用户/控制台操作，agent 不可代办）

| # | 动作 | 说明 |
|---|---|---|
| 1 | ~~确认 `postgres-ilf7zhts` PG 版本 ≥ 12.14~~ | ✅ **已完成（2026-09-01）**：实测 PostgreSQL 17.10，远高于下限。原阻塞项解除，「复用现有实例 + 独立 database」方案成立 |
| 2 | ~~建 database `umami` + 专用账号~~ | ✅ **已完成（2026-09-01）**：复用 `postgres-ilf7zhts` 实例上的独立 database `umami`，属主 `umami_app`（`ALTER DATABASE ... OWNER TO`，绕开跨库 GRANT 的限制） |
| 3 | ~~CloudRun 建服务 `umami` 并配 env~~ | ✅ **已完成（2026-09-02）**：`https://umami-286300-10-1253925058.sh.run.tcloudbase.com`，Umami v3.3.1 |
| 4 | ~~Umami 初始化管理员密码、建网站条目~~ | ✅ **已完成（2026-09-02）**：website ID `3a281820-ae20-43f9-b082-dc0224ed874f`。已随 OPT-064b 写进 Dockerfile 两个阶段的 ENV |
| 5 | sbh 服务新增**服务端** env | 仅 `UMAMI_URL/USERNAME/PASSWORD/WEBSITE_ID` 四项（控制台/MCP 配）；`NEXT_PUBLIC_UMAMI_*` 与 `NEXT_PUBLIC_ANALYTICS_ENABLED` 为构建期内联，**随 PR 写进 Dockerfile ENV**，不在此配 |
| 6 | 生产角色授予 | 平台管理员角色勾选 MENU 码 `analytics`（导航可见）与操作码 `analytics:traffic`（流量块）。角色是数据不随代码走；seed/fixture 仅覆盖 E2E |
| 7 | 隐私政策文案过目 | §6.1-10 与 §6.4 合规条款上线前确认 |

## 11. 效果衡量（怎么知道这事做对了）

- 上线一周后：Umami 日 PV/UV 有连续数据；漏斗四步无断层；
  `page_engagement` 中位数可查；漏报率 < 20%（超出则排查拦截/时机）。
- 运营可在一页回答：昨天来了多少人 → 提了多少咨询 → 上了多少房源。
- 销售可从任一新线索一键看到其转化前浏览路径。
