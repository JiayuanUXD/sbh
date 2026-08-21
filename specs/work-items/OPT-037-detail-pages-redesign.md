# Task Packet：OPT-037 详情页 Apple 中性极简改版（房源详情 + 楼盘详情）

> 状态：**实施完成，待合并**（实施结果见 §7，**有意变更**见 §8——别当 bug「恢复」，遗留见 §9）
> 创建日期：2026-08-21　实施完成：2026-08-22
> 分支：`feat/opt-037-detail-pages-redesign-3d9b`（叠在 `feat/opt-036-listing-pages-redesign-8f2a` 之上，base `ec29a0b`）
> 设计依据：`docs/SBH设计任务讨论/房源详情.dc.html`（58 行落地数值）、`楼盘详情.dc.html`（67 行）
> 前置：OPT-035 首页（token 层、共享基元）、OPT-036 列表页（`.sf-*` 基元、`listing-url.ts`、展示映射收敛）
> 验证证据：`artifacts/verification/OPT-037/`（已入库 326 个文件：截图 + 量测 JSON + **生成脚本**。
> 脚本随证据一起提交是本批立的规矩——证据文件不能自证，见 `.agent/testing.md`）
>
> ⚠️ **§0–§4 是实施前的计划，其中若干条已被实施期的实测推翻**（逐条见 §7.3）。
> 遇到本文前后不一致时，**以 §7–§9 与源码为准**。

全量改版共 6 个页面族。OPT-035 首页、OPT-036 两个列表页已完成；本工作项覆盖两个详情页；城市招募页另立 OPT-038。

## 0. 设计决策（取自设计稿默认方案）

沿用既定口径：**`.dc.html` 为唯一事实源**，稿中默认方案即结论。

| 决策点 | 结论 |
|---|---|
| 房源详情画廊 | **A · 大图 + 缩略图条**（B 横滑 / C 3+1 网格不采用） |
| 楼盘详情供给区 | **A · 分组切换 + 密度表**（B 全组堆叠不采用） |
| 内容容器 | **1180px**（与首页一致；列表页的 1280 是网格刚需，详情页不适用） |
| 核心区栏宽 | 主栏 **776** + gap **32** + 决策栏/信息面板 **372** = 1180 |

## 1. 与前两批的关系

**必须复用，不得另起：**
- `styles/surface.css` 的 `.sf-card` / `.sf-media` / `.sf-scrim` / `.sf-phototag` / `.sf-num`
- `src/lib/frontend/listing-url.ts` 的 href 基元
- `src/lib/frontend/listing-display.ts` 的展示映射
- 跨批次统一口径见 `.superpowers/sdd/cross-batch-design-decisions.md`

**详情页自有的差异**（写进代码注释）：
- 面板底 `#fff`、圆角 18、**零边框**；通栏 padding **40**，决策卡 padding **32**
- 页面底 `#f5f5f7`，面板底 `#ffffff` —— 仍然只有两级
- 主图 **16:10** 固定裁切 776×485 cover（列表页房源卡是 4:3，楼盘卡是 16:10）
- 图上渐变此处为 `rgba(0,0,0,.46)` 底部 **38%**（与 `.sf-scrim` 的 .42/45% 不同）→ **判断后再定**：能否统一到 `.sf-scrim`，不能则加修饰类并注明理由

## 2. 房源详情

### 2.1 骨架与吸附

- 页面顺序：标题栏 → 核心区（画廊 + 决策卡）+ 概况面板 → 描述 → 周边与交通 → 所在楼盘
- 标题栏 padding `32 / 24`；h1 `32/600/1.15`；面包屑 `13/--ink-3`
- 核心区：主栏 776（画廊）+ 决策栏 372，`column-gap 32`，`row-gap 0`
- **决策卡 sticky `top 116`**（44 导航 + 56 吸附条 + 16），粘附区间为核心区第 1 行，行末释放
- **吸附询价条**：`sticky top 44`、高 **56**、决策卡离屏后接管
- 概况面板通栏 `grid-column 1 / -1`、`grid-row 2`、`margin-top 24`（原稿此处为 tab 区，租金账取消后不再需要 tab 容器）

