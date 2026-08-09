# PRD：委托找房 / 投放房源 双落地页

- 日期：2026-08-09
- 分支：`claude/delegated-search-listing-pages-7eeeef`
- 状态：**待评审**（含 6 项待确认问题，见 §12）
- 参考对标：阿里商办 `shangban.taobao.com/home-shanghai/zhaofang/`（委托找房）、`/toufang/`（投放房源）

> **关于对标站的说明（重要）**
> 抓取工具无法访问 `shangban.taobao.com`（浏览器读取被站点策略拦截，WebFetch 被拒，中文搜索无有效结果）。因此本 PRD 中**参考站的具体分区顺序、文案、字段清单均为按行业通行形态推断的假设**，在正文中以 `【假设】` 标注。请提供 2–4 张截图（首屏、表单区、流程区、FAQ 区）以逐条对齐；对齐前不要把本文当作像素级还原依据。

---

## 1. 背景与目标

平台当前 C 端只有**单向漏斗**：用户浏览房源/楼盘 → 询价留电（`/api/inquiries` → `Leads`）。两个缺口：

1. **需求侧重度用户无处落地**：明确知道"我要在某商圈找 200㎡、8 月入驻"的客户，被迫先逐条翻列表再点询价，结构化需求（面积区间/预算/席位/租期）在详情页询价弹层里根本填不了——而 `Leads.demandProfile` 已经有这些字段，只是前台没有采集入口。
2. **供给侧完全没有收口**：业主、物业方、中介想把房源交给平台，站上没有任何入口，也没有任何集合能承接匿名公开提交（`Merchants` 是后台维护的商户档案，`Listings` 是已审核的正式房源，都不能直接接外部写入）。

目标：

- **G1** 上线「委托找房」页，把重度需求客户的结构化需求一次性采集完整，落入 `Leads` 并进现有归属/跟进/SLA 流程。
- **G2** 上线「投放房源」页，建立供给侧线索收口与审单工作流，形成"外部提交 → 人工审核 → 转为 Listing 草稿"的闭环。
- **G3** 调整主导航，让两个新入口在导航上可见。

非目标见 §11。

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

- 删除「服务式办公」（`/listings?type=serviced-office`）。
- 在「共享办公」之后插入「委托找房」`/entrust`、「投放房源」`/publish`。
- 「资讯」保持在最后。
- 同步处理 `SiteFooter.tsx:32` 的「服务式办公」链接（页脚同一条也删除，并在页脚"服务"分组补上两个新入口）。

**只删导航入口，不动数据**：`Listings.listingType` 的 `serviced-office` 枚举值、移动端筛选抽屉里的「服务式办公」选项（`MobileFilterDrawer.tsx:39`）、详情页文案映射（`detail-metadata.ts:68`）**全部保留** —— 房源类型本身仍然存在，只是不再占用导航位。

导航项从 5 个变 6 个，桌面端横排宽度需复核（尤其 1024–1280px 断点），移动端抽屉为纵向列表，不受影响。

### 2.2 新增页面

| 路由 | 页面 | 渲染 | 表单落库 |
|---|---|---|---|
| `/entrust` | 委托找房 | RSC 静态外壳 + 客户端表单 | `POST /api/inquiries`（扩展）→ `Leads` |
| `/publish` | 投放房源 | RSC 静态外壳 + 客户端表单 | `POST /api/supply-submissions`（新建）→ `SupplySubmissions`（新集合） |

路由命名见 §12 Q1（`/entrust` `/publish` vs 拼音 `/zhaofang` `/toufang`）。

---

## 3. 页面结构（两页共用骨架）

【假设】对标站与同类站（58 商办、搜楼网）的落地页都是同一套骨架，本次沿用，保证两页视觉一致：

