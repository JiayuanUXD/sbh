# PRD：委托找房 / 投放房源 双落地页

- 日期：2026-08-09（v2，按对标站截图重写）
- 分支：`claude/delegated-search-listing-pages-7eeeef`
- 状态：**待评审**（含 5 项待确认问题，见 §13）
- 参考对标：阿里商办 `shangban.taobao.com/home-shanghai/zhaofang/`（委托找房）、`/toufang/`（投放房源）

> **v2 修订说明**
> v1 因抓取工具无法访问淘宝域名，字段与分区全部为行业形态推断。用户已提供两页截图，本版**以截图为唯一基准**重写 §4/§5，并作废 v1 三处主要误判：
> 1. 委托找房**不采集结构化需求**，首屏只有手机号一个字段 → v1 的 13 字段表单、以及"扩展询价 schema 的 `demand` 为结构化数值字段"这块最大后端工作量全部作废；
> 2. 投放房源有 **佣金悬赏** 字段（v1 未想到），且字段数只有 v1 设计的一半；
> 3. 两页均**无 FAQ 区**，隐私同意为隐式文案而非复选框 → 删除 FAQ 区与 FAQPage 结构化数据。
>
> **截图覆盖范围**：委托找房页截到了完整长页（hero → 流程 → 能力 → 底部 CTA）。投放房源页只截到首屏卡片结束，**卡片下方是否还有区块未知**（§13 Q1）。

---

## 1. 背景与目标

平台当前 C 端只有**单向漏斗**：浏览房源/楼盘 → 详情页询价留电（`/api/inquiries` → `Leads`）。两个缺口：

1. **没有"不看房源直接留需求"的入口**：用户必须先翻列表、进详情，才能触发询价。对标站的做法是给一条零门槛捷径——首屏一个手机号框，把"我想找办公室"的意图直接转成线索。
2. **供给侧完全没有收口**：业主、物业方、中介想把房源交给平台，站上没有任何入口，也没有任何集合能承接匿名公开提交（`Merchants` 是后台维护的商户档案，`Listings` 是已审核的正式房源，都不能直接接外部写入）。

目标：

- **G1** 上线「委托找房」页：零门槛留电，接入现有归属/跟进/SLA 流程。
- **G2** 上线「投放房源」页：建立供给侧线索收口与审单工作流，形成"外部提交 → 人工审核 → 转 Listing 草稿"闭环。
- **G3** 调整主导航，让两个新入口可见。

---

## 2. 范围

### 2.1 导航调整（本次明确要求）

主导航现状（`SiteNav.tsx:22-28`）：

```
找办公室 | 找楼盘 | 服务式办公 | 共享办公 | 资讯
```

调整为：

```
找办公室 | 找楼盘 | 共享办公 | 委托找房 | 投放房源 | 资讯
```

- 删除「服务式办公」（`/listings?type=serviced-office`）；
- 在「共享办公」之后插入「委托找房」`/entrust`、「投放房源」`/publish`；
- 「资讯」保持最后；
- 同步处理 `SiteFooter.tsx:32` 的「服务式办公」链接（删除，并在页脚"服务"分组补上两个新入口）。

**只删导航入口，不动数据**：`Listings.listingType` 的 `serviced-office` 枚举值、移动端筛选抽屉选项（`MobileFilterDrawer.tsx:39`）、详情页文案映射（`detail-metadata.ts:68`）全部保留——房源类型仍存在，只是不占导航位。

导航从 5 项变 6 项，桌面端横排宽度需复核 1024–1280px 断点；移动端抽屉纵向列表不受影响。

### 2.2 新增页面

| 路由 | 页面 | 渲染 | 表单落库 |
|---|---|---|---|
| `/entrust` | 委托找房 | 全静态 RSC + 客户端表单组件 | `POST /api/inquiries`（小幅扩展）→ `Leads` |
| `/publish` | 投放房源 | 全静态 RSC + 客户端表单组件 | `POST /api/supply-submissions`（新建）→ `SupplySubmissions`（新集合） |

两页都不读 DB（数字背书走静态配置，见 §13 Q3），因此**不需要 `force-dynamic`**，可完全静态化。

---

## 3. 视觉基调（与对标站的刻意差异）