### 2.2 画廊（方案 A）

- 主图 16:10 固定裁切 776×485 `object-fit: cover`
- 缩略图条 5 格 `1fr`、`gap 8`、圆角 10、16:10
- **无图替代构图**（图片质量不可控是本项目的既定前提）：关键规格 **3×2 宫格**（值 `32/600`）+ 地址交通条顶上首屏，**不留空占位**

### 2.3 房源概况面板

> **2026-08-21 产品裁定：取消「这套房一个月要花多少」租金账 tab。** 原设计稿在此处给两个 tab
> （房源概况 / 租金账）。租金账已移除，概况不再需要 tab 容器，直接以面板呈现。
> 若将来恢复，需重新评估：租金单位（元/月 · 元/㎡/天 · 元/工位/月）与物业费（元/㎡/月）、
> 停车费（元/月/位）量纲不同，缺面积或车位数时无法通约，合计不可简单相加。

- 组间距 `40px`、组标签 `13/600/--ink-3`
- 行 `min-height 44`、键 `15/400/--ink-2`、值 `15/500/--ink`
- **组区分只用间距 + 组标签，不用顶线不用色块**
- 数值缺失显示 `—`，不显示 0，不隐藏整行

### 2.4 周边与交通

- 地图 776×460、圆角 18、`saturate(.12) contrast(1.04)`
- 本房源图钉 `14px` accent + `6px` 光环；标签 `168×34` 底 `#1d1d1f`
- 周边点位 + 清单面板（现有 `LocationPanel` / `AmapMapCanvas` 可复用，先读再决定改造范围）

## 3. 楼盘详情

### 3.1 骨架

- **吸附条 = 锚点导航 + 询价**（取代房源页的价格条）
- 核心区：主图 776 + gap 32 + 信息面板 372

### 3.2 供给区（方案 A · 分组切换 + 密度表）

- 组聚合（租赁 / 出售 / 联合办公，示例 42 / 6 / 3）→ 筛选 + 排序 → 表头 → 行
- 密度表形态，非卡片网格
- 现有 `BuildingSupplyBrowser`（289 行）承担同类职责，**先读它再决定改造还是重写**

### 3.3 规格参数区

设计稿列出的参数**全部对应 `Buildings` 已有字段**（等级 / 竣工年份 / 总建筑面积 / 地上地下层数 / 标准层面积 / 层高净高 / 客梯货梯 / 电梯速度 / 空调 / 供电 / 通信 / 楼板承重 / 物业费 / 物业公司 / 停车位 / 车位配比 / 停车费 / 空调加时费 / LEED / 可注册 / 出租率 / 主要租户行业 / 最小可租面积 / 最短租期）。

**规格表口径（继承 §R1）**：两列，左列 `--ink-2`，右列右对齐 + `tabular-nums` + `500` 字重；行间 `1px solid --line`，末行无线；**数值缺失显示 `—`，不显示 0，不隐藏整行**。

### 3.4 地图两态

有坐标 → 地图 + 清单面板；无坐标 → 降级构图（稿中已给），**不得渲染空地图容器**。

## 4. 硬约束（继承前两批）

- 数字一律 `tabular-nums`；缺失显示 `—`，**不显示 0**
- 空态整段不渲染，不展示空货架
- 中文 `letter-spacing: normal`；只用 token；标签零色相
- 图容器 `display: block` + `aspect-ratio`；图上白字必带渐变压暗
- 动画不得 fail-closed；`aria-current` 用于当前态，`aria-pressed` 只在 `role="button"` 下
- Server Components 默认；组件只消费 DTO，不调用 Payload
- 高基数、内容驱动、常驻渲染的链接要 `prefetch={false}`
- **同一判断逻辑不得存在多处**——需要复用先收敛再用（前两批共栽 6 次）
- 守卫要落在失效点，且 fixture 必须域层可达
- 清理一律逐类名/逐符号核查，禁止按标题边界整块删
- **facet/取数若需并发，必须并进 OPT-036 建立的同一波合并层**，不得另起 `await` 段（否则重现查询放大）