1. **首屏 Hero**：主标题 + 一句话价值承诺 + **表单主体**（委托找房）或表单入口（投放房源）。表单直接放首屏，不要"先滚动再填写"。
2. **服务流程**：4 步图文条。
3. **价值点**：3–4 个卡片，说明"为什么交给我们"。
4. **数据背书**：覆盖楼盘数 / 在租房源数 / 服务企业数。数值来源见 §12 Q4。
5. **常见问题 FAQ**：4–6 条折叠项（同时用于 SEO 的 FAQPage 结构化数据）。
6. **页尾二次 CTA**：滚到底再给一次提交入口（移动端为吸底按钮）。

设计系统：复用 `(frontend)/styles.css` 的奶油+金色变量（`--ink --muted --line --paper --cream --gold --deep --green`）与现有 `.btn` / `ui/Field` / `ui/Modal` 组件，**不引新 UI 库**（应用宪章硬约束）。

---

## 4. 页面一：委托找房 `/entrust`

### 4.1 定位

面向"已经确定要找办公室、但不想自己翻列表"的企业决策人。承诺：填一次需求，顾问出选址方案。

### 4.2 表单字段

单页长表单，不分步（理由见 §5.3）。字段与 `Leads` 已有字段一一对应，**不新增 Leads 字段**：

| # | 字段 | 控件 | 必填 | 校验 | 落库位置 |
|---|---|---|---|---|---|
| 1 | 办公类型 | 单选按钮组（整层/独立办公室/服务式办公/共享工位） | 是 | 枚举，对齐 `Listings.listingType` | `demand.*` + 备注（见下） |
| 2 | 意向城市 | 下拉（上海，MVP 单城） | 是 | 关联 `Locations`(city) | `city` |
| 3 | 意向商圈 | 多选标签，最多 3 个 | 否 | 关联 `Locations`(district/business-area) | `demand.district` |
| 4 | 面积需求 | 两个数字输入（下限/上限，㎡） | 二选一必填 | ≥0，上限 ≥ 下限 | `areaMin` / `areaMax` |
| 5 | 工位数 | 数字输入 | 二选一必填 | 1–10000 整数 | `seatCount` |
| 6 | 预算 | 两个数字输入 + 计价周期下拉 | 否 | ≥0，上限 ≥ 下限 | `budgetMin` / `budgetMax` / `billingPeriod` |
| 7 | 期望入驻时间 | 日期选择（仅到日） | 否 | 不早于今天 | `moveInDate` |
| 8 | 租期 | 下拉（1年/2年/3年/3年以上/灵活） | 否 | 映射为月数 | `leaseMonths` |
| 9 | 特殊需求 | 多行文本 | 否 | ≤1000 字 | `specialRequirements` |
| 10 | 公司名称 | 文本 | 否 | ≤100 | `company` |
| 11 | 联系人 | 文本 | 是 | 1–50 | `name` |
| 12 | 手机号 | 文本 | 是 | 中国大陆 11 位（复用 `domain/shared/phone`） | `phone` |
| 13 | 隐私同意 | 复选框 + 政策链接 | 是 | 必须为 true | `consentAccepted` / `consentPolicyVersion` |

第 4/5 项**二选一必填**：面积区间和工位数至少填一组（不同客户习惯不同，强制两者都填会掉转化）。

第 1 项"办公类型"在 `Leads` 里没有对应字段。**决定**：不为它加字段，写入 `specialRequirements` 前缀（形如 `[办公类型] 共享工位；<用户填写内容>`）。理由：`Leads` 已经很大，为一个纯采集维度加列不划算；如果后续要按类型做分析，再单独提字段迁移。

### 4.3 提交链路

`POST /api/inquiries`，沿用现有 schema 白名单收窄（`domain/inquiry/schema.ts`），需要三处扩展：