对标站是**阿里红**（`#E60039` 系）+ 3D 等距城市插画。本站**不跟随**：

- **配色照旧用本站设计系统**：`--ink --muted --line --paper --cream --gold --deep --green`。截图里所有红色元素（CTA 按钮、流程序号徽标、数字强调、必填星号）一律映射为 `--gold` / `--deep`。理由是应用宪章硬约束（复用现有变量、不引新 UI 库），且站内其余页面全是奶油+金色，插进两个红色页面会割裂。
- **结构照抄**：分区顺序、层级、文案骨架、字段清单严格对齐截图。
- **3D 插画我们没有素材**。方案：hero 背景用 CSS 渐变 + 低对比几何/建筑剪影（可用现有楼盘图做低透明度处理），不做 3D。若要 1:1 的插画质感需要单独出设计资源（§13 Q2）。
- 组件复用 `components/frontend/ui/` 的 `Field` / `Button` / `Media`。

---

## 4. 页面一：委托找房 `/entrust`

### 4.1 页面结构（照截图，自上而下）

**① Hero（左文案 / 右插画，两栏）**

- 品牌徽标条：小圆角标签，对标站文案「阿里巴巴旗下商办平台」→ 本站换为自有品牌背书文案（§13 Q4）
- H1：`{品牌} | 找办公室 写字楼租赁`
- 副标题：`全城海量真房源，价格透明，服务专业`
- **表单：单个手机号输入框 + 按钮「免费委托」**，输入框占位文案 `请输入手机号，开启您的定制选址服务`
- 右侧插画区（见 §3）

**② 选址服务流程**

- 区块标题「选址服务流程」，副标题「1对1专属选址分析，全流程量身定制」
- 4 张卡片，圆形图标 + 序号徽标 + 文案，卡片之间有 `›` 连接符：
  1. 填写手机号
  2. 专属顾问回访
  3. 定制选址方案
  4. 实地看房签约

**③ 核心服务能力**

- 区块标题「核心服务能力」，副标题「全城海量真房源，价格透明，服务专业」
- 3 列数字背书，格式为「大号数字 + 小号单位」+ 一行说明。对标站的值是 `150+万套 / 1000+人 / 30分钟`，**本站数字必须换成真实可辩护的值**（§13 Q3），不抄阿里量级。
- 背景为浅色城市剪影 + 底部淡色渐变。

**④ 底部 CTA 条**

- 一行文案「现在，开始定制您的选址服务」+ 按钮「免费委托定制」
- 点击行为：滚回 hero 并聚焦手机号输入框（不再重复一个表单，避免两个表单的埋点归因混乱）
- 移动端：改为吸底按钮（复用 `DetailMobileBarPrice` 的吸底样式经验）

### 4.2 表单字段

| # | 字段 | 控件 | 必填 | 校验 | 落库 |
|---|---|---|---|---|---|
| 1 | 手机号 | 文本 | 是 | 中国大陆 11 位，复用 `domain/shared/phone` | `Leads.phone` |

就这一个。没有姓名、没有需求、没有同意复选框。

### 4.3 隐式同意与必填字段冲突（两处必须处理）

**冲突 1：`Leads.name` 是 required，但表单不采集姓名。**
决定：在 `Leads` 的 `beforeValidate` hook 里兜底——当 `sourcePageType=entrust` 且 `name` 为空时，写入 `未留姓名（{手机号后四位}）`。理由：不放宽 `name` 的 required（后台列表、跟进视图都依赖它非空），也不让前台编一个假姓名字段。后台线索列表能一眼看出这是零门槛渠道进来的线索。

**冲突 2：询价 schema 硬要求 `consent.accepted=true` + `consent.policyVersion`，但截图无同意复选框。**
决定：沿用对标站的隐式授权形态，但**必须有可见的授权文案**——按钮下方一行小字：`提交即表示同意《隐私政策》，并授权我们与您联系`，《隐私政策》为链接。前端提交时置 `consentAccepted=true` 并带上当前 `PRIVACY_POLICY_VERSION`。这样合规留痕不变（后台仍能查到同意的政策版本），只是交互从"勾选"变为"提交即同意 + 明示告知"。**不做无告知的静默同意。**

### 4.4 提交链路

`POST /api/inquiries`，沿用现有 schema 白名单收窄（`domain/inquiry/schema.ts`）。需要的扩展只有两处（比 v1 大幅缩小）：