## 5. 验收

- `pnpm typecheck` + `pnpm test` + `pnpm lint` 无新增错误
- 四断点（375 / 768 / 1440 / 1920）逐屏截图人工确认
- 状态走查：无图房源、无坐标楼盘、概况字段缺失、供给区三组各自为空、超长标题
- sticky 行为实测：决策卡粘附区间正确、吸附条在决策卡离屏后接管、两者不重叠
- 规格表与概况面板数值缺失显示 `—`，不显示 0，不隐藏整行
- 证据存 `artifacts/verification/OPT-037/`

---

## 7. 实施结果（2026-08-22）

分支 `feat/opt-037-detail-pages-redesign-3d9b`，`ec29a0b..14c73e9` 共 28 个提交，
分 Task 1–12 推进（基元 → 组件 → 接线 → 清理 → 预取 → 文档）。
`src/` 净变化 53 个文件 / +5985 −1070 行。**本批次零数据库变更、零迁移。**

### 7.1 交付内容

**新建共享基元**（`src/components/frontend/detail/`，两个详情页共用）

`DetailPanel`（`.dt-panel`，白底零边框，`full` padding 40 / `side` padding 32）、
`SpecTable`（`.dt-spec`，缺失渲染 `—` 不隐藏行）、`ListingOverviewPanel`（房源概况面板）、
`BuildingSpecPanel`（楼盘参数 2 列）、`ListingDecisionCard`（决策卡）、
`StickyInquiryBar`（吸附询价条）、`AnchorNavBar`（楼盘页吸附锚点导航）、
`NoImageHeroGrid`（无图替代构图，两页共用 + `meta` 参数化）、`fact-lookup.ts`（`findFact` / `factValue` / `formatCompletionYear`）。

**新建样式**：`src/app/(frontend)/styles/detail.css`（1136 行，`.dt-*`，在 `layout.tsx` 里排在
`styles.css` / `surface.css` / `home.css` / `list.css` **之后** import）。

**新建工具**：`lib/frontend/use-anchor-visibility.ts`（`StickyInquiryBar` 与 `DetailMobileBarPrice`
共用的 IntersectionObserver 样板，第 7 次「同一判断逻辑多处」的收敛产物）、
`building-detail/no-media-fallback.ts`。

**改造非重写**（既有行为逐条保留并用 Playwright DOM 断言验证）：`DetailGallery`（灯箱 / 键盘导航 /
焦点陷阱 / Esc / 焦点归还 / 视频延迟挂载 / 失败态 / 分类 Tab / URL 校验）、`LocationPanel` +
`AmapMapCanvas`（两列网格 + 自建 DOM 图钉）、`BuildingSupplyBrowser`（内存态分桶 → URL 驱动）、
`HeroSummaryPanel`（切 `DetailPanel side` + `SpecTable`）。

**编排层**：`CityListingDetailView` 与 `BuildingDetailLayout` 双双退化为「顺序 + 容器 + 数据分发」，
两页共用 `.dt-page` 骨架。

**域层小改**：`ListingCardViewModel` 补 `floor` / `seats` 映射；`FactValue` 增可选
`magnitude` / `unit`（`value` 语义不动）；`parseBuildingSupplySearchParams` 增 `priceMin` / `priceMax`；
新增 `buildBuildingSupplyCanonicalSearchParams`；`isImmediatelyAvailable` 收敛为
`availableBefore` 谓词的唯一实现。

**新增单测**：`tests/listing-overview-panel.test.ts`、`tests/building-spec-panel.test.ts`、
`tests/building-no-media-fallback.test.ts`。

### 7.2 顺手修掉的既有缺陷（非本批引入，判据见 §7.4）