1. `SOURCE_PAGE_TYPES` 增加 `'entrust'`；`Leads.INQUIRY_SOURCE_PAGE_TYPES` 同步增加。**这是 PG select 枚举变更，必须 `payload migrate:create` 生成迁移**（注意历史上 PG ENUM 迁移踩过坑，迁移文件正文绝不手改）。
2. `targetType` 允许 `'none'`（委托找房没有具体房源/楼盘目标）——需核对现有实现是否已支持，若否则放宽。
3. 结构化需求字段（面积/预算/席位/租期/入驻/特殊需求）目前 schema 里 `demand` 只有 `{district, budget, area, moveInTime}` 四个字符串字段，需扩展为结构化数值字段并写入 `Leads.demandProfile`。**这是本页最大的一块后端工作量。**

幂等、同源 path 校验、隐私日志：全部沿用现有机制，不新造。

### 4.4 提交后

- 成功：表单区就地替换为成功态（"已收到，顾问将在 2 小时内与您联系"），不跳转新页（保住 URL 便于埋点归因）。
- 失败：字段级错误内联展示；网络/服务端错误给统一重试提示，保留已填内容。
- 不做短信验证码（见 §12 Q3）。

---

## 5. 页面二：投放房源 `/publish`

### 5.1 定位

面向业主、物业方、中介、联合办公运营方。承诺：免费上架、专人对接、优先曝光。

### 5.2 新集合 `SupplySubmissions`（房源投放申请）

**决定：新建独立集合，不复用 `Leads`。** 理由：供给侧字段（楼盘名、地址、可租面积、报价、身份角色、产权情况）与需求侧几乎零重叠；`Leads` 上挂着归属/公共池回收/首次跟进 SLA/日领取上限一整套销售机制，把"业主来找我们"的反向线索塞进去会污染转化率与 SLA 统计，销售视图还得到处加过滤条件。审单动作（审核 → 转 Listing 草稿）本来就是另一条工作流。

字段：

**提交内容（外部写入）**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `submitterRole` | select | 是 | `owner`(业主) / `property`(物业方) / `agency`(中介) / `operator`(联合办公运营方) |
| `contactName` | text | 是 | 1–50 |
| `contactPhone` | text | 是 | 中国大陆 11 位 |
| `companyName` | text | 否 | ≤100 |
| `buildingName` | text | 是 | 楼盘/物业名称，≤100 |
| `city` | relationship→locations | 是 | MVP 固定上海 |
| `district` | relationship→locations | 否 | 区域/商圈 |
| `address` | text | 否 | 详细地址，≤200 |
| `leaseMode` | select | 是 | `whole-floor`(整层) / `office`(独立办公室) / `seat`(工位) / `sale`(出售) |
| `areaMin` / `areaMax` | number | `areaMin` 必填 | 可租面积(㎡) |
| `floorInfo` | text | 否 | 楼层描述，≤50 |
| `fitoutStatus` | select | 否 | `bare`(毛坯) / `simple`(简装) / `full`(精装) / `furnished`(带家具) |
| `priceAmount` | number | 否 | 期望报价 |
| `priceUnit` | select | 否 | 复用询价的 `PRICE_UNITS`（`rmb-sqm-day` / `rmb-month` / `rmb-seat-month` / `rmb-total`） |
| `availableFrom` | date | 否 | 可入驻时间 |
| `description` | textarea | 否 | 房源补充说明，≤1000 |

**流程字段（后台维护）**

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | select | `pending`(待处理) / `contacted`(已联系) / `converted`(已转房源) / `rejected`(已拒绝) / `duplicate`(重复) |
| `assignee` | relationship→users | 跟进人 |
| `reviewNote` | textarea | 审核备注 / 拒绝原因 |
| `matchedBuilding` | relationship→buildings | 人工匹配到的已有楼盘 |
| `convertedListing` | relationship→listings | 转出的房源（草稿） |
| `handledAt` | date | 处理时间（readOnly，状态流转时写） |

**溯源与合规（readOnly，服务端写）**

`sourcePath`、`sourceUrl`、`requestId`、`idempotencyKey`（唯一索引）、`consentAccepted`、`consentPolicyVersion`、`campaign` —— 与 `Leads.inquiryContext` 同构，直接照搬字段定义，保证两条链路的合规口径一致。