1. `SOURCE_PAGE_TYPES` 与 `Leads.INQUIRY_SOURCE_PAGE_TYPES` 增加 `'entrust'`。**这是 PG select 枚举变更，必须 `payload migrate:create` 生成迁移**（历史上 PG ENUM 迁移踩过坑；迁移文件正文绝不手改）。
2. 确认 `targetType='none'` 路径可用（委托找房无具体房源/楼盘目标）；若现有实现不支持则放宽。

`demand.*` 结构化字段**本次不动**——没有采集入口，扩展它没有意义。幂等键、同源 path 校验、隐私日志全部沿用。

### 4.5 提交后

- 成功：输入框区域就地替换为成功态「已收到，专属顾问将尽快与您联系」，URL 不变（保埋点归因）。
- 失败：手机号格式错误内联提示；服务端错误给统一重试提示，保留已填内容。
- 不做短信验证码（理由见 §13 Q5）。

### 4.6 建议增强项（默认不做，需你确认）

对标站只要手机号，是因为它有阿里流量 + 电销团队在后端消化——顾问接到一个光秃秃的手机号也能靠电话问清需求。**如果本站顾问人力不足，"只有手机号"的线索质量会很低。**

建议（标为 P1，本次默认不实施）：提交成功后，在原地展开一个**可选**的补充表单（意向区域 / 面积 / 预算 / 期望入驻时间，可直接跳过），填了就写入 `Leads.demandProfile`。这样首屏转化率与截图一致，同时把已存在却长期为空的 `demandProfile` 字段用起来。要不要做请在 §13 Q5 一并回复。

---

## 5. 页面二：投放房源 `/publish`

### 5.1 页面结构（照截图，自上而下）

**① Hero（居中，卡片浮在插画背景上）**

- H1（居中大字）：`房源委托 {品牌} 帮您出租`
- 副标题：`海量客源，快速成交`
- 背景：3D 城市插画（本站按 §3 降级为渐变+剪影）

**② 表单卡片（白底、大圆角、投影，压在 hero 下沿）**

卡片内自上而下：

- 卡片标题（居中）「免费投放房源」
- **4 步流程条**（图标 + `›` 分隔，横排）：`提交房源 › 实勘采集 › 推广曝光 › 签约成交`
- 分组小标题「楼盘信息」+ 4 个字段
- 分组小标题「佣金」+ 说明文案 + 单选按钮组
- 分组小标题「联系人信息」+ 授权说明 + 手机号
- 提交按钮「立即投放」（居中胶囊按钮，全宽偏窄）
- 卡片底部居中小字：品牌背书一行

**③ 卡片下方内容** — 截图未覆盖，见 §13 Q1。默认按"首屏即全部"实现。

### 5.2 表单字段（严格照截图）

| # | 分组 | 字段 | 控件 | 必填 | 占位/选项 | 落库 |
|---|---|---|---|---|---|---|
| 1 | 楼盘信息 | 楼盘名称 | 文本 | **是** | `请输入楼盘名称` | `buildingName` |
| 2 | 楼盘信息 | 详细地址 | 文本 | **是** | `请输入楼号/单元号/房间号` | `address` |
| 3 | 楼盘信息 | 出租面积 | 数字，后缀 `m²` | **是** | `请输入出租面积` | `areaSqm` |
| 4 | 楼盘信息 | 租金 | 数字 + 单位下拉 | 否 | `请输入您希望出租的价格`；单位默认 `元/㎡/天` | `rentAmount` / `rentUnit` |
| 5 | 佣金 | 佣金悬赏 | 单选按钮组 | 否（默认「无」） | `无` / `0.5个月` / `1个月` / `1.5个月` / `2个月` | `commissionMonths` |
| 6 | 联系人信息 | 手机号 | 文本 | **是** | `请输入手机号` | `contactPhone` |

**注意点**：