| 缺陷 | 修法 |
|---|---|
| **SSR `<img>` 在 hydration 之前加载失败时兜底从不出现**（`error` 事件不冒泡，React 不补发 hydration 前错过的 load/error；窗口实测生产构建 0.6–0.9s）。商户图 404 时用户看到浏览器破图框——**master 上一直存在的真实生产缺陷** | 两处 SSR `<img>` 加 ref 回调，挂载时补判 `complete && naturalWidth === 0` → `markFailed` |
| `.sf-scrim` / 计数 pill 是主图按钮的**同级**绝对定位层，无 `pointer-events:none`，吞掉底部 45% 的点击、灯箱打不开 | 加在共享基元 `.sf-scrim` 上（装饰层本就不该拦点击），并实测首页/列表页卡片点击仍穿透 |
| 竣工时间直接渲染原始 ISO 字符串（生产今天就是这样） | `formatCompletionYear`，两处共用 |
| `.hero-summary__price`（全页最大的数字）缺 `tabular-nums`，且是 58 式 `--fs-32/700` | 对齐决策卡 40/600/1.06 + tabular-nums |
| `BuildingDetailLayout` 外层 section 与 `LocationPanel` 自身 section **重复 `id="location"`**（无效 HTML，旧 e2e 靠 `.first()` 侥幸通过） | 去掉外层重复的一份 |
| `LocationPanel` 的 h2「周边与交通」被旧包装层 `display:none`——该区段一直没有可见标题 | 恢复 |
| `mapEnabled=false` 时地图区塌陷导致清单错位 | 改两列网格 |
| 地图图钉字母与清单字母**切换分类后指向不同地点**（旧版交通类恒画全量 subway+bus） | 图钉改由 `[pois, state, highlightedPoiId]` 单一 effect 重建，`activePois` 与清单同源 |
| `estimateMonthlyTotal` 对联合办公按工位计价时误用面积折算 | 改名 `estimateRowTotal` 并按 `seats` 计算 |
| 「可即刻入驻」聚合计数走 `Date.parse` 数值比较、pill 过滤走字符串比较 → 恰好当天可入驻的房源计入 N 却被 pill 滤掉 | 收敛为 `isImmediatelyAvailable` 一处实现 |
| `.dt-spec__label` 极窄容器下 CJK 逐字换行（"地址" 拆成两行） | `flex-shrink: 0` 加固共享基元 |
| `AdvisorCard` 在 279px 窄栏正文被挤成竖排 | `flex-wrap: wrap` 提升为组件默认行为 |
| **Chromium 真实 bug**：`table-layout:fixed` + 显式 `min-width/width` 大于可用空间的 `<table>`，intrinsic size 会**绕过 `overflow:auto/hidden` 祖先**直接顶宽 `documentElement.scrollWidth`（改 `overflow-x:hidden` 都拦不住），768 断点密度表整页横向溢出 180px | 定宽列换算成百分比，表格自身不设任何显式 `min-width/width` |
| `.dt-keyspecs` 用 `repeat(3, 1fr)`（隐含 `min-content` 下限）把 375 的列压成 35/79/107px，"2026年9月1日" 排成四行 | 换 `minmax(0,1fr)`，≤767 改 2 列 |

### 7.3 实施期被推翻的计划假设（**下游勿再引用 §0–§4 的旧说法**）

1. **§1「图上渐变 `.46/38%`」→ 不采用，直接复用 `.sf-scrim`（`.42/45%`）**，未新增修饰类。
   差异落在渐变最浅端不可辨；主图更大不构成功能性理由。
2. **§2.1「吸附询价条 sticky top 44」→ 实现是 `position: fixed`。** Playwright 实测：sticky 在挂载
   瞬间会在原位吃掉 56px 把下方内容顶下去，靠 Chromium scroll anchoring 补偿才勉强不出错。
   该条从不展示「未吸附」态，fixed 视觉等价且零布局影响。
   **注意这条理由不适用于楼盘页 `.dt-anchor-bar`**——它常驻、首帧就占位，用的是字面 sticky。