**图片上传不在 MVP 内**（见 §11）。表单文案改为"提交后由顾问与您对接照片与平面图"。

### 5.3 表单形态：单页 vs 分步

投放房源字段更多（17 个），第一反应是做 3 步向导。**决定：两页都用单页长表单 + 分组小标题。** 理由：

- 分步向导要维护跨步状态、返回上一步、进度条、部分校验，客户端复杂度翻倍，而本次表单没有分支逻辑（不存在"选了 A 才出现 B 组"的重型条件）。
- 供给侧提交者动机强（他们想上架），不需要靠"只填 3 个字段就先拿到你"的心理技巧。
- 单页对移动端更友好：一次滚动完，不会在第 2 步流失后什么都没留下。

若上线后数据显示中途流失严重，再改成"联系方式先行 + 房源信息补充"两段式。

### 5.4 提交链路

新端点 `POST /api/supply-submissions`，与 `/api/inquiries` **同构实现**：

- schema 白名单收窄（`src/domain/supply-submission/schema.ts`，纯函数，Vitest 单测）；
- 幂等键 = `requestId + 标准化手机号 + buildingName` 的哈希，DB 唯一索引兜底；
- `sourcePath` 只接受同源 pathname，剥离 query/hash；
- 服务端用 Local API 写入，`access.create` 对公开请求开放但字段白名单严格，流程字段一律拒绝外部写入；
- 提交成功后向供给运营角色发 `Notifications`（复用现有通知机制）。

### 5.5 后台

- 新增导航分组"供给投放"，列表默认按 `status=pending` + 创建时间倒序；
- 列表列：楼盘名 / 提交人角色 / 联系人 / 区域 / 可租面积 / 状态 / 提交时间；
- 详情页两个动作按钮：**转为房源草稿**（预填 `Listings` 草稿并跳转）、**标记拒绝**（必填原因）；
- 权限：绑定现有角色体系，供给运营/管理员可读写，销售只读。角色映射见 §12 Q5。

---

## 6. 数据与迁移

需要的迁移（`payload migrate:create` 生成，**正文绝不手改**）：

1. `Leads.sourcePageType` 枚举增加 `entrust`；
2. `Leads.demandProfile` 若确认需要新增字段（取决于 §4.2 决定，当前设计为**不新增**）→ 预期无变更；
3. 新表 `supply_submissions` + 唯一索引（`idempotency_key`）+ 关联表。

生产是共享 TencentDB、`push: false`，本地也必须走显式迁移。本地开发用本工作树独立 PG 库（如 `sbh_dev_entrust`）与独立端口，不共用 `sbh_dev`。

---

## 7. SEO

- 两页各自 `generateMetadata`：title / description / canonical / OG。
- `sitemap.ts` 增加两条静态项（优先级低于列表页，高于内容页）。
- FAQ 区输出 `FAQPage` JSON-LD；页面主体输出 `Service` JSON-LD。
- 两页都是静态外壳（不读 DB 的部分），只有数据背书数字若走 DB 才需要 `force-dynamic`——见 §12 Q4，若用静态常量则整页可静态化，性能更好。

---

## 8. 埋点与成功指标

埋点事件（复用 `domain/analytics`）：

| 事件 | 触发 |
|---|---|
| `entrust_page_view` / `publish_page_view` | 页面曝光 |
| `form_start` | 首个字段获得焦点 |
| `form_submit_attempt` | 点击提交 |
| `form_submit_success` / `form_submit_error` | 服务端结果 |

上线 4 周后看：

- 两页 PV；
- 表单完成率（`form_start` → `success`）**目标 ≥ 25%**；
- 委托找房带来的 `Leads` 中，结构化需求字段填充率 **≥ 70%**（对比详情页询价近乎为 0，这是本页的核心价值证明）；
- 投放房源提交量与 `converted` 转化率。

---

## 9. 验收标准