- **出租面积是单值，不是区间**（截图一个输入框）。
- **租金单位下拉**复用询价已有的 `PRICE_UNITS` 枚举（`rmb-sqm-day` / `rmb-month` / `rmb-seat-month` / `rmb-total`），默认 `rmb-sqm-day`（= 元/㎡/天），无需新枚举。
- **佣金**存为 select 而非 number，值域 `none | 0.5 | 1 | 1.5 | 2`（单位：月租金）。存字符串枚举而不是浮点数，避免"0 和未填"歧义，也便于后台筛"有悬赏的房源"。
- 分组「佣金」的说明文案照抄：`悬赏一定比例佣金会更快促进成交，成交后支付。`
- 分组「联系人信息」的说明文案照抄：`提交即授权将联系方式提供给服务机构/人员，以便提供服务`。同 §4.3 冲突 2，需追加《隐私政策》链接，并在提交时写入 `consentAccepted` + `consentPolicyVersion`。
- **没有联系人姓名字段**。`SupplySubmissions` 里 `contactName` 设为选填（后台可补录），不做前台采集。
- **城市**不出现在表单，服务端固定写入上海（MVP 单城）。

v1 设计过、现按截图**移出 MVP**的字段：提交人身份角色、出租方式、装修状况、可入驻时间、房源描述、公司名称、区域/商圈。这些改为**后台补录字段**（集合里保留，前台不采集），审单顾问电话确认时填。

### 5.3 新集合 `SupplySubmissions`（房源投放申请）

**决定：新建独立集合，不复用 `Leads`。** 理由：供给侧字段与需求侧零重叠；`Leads` 挂着归属/公共池回收/首次跟进 SLA/日领取上限一整套销售机制，把"业主来找我们"的反向线索塞进去会污染转化率与 SLA 统计，销售视图还要到处加过滤；审单动作（审核 → 转 Listing 草稿）本来就是另一条工作流。

**A. 前台提交字段**（外部可写，白名单严格）

`buildingName`(text,必填,≤100)、`address`(text,必填,≤200)、`areaSqm`(number,必填,>0)、`rentAmount`(number,选填,≥0)、`rentUnit`(select,复用 `PRICE_UNITS`)、`commissionMonths`(select: `none|0.5|1|1.5|2`,默认 `none`)、`contactPhone`(text,必填,中国大陆 11 位)

**B. 后台补录字段**（外部不可写）

`contactName`(text)、`companyName`(text)、`submitterRole`(select: `owner|property|agency|operator`)、`city`(relationship→locations，服务端写入上海)、`district`(relationship→locations)、`leaseMode`(select: `whole-floor|office|seat|sale`)、`fitoutStatus`(select: `bare|simple|full|furnished`)、`availableFrom`(date)、`description`(textarea)

**C. 流程字段**（外部不可写）

`status`(select: `pending|contacted|converted|rejected|duplicate`,默认 `pending`)、`assignee`(relationship→users)、`reviewNote`(textarea)、`matchedBuilding`(relationship→buildings)、`convertedListing`(relationship→listings)、`handledAt`(date, readOnly)

**D. 溯源与合规**（readOnly，服务端写）

`sourcePath`、`sourceUrl`、`requestId`、`idempotencyKey`（唯一索引）、`consentAccepted`、`consentPolicyVersion`、`campaign` —— 与 `Leads.inquiryContext` 同构，直接照搬字段定义，保证两条链路合规口径一致。

**图片/平面图上传不在 MVP**（§12）。对标站的第 2 步「实勘采集」本身就说明照片是平台派人实地拍的，不靠业主上传——正好与不做上传的决定一致，流程文案可直接照抄。

### 5.4 表单形态

单页长表单 + 分组小标题，照截图。字段只有 6 个，不需要分步向导。

### 5.5 提交链路

新端点 `POST /api/supply-submissions`，与 `/api/inquiries` **同构实现**：

- schema 白名单收窄放在 `src/domain/supply-submission/schema.ts`，纯函数 + Vitest 单测（严格 TDD）；
- 幂等键 = `requestId + 标准化手机号 + buildingName` 哈希，DB 唯一索引兜底；
- `sourcePath` 只接受同源 pathname，剥离 query/hash，拒绝绝对 URL 与控制字符；
- 服务端用 Local API 写入；公开 create 开放但字段白名单只允许 §5.3-A，B/C/D 组一律拒绝外部写入；
- 提交成功后向供给运营角色发 `Notifications`（复用现有机制）。

### 5.6 后台