3. **§3.3「设计稿列出的参数全部对应 `Buildings` 已有字段」→ 不成立。** 逐条核过 24 项：17 项第 1 层已在手，
   1 项第 2 层换项（地上/地下 → 总楼层，域层无拆分字段），**7 项域层确实没有**并已省略
   （电梯速度 / 楼板承重 / 车位配比 / 空调加时费 / 出租率 / 主要租户行业 / 楼盘级最短租期）。
4. **§3.3「LEED」→ 改为「认证」，展示实际持有的全部公开认证。** 域层没有「结构化认证体系」字段；
   照字面做只能按名称正则去猜，猜不中时显示 `—` = 替这栋楼**否认了它其实拥有的认证**。
   正确处置不是「加防护让匹配更鲁棒」（名称变体永远列不完），而是改成展示真实拥有的东西。
5. **§3.2 移动端不采用 comp 的「无图两行卡」**，保留既有 `ListingCard` 卡片渲染
   （e2e「窄屏楼盘供给始终使用卡片」锁定的真实行为，且两行卡是未经验证的新设计）。
6. **§2.2 无图替代构图不是房源页专属**：本地 `buildings_media_items` 与 `buildings_gallery`
   **都是 0 行，七个楼盘全都没有媒体**——无图不是降级路径，**它就是楼盘详情页的主路径**。
   Task 10b 复用同一个 `NoImageHeroGrid` + 一处 `meta` 参数化（有图路径 HTML diff 0 行）。
   宫格在 ≤767 是 **2 列、值 24px**（桌面 3 列、值 32/600）。
7. **§0「决策卡 sticky top 116」的 116 不写字面量**：实现是
   `calc(var(--header-height) + var(--dt-sticky-bar-h) + 16px)`，两个高度任一改动自动跟随。
   `--dt-sticky-bar-h` 挂 `:root` 而非 `.dt-page`（`.dt-bar` / `.dt-anchor-target` 的使用范围不限于该子树）。
8. **§4「高基数链接 `prefetch={false}`」在 Task 10 报告里曾被标记「本次未满足」**，
   由 Task 11b–11e 补完并**精确化了判据本身**（见 §8.5）。
9. **`DetailSideRail` 从四张卡收敛为一张留资带**：`test0814` 上同一楼盘一页出现**三次**
   （侧栏热门楼盘 / 周边楼盘条带 / 同商圈楼盘），且 `AdvisorCard` 同页出现两次、迷你摘要与 hero
   共用 `findLowestPrice`。只保留「登记需求，顾问回电」，网格整个取消、单卡横贯。
10. **「供给三组全空 → 不渲染供给区」是错的裁定，已撤回。** `detail-pages.spec.ts` 锁着
    「当前暂无公开可选空间」+ 登记找房需求 CTA。「空态整段不渲染」针对的是**空货架**
    （有标题、底下什么都没有），不是删掉一个提供下一步动作的诚实空态。
11. **楼盘详情不加 `robots noindex`**：楼盘详情页 canonical 已指向无 query 的 URL，
    给带 query 的变体加 noindex 恰是会**向 canonical 目标传播**的配置。
    （列表页的 noindex 由薄内容判据 `shouldIndexSaleChannel` 驱动，与「有没有 query」无关。）
12. **密度表不能与 372 侧栏共存**：comp 供给行网格合计 1116 = 容器 1180 − 面板 padding 32×2；
    再切走 300–372 右栏只剩 79–103px 列宽，「2800 元/工位/月」拦腰折行。
    「1180 容器」与「右侧栏」不可兼得，取前者 → 侧栏改成表下的通栏卡片带（组件一行未动，
    只失去 `position: sticky` 这个在横向卡片带里本就无意义的属性）。

### 7.4 「既有缺陷」是否在本任务内修的判据

判据不是「谁引入的」，而是两条**任一成立即修**：

1. **它是主动误导还是仅仅遗漏？** 图钉字母与清单字母指向不同地点且无提示，属前者。
   与「越界页码不许说没有结果」「缺失不许当 0」「规格表缺失显示 `—` 不隐藏行」同一条线——
   **显示一个错的比不显示更糟**。
