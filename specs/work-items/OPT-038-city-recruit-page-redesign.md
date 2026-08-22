# Task Packet：OPT-038 城市招募页 Apple 中性极简改版

> 状态：**设计已定，待实施**
> 创建日期：2026-08-22
> 分支：`feat/opt-038-city-recruit-page-7a3e`（叠在 `feat/opt-037-detail-pages-redesign-3d9b` 之上）
> 设计依据：`docs/SBH设计任务讨论/城市招募页.dc.html`（**该目录不入库**，需向仓库所有者索取）
> 前置：OPT-035 首页（token 层、`.sf-*` 基元）、OPT-036 列表页、OPT-037 详情页（`.dt-panel`、sticky 交接经验）

全量改版共 6 个页面族，本工作项是最后一个。

## 0. 设计决策

| 决策点 | 结论 |
|---|---|
| 中段方案 | **方案 A · 左右两栏 + sticky 表单卡**（方案 B 纵向叙事不采用） |
| 内容容器 | **1024px**（不拉到 1180——稿子的「正文栏宽上限 702」是行长约束，且 552+400+72=1024 是推导值） |
| 两栏 | 主栏 **552** + 列间 **72** + 表单卡 **400** |
| 表单卡 | 400 宽 · padding 40 · radius 18 · **`sticky top 68`**（详情页决策卡是 116，因为那边多一条 56 吸附条；**本页无吸附条，差异要写进注释**） |

**方案 A 的选择理由**（写进代码注释，防止后来者"改回稿子的另一半"）：本页唯一目标是留资转化，
sticky 表单让用户读完价值点时表单就在手边；方案 B 的表单在价值点之后、需滚动才可见。
且本页只有 3 条一句话价值点，撑不起 B 的纵向叙事排版。

## 1. 现状（踩点结论，详见 `.superpowers/sdd/opt-038-scouting-notes.md`）

`/city-partner` 现在只有**一段文案 + 一个 461 行表单**。
**设计稿的 Hero / 价值点 / 商圈布局 / 次要入口四段一个都不存在**——本工作项主要是「补齐四段 + 改造表单外观」。

- 表单组件 `city-partner/CityPartnerApplicationForm.tsx`（461 行）被 `ComingSoonCityView.tsx:145` **共用**，
  而后者挂在 4 条城市路由上——**改它会外溢，必须逐条核触发条件**。
- `landing/` 下 8 个组件**本页一个都没用**（归 `/entrust`、`/publish`、`SiteNav`），不要误改。

## 2. 表单链路契约（**最不能碰坏的部分**）

后端主端点 key 白名单（`api/city-partner-applications/request-guards.ts:103-106`）：
`requestId · city · applicantName · contactPhone · applicantIdentity · otherIdentity · consent · source`
——**严格白名单，请求体多一个字段直接 422**。

- **稿子的表单卡字段与该白名单逐字对应**，不存在字段丢失。
- 「第二步 · **可选**」走另一个端点 `/city-partner-applications/details`，是**提交成功后的补充**，
  不与 sticky 卡争空间。改版不得把它变成必填、不得并进第一步。
- 前后端两份校验**没有漂移**，`tests/city-partner-form.test.ts:222-260` 有上限对拍——**保持这个对拍**。
- 限流 3 次/分/IP（failOpen），守卫含严格 JSON media type、同源校验（**已知缺陷 OPT-028：钉死站点域名**）。
- **本页目前零 `data-analytics-*`、零 `sourceSection`、无页面曝光事件**，只有 3 个 `track()`。

## 3. 分段要求