- 新增导航分组「供给投放」，默认按 `status=pending` + 创建时间倒序；
- 列表列：楼盘名 / 详细地址 / 出租面积 / 租金 / **佣金** / 状态 / 提交时间；佣金列要能排序或筛选（有悬赏的优先处理）；
- 详情页两个动作：**转为房源草稿**（预填 `Listings` 草稿并跳转）、**标记拒绝**（必填原因）；
- 权限：绑定现有角色体系，供给运营/管理员可读写，销售只读（§13 Q4）。

### 5.7 提交后

- 成功：卡片就地替换为成功态「已收到，顾问将尽快与您联系实勘安排」。
- 失败：字段级错误内联；保留已填内容。

---

## 6. 数据与迁移

需要的迁移（`payload migrate:create` 生成，**正文绝不手改**）：

1. `Leads.sourcePageType` 枚举增加 `entrust`；
2. 新表 `supply_submissions` + 唯一索引（`idempotency_key`）+ 关联表（users / locations / buildings / listings）。

v1 里的"扩展 `demandProfile`"迁移**不再需要**。

生产是共享 TencentDB、`push: false`，本地也必须走显式迁移。本地开发用本工作树独立 PG 库（如 `sbh_dev_entrust`）与独立端口，不共用 `sbh_dev`。

---

## 7. SEO

- 两页各自 `generateMetadata`：title / description / canonical / OG；
- `sitemap.ts` 增加两条静态项；
- 输出 `Service` JSON-LD（`/entrust` 为选址服务，`/publish` 为房源委托代理服务）；
- **不做 FAQPage**——截图两页均无 FAQ 区，不为了 SEO 硬造一个不在设计里的区块；
- 两页全静态（数字背书走静态配置），首屏性能应显著优于现有列表页。

---

## 8. 埋点与成功指标

事件（复用 `domain/analytics`）：

| 事件 | 触发 |
|---|---|
| `entrust_page_view` / `publish_page_view` | 页面曝光 |
| `form_start` | 首个字段获得焦点 |
| `form_submit_attempt` | 点击提交 |
| `form_submit_success` / `form_submit_error` | 服务端结果 |
| `entrust_bottom_cta_click` | 底部 CTA 点击（验证"滚到底再转化"是否值得保留） |

上线 4 周后看：

- 两页 PV；
- **委托找房**表单完成率（`form_start` → `success`）**目标 ≥ 40%**（只有一个手机号字段，门槛极低，指标应显著高于多字段表单）；
- **投放房源**表单完成率 **目标 ≥ 20%**（6 个字段，含 3 个必填的房源信息）；
- 投放房源提交量、`converted` 转化率、**有佣金悬赏的提交占比**（验证悬赏机制是否被业主接受）；
- 委托找房线索的电话接通率（这是"只要手机号"这个设计的最大风险点，若接通率低则启动 §4.6 增强项）。

---

## 9. 验收标准

1. 导航桌面端与移动端均为 6 项且顺序正确；「服务式办公」在导航与页脚均已移除；房源类型筛选仍可选服务式办公。
2. `/entrust` 提交手机号后，后台 `Leads` 出现一条 `sourcePageType=entrust` 的线索，`name` 为兜底值，`consentPolicyVersion` 有值。
3. `/publish` 提交后，后台「供给投放」出现 `status=pending` 申请，佣金字段值正确；重复提交同一手机号+楼盘名不产生第二条。
4. 两页在 375px / 768px / 1280px 三档无横向滚动；投放房源的浮起卡片在移动端不溢出、不遮挡 hero 标题。
5. 表单键盘可达；错误用 `aria-describedby` 关联；触控目标 ≥44px；必填星号有无障碍文本（不能只靠 `*` 的颜色传达必填）。
6. `pnpm build` 通过（含类型检查）；`supply-submission/schema.ts` Vitest 全绿（TDD：先红后绿）；Playwright 覆盖两页的成功提交 + 校验失败两条路径。
7. `payload migrate` 在干净库上可重放。
8. 两页均无 `force-dynamic`（确认静态化生效）。

---