2. **它是否正好拆掉本任务自身的目的？** 本任务产出就是让图钉与清单对应，一次交互即失效的保证等于没有。

### 7.5 门禁

`pnpm typecheck` 0 错误；`pnpm test` **3444 passed / 4 skipped**（基线 3373，新增 71）；
`pnpm lint` **0 error / 22 warning**（基线 24，不升反降）；`pnpm build` exit 0。
`tests/e2e/detail-pages.spec.ts` 在 CI 等价环境 **29 passed / 0 failed**；
全量 e2e 138 passed / 14 skipped。四断点（375 / 768 / 1440 / 1920）逐屏截图人工确认。

---

## 8. 本批的**有意变更**（防「恢复」清单）

以下都是逐条核过并有意为之的，**不是漏做的 bug，不要「修回去」**。要改先读理由。

### 8.1 房源详情页「配套设施」段整体删除

comp 用「周边与交通」取代了原配套设施段，specRows 的页面顺序里也没有它。逐条核过移除代价：

- `listing.amenityGroups` 恒等于 `[{ id:'highlights', items: card.highlights }]`（`mappers.ts`），
  而 `highlights` 契约上「最多三项」且标题栏已全部展示——旧代码从标题栏三项起手的去重本就把它**整组滤空**。
- 真正会消失的是**楼盘级**配套（旧代码从 `buildingDetail.amenityGroups` 取）。
  **那份数据仍在楼盘详情页「楼盘参数 · 楼盘特色」原样存在**，本页「所在楼盘」卡片直接链过去。
- 因为不再需要楼盘详情文档，`buildingDetail` prop 与两条房源详情路由里的 `getCachedBuildingBySlug`
  取数一并摘除（少一次详情页查询）。

### 8.2 `DetailFacts` → `ListingOverviewPanel`

概况面板是按 comp factGroups **逐字段核过可达性的固定行清单**，不是「把 factGroups 全倒出来」。
不在清单里的事实（楼层 / 朝向 / 家具 / 可分割…… 这类 mapper 产出但 comp 未列的行）
**在房源详情页不再出现**——这是设计取舍。`DetailFacts.tsx` 组件本身没删（见 §9.4）。

配套的两处诚实降级（组件头注释已区分「域层没有」与「DTO 没映射」两类，防后来者「恢复」）：
「押付方式」→「押金月数」+「付款方式」两行并列（`depositMonths` 是数字、`paymentTerms` 是自由文本，
两字段形态不支持可靠拼接成「押二付三」，硬拼在数据不规整时会出乱码）；「税费」→ 沿用既有「发票」
（`invoiceStatus` 不是税率数据）。

### 8.3 供给区出售组「状态」列改为「装修」

域层**没有产权/租约状态字段**，且 `availableFrom` 对出售房源恒为 `null`——硬用会让「可即刻」徽标
对所有出售房源撒谎。**列名跟着内容一起改**（Task 6 把「LEED 认证」行改成「认证」是同一处置的先例）。
租赁 / 联合办公组仍按 `availableFrom` 显示「可即刻」或具体日期。

### 8.4 价格分桶是**迁移不是删除**

价格分桶一度被当成「域层无此维度」删掉——那是**功能回归**，且理由在三层判定第 1 层就不成立
（`price.amount` / `displayUnit` 一直在 DTO 里，被删的代码本身就是证据）。已按 `areaMin/areaMax` 同构接入：
`priceMin` / `priceMax` 进 URL，单位闸门下沉到域层比较处。

> **写死的一条：三种租金单位（元/月 · 元/㎡/天 · 元/工位/月）不可通约，绝不允许跨单位比价。**
> `parseBuildingSupplySearchParams` 缺 `priceUnit` 时把价格区间**整段丢弃**（URL 卫生），
> 域层 `matchesInput` 另有守卫（那才是失效点上的守卫）：只有「有价格且单位正好等于 `priceUnit`」的房源参与比较。
> 两处不是重复，是「URL 不带注定不生效的参数」与「即便带了也不生效」两件事。