1. 导航桌面端与移动端均为 6 项且顺序正确；「服务式办公」在导航与页脚均已移除；房源类型筛选仍可选服务式办公。
2. `/entrust` 提交后在后台 `Leads` 能看到一条 `sourcePageType=entrust` 的线索，且面积/预算/席位/入驻/租期字段有值。
3. `/publish` 提交后在后台"供给投放"能看到 `status=pending` 的申请；重复提交同一手机号+楼盘名不产生第二条。
4. 两页在 375px / 768px / 1280px 三档无横向滚动；表单键盘可达、错误有 `aria-describedby` 关联、触控目标 ≥44px。
5. `pnpm build` 通过（含类型检查）；schema 纯函数 Vitest 全绿（TDD：先红后绿）；Playwright 覆盖两页的成功提交 + 校验失败两条路径。
6. `payload migrate` 在干净库上可重放。

---

## 10. 实施拆分（供后续 plan 使用）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| P0 | 导航 + 页脚调整（可独立先合） | 无 |
| P1 | `SupplySubmissions` 集合 + 迁移 + 后台配置 | 无 |
| P2 | `supply-submission/schema.ts` + `/api/supply-submissions`（TDD） | P1 |
| P3 | 询价 schema 扩展结构化 demand + `entrust` 枚举 + 迁移 | 无 |
| P4 | 两页 UI（共用骨架组件 + 两个表单组件） | P2 P3 |
| P5 | SEO + 埋点 + E2E | P4 |

P0 可以先单独提一个小 PR 落地，让导航变更尽早上线并触发 CI。

---

## 11. 非目标（本次明确不做）

- 房源图片/平面图上传（需要 COS 直传签名 + 反滥用，单独立项）。
- 短信验证码校验（见 §12 Q3）。
- 业主自助登录后台管理自己的房源（供给侧账号体系，独立项目）。
- 多城市：MVP 固定上海，城市字段留结构但只有一个选项。
- 委托需求与在库房源的自动匹配推荐（`domain/recommendation` 已有基础，但本次只做采集）。
- 服务式办公落地页（本次是删导航入口，不是新建该页面）。

---

## 12. 待确认问题

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | 路由用 `/entrust` `/publish` 还是拼音 `/zhaofang` `/toufang`？ | 用 `/entrust` `/publish`，与现有 `/listings` `/buildings` `/news` 的英文风格一致 |
| Q2 | 对标站截图能否提供？没有截图，分区顺序与文案只能按行业通行形态写 | 提供首屏/表单/流程/FAQ 4 张即可 |
| Q3 | 手机号要不要短信验证码？ | MVP 不做。验证码会砍掉相当一部分转化，而两页的线索都会人工回电，虚假号码在回电环节就筛掉了 |
| Q4 | 数据背书的数字（覆盖楼盘数等）走实时 DB 统计还是运营配置的静态文案？ | 静态配置（放 `site-config`）。实时统计会让整页被迫 `force-dynamic`，且早期数字不好看时无法人工兜底 |
| Q5 | 投放房源审单归哪个角色？现有角色体系里用哪个？ | 需要你指定；若暂无对应角色，先给管理员 + 新增一个"供给运营"角色 |
| Q6 | 提交后除站内通知，是否要短信/企微通知运营？ | MVP 只做站内 `Notifications`，外部通知另开 |

---

## 附：关键代码位置

- 导航：`payload-office-platform/src/components/frontend/SiteNav.tsx:22`、`SiteFooter.tsx:32`
- 询价 schema：`payload-office-platform/src/domain/inquiry/schema.ts`
- 询价端点：`payload-office-platform/src/app/api/inquiries/route.ts`
- 线索集合：`payload-office-platform/src/collections/Leads.ts`（`demandProfile` 在"结构化需求" tab，`inquiryContext` 在溯源 tab）
- 设计系统变量：`payload-office-platform/src/app/(frontend)/styles.css`
- 表单原子组件：`payload-office-platform/src/components/frontend/ui/Field.tsx`、`Button.tsx`