## 10. 实施拆分（供后续 plan 使用）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| P0 | 导航 + 页脚调整（可独立先合，先跑 CI） | 无 |
| P1 | `SupplySubmissions` 集合 + 迁移 + 后台配置（含佣金列） | 无 |
| P2 | `supply-submission/schema.ts` + `/api/supply-submissions`（TDD） | P1 |
| P3 | `entrust` 枚举迁移 + `Leads.name` 兜底 hook + `targetType=none` 核对 | 无 |
| P4 | 共用落地页骨架组件（hero / 流程条 / 数字背书 / 底部 CTA） | 无 |
| P5 | `/entrust` 页面 + 手机号表单 | P3 P4 |
| P6 | `/publish` 页面 + 6 字段卡片表单 | P2 P4 |
| P7 | SEO + 埋点 + E2E | P5 P6 |

相比 v1 少了"扩展结构化 demand"一整块，整体工作量下降约三分之一，且 P4 的骨架组件两页共用。

---

## 11. 组件清单

新增（均在 `components/frontend/`）：

- `LandingHero.tsx` — 两种布局变体（`split` 用于委托找房，`centered` 用于投放房源）
- `ProcessSteps.tsx` — 带 `›` 连接符的横排步骤条，两页共用（委托找房 4 步大卡片、投放房源 4 步紧凑图标条为同组件的两种尺寸）
- `StatHighlights.tsx` — 3 列数字背书
- `EntrustForm.tsx` — 单手机号表单（客户端组件）
- `SupplySubmissionForm.tsx` — 6 字段卡片表单（客户端组件）
- `BottomCtaBar.tsx` — 底部 CTA 条 + 移动端吸底

样式追加进 `(frontend)/styles.css`，沿用现有 class 命名习惯，不新建 CSS 方案。

---

## 12. 非目标（本次明确不做）

- 房源图片/平面图上传（对标站靠"实勘采集"环节由平台拍摄，业主不上传）。
- 短信验证码校验（§13 Q5）。
- 业主自助登录管理自己的房源（供给侧账号体系，独立项目）。
- 多城市：MVP 固定上海。
- 委托需求与在库房源的自动匹配推荐。
- 服务式办公落地页（本次是删导航入口，不是新建页面）。
- 佣金的线上支付/结算（只采集悬赏意愿，成交与结算全部线下）。
- 复刻对标站的 3D 插画与阿里红配色（§3）。

---

## 13. 待确认问题

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | 投放房源页表单卡片**下方还有内容吗**？截图只到卡片结束 | 若有，补一张截图；否则按"首屏即全部"实现 |
| Q2 | hero 插画：接受 CSS 渐变+剪影的降级方案，还是要出设计资源做 3D 插画？ | 先上降级方案，插画作为后续视觉优化项 |
| Q3 | 「核心服务能力」三个数字用什么真实值？对标站是 `150+万套 / 1000+人 / 30分钟` | 用可辩护的真实值，放 `site-config` 由运营维护；数字不够好看时宁可换维度（如"覆盖 X 个商圈"）也不要抄阿里量级 |
| Q4 | 品牌背书文案（对标站「阿里巴巴旗下商办平台」）+ 投放房源审单归哪个角色？ | 背书文案需你给；角色若无对应，先给管理员 + 新增「供给运营」角色 |
| Q5 | 手机号要不要短信验证码？§4.6 的可选补充需求表单要不要做？ | 都先不做，与截图保持一致；上线后看委托找房线索的电话接通率再决定是否补 §4.6 |

---

## 附：关键代码位置

- 导航：`payload-office-platform/src/components/frontend/SiteNav.tsx:22`、`SiteFooter.tsx:32`
- 询价 schema：`payload-office-platform/src/domain/inquiry/schema.ts`（`SOURCE_PAGE_TYPES`、`PRICE_UNITS`）
- 询价端点：`payload-office-platform/src/app/api/inquiries/route.ts`
- 线索集合：`payload-office-platform/src/collections/Leads.ts`（`INQUIRY_SOURCE_PAGE_TYPES` 在 :19，`inquiryContext` 溯源字段在 :455 起）
- 手机号校验：`payload-office-platform/src/domain/shared/phone.ts`
- 隐私政策版本：`payload-office-platform/src/lib/frontend/site-config.ts`（`PRIVACY_POLICY_VERSION`）
- 设计系统变量：`payload-office-platform/src/app/(frontend)/styles.css`
- 表单原子组件：`payload-office-platform/src/components/frontend/ui/Field.tsx`、`Button.tsx`