分桶取**闭区间**（与 `areaMin/areaMax` 同构），不保留旧的半开区间：代价有界——桶是单选 pill，
页面无任何处把各桶计数加总，边界值同属两桶不产生自相矛盾的数字；改半开则域层范围参数的语义
对用户可见区间是错的，加 epsilon 更糟。空桶隐藏判据是「与**未过滤**的 `priceRanges` 判交集」，
不是「按已过滤 listings 计数」——后者会得到「筛完之后其它桶消失」的口径分叉。

### 8.5 `prefetch={false}` 的判据已精确化，判据锚点在 `ui/Breadcrumb.tsx`

三条件**并列**：①高基数 ②内容驱动 ③常驻渲染，缺一条就不关。

> **判据①问的是「这一页渲染出几条互不相同的 URL」，不是「同一批 URL 在这一页出现几次」。**
> Next 的路由缓存**按 URL 去重**——同一个 URL 被 N 个组件各渲染一次也只产生 1 次预取。
> 数①的正确姿势：**先把 href 去重，再看去重后的条数。**

本批实测落地：`/listings` 10→0、`/buildings` 7→0、`/news` 5→0、`/news/<slug>` 11→0（保留 query 未归一）。
两条**反向**的裁定，都不要「统一」掉：

- **`Breadcrumb` 保持默认预取**（曾被我一刀切要求关掉，已采纳反对并回退）：它在条件①就不成立
  ——全站只产出 2–3 个链接、按 URL 去重后成本不随页面数增长，而「退回列表页」是最高频导航。
  实测楼盘详情页回退后预取路径数**差量为 0**（那两个 URL 本就被 `SiteNav` 预取）。
- **`SiteFooter` 同理不关**：`FOOTER_COLUMNS` 是硬编码 `as const`、**恒 8 条**，全站同一批 URL，
  整站成本是一次性的 8 条。「低基数但全站常驻 + 指向昂贵路由」这条补充条款**已收回**——
  它把「出现次数」偷偷当成了成本，正是判据①要防的那个错。

凡是「为何不适用」的理由涉及去重的组件，**一律回指 `ui/Breadcrumb.tsx`，不要各写一份措辞**。

---

## 9. 遗留（**未修，如实记录**，交给下一批 / 已另开任务）

### 9.1 已另开后台任务

| 项 | 说明 |
|---|---|
| **列表页搜索侧价格单位闸门缺失** | `domain/public-catalog/supply-adapter.ts` 在 `input.priceMin/priceMax` 存在时**无条件**下推 `where.rent`，与 `input.priceUnit` 是否存在无关。与 §8.4 的 building-supply 侧是两条独立链路，边界不重叠 |
| **`CorrectionModal` 触发按钮在页面加载后自动获得焦点** | `document.activeElement` 就是「信息纠错」按钮（截图里那圈 focus ring）。先于本批存在，**房源页与楼盘页都复现** |

### 9.2 `prefetch` 线程的剩余漏网（判据②③成立、①待实测）

- **`SiteNav.tsx:320`**（移动抽屉 `trustedCities.map` → `citySwitchHref`）与
  **`CitySwitcher.tsx:184`**（桌面切换器，`listPublicCityOptions` 无 limit、七城白名单）。
  **不可照 `SiteFooter` 的结论直接放过**：页脚是硬编码恒 8 条（①不成立），这两处由 `trustedCities` 驱动、
  href 还带当前 pathname——**去重后的条数必须实测，不能推**。同文件 `SiteNav.tsx:188` / `:300`
  已对 `MAIN_NAV_ITEMS` 应用 `/listings` 规则，`:320` 是被那次漏掉的。
- 优先级更低：`listing/EmptyFiltered.tsx:90`（1–5 条，仅空态渲染）、
  `listing/ExcludedUnitsBar.tsx:62`（最多 2 条）。11c/11d 两轮均判不加。

### 9.3 原生 `<a>` 零预取但缺判据注释——**别顺手统一成 `<Link>`**