### 3.1 Hero（新建）
标题 56/600/1.07/normal；副标 21/400/1.38/**+0.011em**（全站唯一允许非 normal 字距的档位）。
眉标 pill 零色相。

**「第 8 城」这类序数不得硬编码**——能从城市列表推导就推导，推不出就去掉。
（本批最大教训是「数字撒谎」；一个写死的序数迟早变成假话。）

### 3.2 价值点 + 表单卡（方案 A）
主栏 552：3 条价值点，序号 `tabular-nums`，条间 hairline。
表单卡 400 sticky top 68。输入框高 44 · padding 0/14 · radius 8 · 1px `--line-strong`；
focus 为 accent 边框 + `0 0 0 4px rgba(0,113,227,.18)`；主 CTA pill 高 44 · 17px · accent 底。
隐私说明 12/400/1.33/`--ink-3`。

### 3.3 商圈布局
3 列 · gap 48/24 → 列宽 325.33；商圈名 24/600、区位 17/400 `--ink-2`。

**⚠️ 「首批上线 / 筹备中」状态标签本批不做。** 三层判定走到第③层：
`Locations.status` 是 active/disabled，`CITY_SERVICE_STATUSES` 是城市级，**整条链路没有这个维度**。
挑前三个标成「首批」= 编造。六个商圈统一渲染。
**同步必须改掉上方那句「首批三个商圈开放独家席位，其余为筹备中」**——
否则文案承诺了界面不做的区分（本批 Task 6「认证」行是同型先例）。

区位副标是**层②缺映射**：`Locations.parent` / `.description` 存在，
`mapFeaturedRegions`（`city-context.ts:97-124`）没映射 → **补映射，不是绕开**。

### 3.4 次要入口
「您是需要在杭州寻租办公室的企业？」+ 次级按钮（pill · padding 11/21 · 1px `--line-strong`）。

### 3.5 文案落点（两个消费面）
同一套组件，文案由数据驱动：
- **城市路由**（`ComingSoonCityView`，未开通城市）→ 城市专属语气「即将登陆{城市}」+ 该城 `featuredRegions`
- **`/city-partner`**（全局，canonical 无 query，默认城市是**已开通的上海**）→ 中性文案 + 表单内城市选择器

### 3.6 移动
section padding 72 · 左右 16。两栏塌单栏，表单卡取消 sticky。

## 4. 硬约束（继承前三批）

- 数字一律 `tabular-nums`；缺失显示 `—`，**不显示 0**
- 空态整段不渲染；但**诚实空态（带下一步动作的）必须渲染**——不要搞反（OPT-037 栽过）
- 中文 `letter-spacing: normal`（唯一例外：21px 副标 +0.011em）；只用 token；标签零色相
- `aria-current` 用于当前态，`aria-pressed` 只在 `role="button"` 下
- Server Component 默认；组件只消费 DTO，不调用 Payload
- **同一判断逻辑不得存在多处**——需要复用先收敛再用（前三批共栽 8 次）
- 守卫要落在失效点，且 fixture 必须域层可达
- 清理一律逐类名/逐符号核查，禁止按标题边界整块删

## 5. 测试雷区（**改版必踩，计划阶段就要绕开**）

1. **新样式必须放 `styles/recruit.css`，不得追加到 `styles.css` 末尾。**
   `tests/coming-soon-city-view.test.ts:25,50-55` 把 `styles.css` 从 `.city-coming-soon`（:5171）
   切到**文件末尾**做内容断言，禁止出现 `var(--ink)/var(--line)/var(--paper)`——追加即红。
2. `tests/city-partner-page-seo.test.ts:37-38` 锁死 **h1 恰好 1 个且含「城市合作伙伴申请」**，改 hero 文案即红。
3. e2e `city-partner-flow.spec.ts` 用 label/按钮文案定位，且 `getByRole('status')` **当前唯一**——
   新增任何 live region 会触发 strict violation。

**`pnpm test` 不含 E2E**：改了 class / role / aria / DOM 结构**必须本地实跑 e2e**
（前一批两次「本地三闸门全绿、e2e 却红」，其中一次潜伏 6 个任务）。

## 5.5 实施中查出的两个高危陷阱（Task 1/2 实测，务必写进 `.agent/`）

1. **稿子与本项目的 token 名义相同、取值相反**：稿子 `--bg`=白 / `--bg-subtle`=灰，
   本项目**正好反过来**。照抄 token 名会让每条背景带黑白颠倒，**且因名字一模一样，
   code review 用肉眼扫不出来**。规则：**按颜色映射，不按名字映射。**
   （另：`--radius-pill` 999px 与 `--r-pill` 980px 是两个 token，别混。）
2. **改视口必须 reload 再测量**：只 `resize_window` 不刷新，`100vw` 出血层保持旧视口宽，
   会读出「375 视口 / section 宽 1440 / scrollWidth 908」整套假数——
   Task 2 第一次量 375 差点当成 533px 的真溢出 bug。

## 6. 验收

- `pnpm typecheck` + `pnpm test` + `pnpm lint` 无新增（lint 基线 22 warnings）
- e2e `city-partner-flow.spec.ts` + `coming-soon-city-view` 相关全绿
- 四断点（375 / 768 / 1440 / 1920）逐屏截图**自读**
- 状态走查：无 `featuredRegions` 的城市、已开通城市、超长城市名、表单三态（校验失败 / 提交成功 / 限流）
- sticky 实测：表单卡粘附区间正确、移动端取消 sticky
- 页面级横向溢出四断点为 0
- 证据存 `artifacts/verification/OPT-038/`，**验证脚本随证据提交**，
  且脚本必须**真读 HTTP 状态码**（前一批出过「两侧都是 404 页比出 DOM 完全一致」）

## 7. 遗留（不假装做完）

1. **商圈「首批上线 / 筹备中」状态**：需在 `Locations` 或城市 profile 上新增一个招募位状态字段
   （建议枚举 `first-batch` / `preparing`），含迁移 + 后台可填 + mapper 映射。本批不做。
2. `ComingSoonCityView` 的 `cities` prop 在 **4 个调用点全都没传**，导致城市下拉恒为单选项——
   先于本批存在，本批不改（改动会外溢到 4 条路由），另开工作项。
3. 同源校验钉死站点域名（OPT-028 已知缺陷），未处理。
4. 本页零埋点（无页面曝光事件）——若要补，需与 `DetailClickAnalytics` 的事件命名口径对齐，本批不做。
5. **「第 N 城」序数**：Task 2 三层判定走到第③层后去掉。`CitySiteProfiles` 只有二值
   `serviceStatus` 与允许并列的 `sortOrder`，**「第几城」维度不存在**；生产种子是
   1 座 live + 6 座 coming-soon，硬算「已开通数+1」会让六座城市的招募页都自称「第 2 城」。
   若产品要这个序数，需在城市 profile 上新增一个显式的开通序位字段（含迁移与后台可填）。
6. **移动端 Hero 标题 40px 取自首页既有断点**（`home.css:143-145` 的 56→40），
   **不是稿子权威**——specRows 未给移动标题字号。属跨页一致性决定，已显式确认。