- **`BuildingSupplyBrowser.tsx:606`**（桌面供给表格每行的箭头，`/listings/<slug>`）**尤其危险**：
  同一个文件里另外 5 个 `<Link>` 都关了预取，形态上极易被「顺手统一」，那会凭空多出一批 `/listings/<slug>` 预取。
- `home/HomeHero.tsx:50`（`/listings?district=<slug>`，`districts.slice(0, 4)` 恒 4）。
- （`building-detail/NearbyBuildingsStrip.tsx` 已有判据注释，不在此列。）

### 9.4 死代码未删

- `components/frontend/AmenityList.tsx`：**全仓零引用**（连测试都没有）。
- `components/frontend/DetailFacts.tsx`：**生产零引用**，只剩 `tests/detail-components-contract.test.ts` 在导入。
- 两者都够格删，Task 11 的清理只做了 `styles.css`（−215 行），未动组件文件。

### 9.5 行为与展示口径

- **legacy `/buildings/<slug>` 重定向丢弃 query string**（`redirect()` 只拼 citySlug + slug）。
  组件链接不经过它，影响面是手改 URL / 外部带 query 的旧链接。
- **`AnchorNavBar` 的到底兜底只补最后一个区块**：末尾连着两个都够不到自己落点的短区块时，
  倒数第二个**永不高亮**——主规则要求「到达落点」，兜底只认「最后一个」，中间那个两头不靠。
  未修的理由写在组件注释里：任何修法都要引入第二套「区块占了视口多少」的度量，
  会让择一规则从「一条几何序」变成「两条互相打架的启发式」。
- **`SpecTable` 的空字符串**：`row.value ?? '—'` 对 `''` 渲染空白而非 `—`（调用方控数据，未设防）。
- **`总建筑面积` 无千分位**：`mappers.ts` 的 `fact('总建筑面积', scale.grossFloorArea, { suffix: ' ㎡' })`
  产出 `42000 ㎡` 而非 comp 的 `108,000 ㎡`。属 mapper 层展示口径，跨两个页面。
- **`StickyInquiryBar.tsx` 文件头注释已过时**：写「只在桌面宽度渲染（`@media (max-width:1023px)`
  直接 `display:none`）」，而 Task 9 已把隐藏断点收窄到 **≤767**（`detail.css` 为准）。
  **纯注释不实，行为正确**，本批文档任务不改代码故未动。

### 9.6 P0：`/news` 系列的 E2E 证据链缺口（有先后依赖，顺序不能反）

- `tests/e2e/` 对 `/news` 的断言**只有一条状态码**（`multi-city-routing.spec.ts`），
  `/news/<slug>` **一条 E2E 断言都没有**。11d/11e 两次改动该系列的渲染证据 100% 靠 HTML 逐字节比对。
- **补测试之前必须先补种子**：`scripts/seed-articles.ts` 种的 5 篇文章一条
  `relatedBuildings` / `relatedDistricts` 都没有，`articles_rels` **整张表是空的**——
  「相关推荐」区块在本地与 CI 都渲染不出来，压根没法断言。
- 建议：① 给 `seed-articles.ts` 补 1–2 篇带关系的文章；② 补 `news.spec.ts`（列表卡片数、详情页正文、
  相关推荐两组链接的 href）。**②依赖①。**

### 9.7 环境类，非产品缺陷（记下来免得下一轮重查）

- **`/dev-story/opt037` 在 `next start` 下恒 404**（`page.tsx` 显式 `notFound()`）。
  任何拿它做截图对比的验证都是空结论——本批已因此产生过一次假的「四档 0 差异像素」。
- 跑本地 e2e 必须显式 `MULTI_CITY_ROUTING_ENABLED=false`：工作树 `.env.local` 设成 `true` 时
  `next start` 读得到而 Playwright 进程读不到，**这个错配本身**就会让所有权那条用例 307-vs-200 失败。
- 完整的 CI 等价 e2e 环境与「房源全红 / 楼盘全绿」症状归因，已写进 `.agent/testing.md`。
