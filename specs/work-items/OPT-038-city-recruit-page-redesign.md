# Task Packet：OPT-038 城市招募页 Apple 中性极简改版

> 状态：**已实施（Task 1–6 全部完成，2026-08-22）**
> 创建日期：2026-08-22
> 分支：`feat/opt-038-city-recruit-page-7a3e`（叠在 `feat/opt-037-detail-pages-redesign-3d9b` 之上）
> 设计依据：`docs/SBH设计任务讨论/城市招募页.dc.html`
> ⚠️ **该目录是未跟踪目录、用户已决定不入库，设计稿存放在仓库外**——本文件与代码注释里
> 凡引用 `.dc.html` 行号的地方，在克隆出来的仓库里都**找不到文件**，不是路径写错，需向仓库所有者索取。
> 同理，本批的踩点笔记与 Task 1–6 报告写在 `.superpowers/`（被 `.gitignore` 忽略），**合并后不存在**；
> 仍在生效的结论已提炼进本文件、`.agent/frontend.md` / `.agent/testing.md` 与代码注释。
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
`mapFeaturedRegions` 没映射 → **补映射，不是绕开**。
⚠️ **本节原先给的路径是错的**：本工作项与实施计划都写「`domain/public-catalog/city-context.ts:97-124`」，
而 `src/domain/public-catalog/` 下**根本没有 `city-context.ts`**。全仓唯一一份 `mapFeaturedRegions` 在
`src/app/(frontend)/_lib/city-context.ts`（Task 4 补映射后落在 `:146`）。**以源码为准。**

### 3.4 次要入口
「您是需要在杭州寻租办公室的企业？」+ 次级按钮（pill · padding 11/21 · 1px `--line-strong`）。

### 3.5 文案落点（两个消费面）
同一套组件，文案由数据驱动：
- **城市路由**（`ComingSoonCityView`，未开通城市）→ 城市专属语气「即将登陆{城市}」+ 该城 `featuredRegions`
- **`/city-partner`**（全局，canonical 无 query，默认城市是**已开通的上海**）→ 中性文案 + 表单内城市选择器

### 3.5.1 sticky 的实际生效条件（Task 3 实测）

只有 3 条价值点时，1440 下**表单卡（735）高于左栏（533）**，可移动余量为负 ⇒ **sticky 不粘附**。
**这不是 bug，是 sticky 的定义**——左栏比卡短时，表单本来就全程在视线里，方案 A 的目标已达成。
**裁定：不得为了「让 sticky 生效」而编造左栏内容。** Task 5 四断点自读时评估这段留白是否读起来失衡；
若失衡，修法是纵向对齐/间距，**不是加内容**。

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
3. **pane 不合成帧时（`visibilityState === 'hidden'`）CSS transition 冻结在起始值**，
   `getComputedStyle` 读 focus / hover 这类过渡态会读出**基态假象**——
   Task 3 差点据此去改选择器特异度。测量过渡态前先置 `transition: none`。
4. **在窄作用域覆写基态会静默打断既有状态链**：`.rc-page .city-partner-form input` 是 (0,3,0)，
   而 `styles.css` 的 `:hover` 是 (0,2,0)、`--invalid` 是 (0,1,0) ——
   覆写基态后这两个状态**静默失效**。凡在新作用域覆写基态，必须**同作用域重述整条状态链**。
   ★ **第三种形态（Task 5 实测，最阴险的一种）：同一属性的简写会连坐它的其余长写。**
   Task 3 用 `background: var(--bg-subtle)` 覆写 select 基态，把 `.filter-bar__select`
   的下拉三角（`styles.css:992` 的一张 `background-image`）一并复位成 `none`，
   select 在真实路由上和单行输入框长得一模一样；而 Task 3 报告写的是「保留了既有三角，只挪了位置」。
   前两种形态要交互才看得见，**这一种不需要任何交互就一直摆在屏上**，
   只是没人对着截图逐个控件对账，于是潜伏了一整个任务。改法：写 `background-color` 不写 `background`。
5. **全站 `scroll-behavior: smooth` 会把 `window.scrollTo` 变成动画**——只等两帧就读位置会得到
   「请求 2400、实际 235」，整段 sticky 采样作废。测滚动前先置 `auto`。
6. **`unstable_cache` 的条目落在 `.next/cache`，换一个 server 进程也还在。** 临时写库后新起 server，
   第一次请求仍拿到旧数据。判据：**同一份数据在两个断点上结论不同 ⇒ 先怀疑缓存的第一拍，不要怀疑断点**
   （section 渲不渲染是服务端决定的、与视口无关）。
7. **「还原成观察到的原值」的临时写库探针必须先断言干净起点**，否则会把上一轮的残留当成原值写回去、一路级联。

以上七条已在 Task 6 回写进 `.agent/frontend.md`（1、4）与 `.agent/testing.md`（2、3、5、6、7）。

## 6. 验收（Task 6 收尾时的实测结果）

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test` | 见 Task 6 报告（基线 245 files / 3448 tests） |
| `pnpm lint` | 22 warnings / 0 errors，与基线持平 |
| `pnpm build` | 成功 |
| E2E 本地实跑 | 见 Task 6 报告（Task 5 基线 141 passed / 14 skipped / 0 failed） |
| 四断点 × 两个消费面横向溢出 | 全部 0 |
| 清理前后四断点截图 | **逐像素 0 差异**（`task6-shot-diff.json`），页高也逐档相同 |

原始验收清单：


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
7. **两处命名瑕疵未修**（Task 3 点名，Task 6 确认保留）：
   `.dt-panel` 是跨页共享的白面板表面却住在 `dt-` 命名空间（现有 4 支消费方）；
   `.hm-h2` 是事实上的「全站 section 标题」基元却住在 `home.css` 带 `hm-` 前缀
   （首页 7 处 + 招募页 2 处）。正解都是提升到 `styles/surface.css` 并改名，
   但要动已上线首页 / 详情页的渲染路径——属设计系统层面的一次性重构，不塞进改版批次。
8. **`surface.css` 文件头仍把依据指向 `.superpowers/sdd/cross-batch-design-decisions.md`**，
   而该目录被 `.gitignore` 忽略、合并后不存在。`.agent/frontend.md` 那一处同型引用已在
   Task 6 改指仓库内事实源；`surface.css` 的注释属产品代码，文档任务未顺手改，另记于此。
9. **`recruit.css` 文件头的「复用清单」列了 `.sf-scrim` / `.sf-phototag`**，
   而本页整页零图、这两个基元在 OPT-038 里零消费方（Task 1 §4.2 已预警）。
   注释不影响渲染，Task 6 未改；下次动该文件时顺手删掉这两项，别据此「为了复用而造一个用得上它的位置」。

## 8. 有意变更（改版本身带来的、不是回归）

1. **`/city-partner` 的外层从 `<main class="city-partner-page">` 改成 `<div class="rc-page">`**：
   layout 已有 `<main id="main-content">`，旧结构是两层 main 嵌套。零测试引用旧类名。
2. **城市路由的 hero 兜底文案变了**（对齐稿子）；三个 CMS 覆写（`profile.hero.eyebrow/heading/body`）
   的**判断式逐字未改**，触发条件未变。
3. **删掉 3 张赋能卡的旧结构**，正文收敛到共用常量 `RECRUIT_VALUE_POINTS`（城市名插值消失）——
   同一段市场承诺不再有第二个事实源。
4. **删掉 `DEFAULT_DISTRICTS` 与「首批上线 / 筹备中 / 规划服务区」**：`featuredRegions` 为空的城市
   现在整段不渲染，而不是掉回一份编造的清单。**空货架好过假货架。**
5. **删掉「平台实力背书数据」四个写死的字面量**（30,000+ / 1,500+ / 98.5% / 12 城）。
   零取数，且「12 城」与实际 7 座城市 profile 直接矛盾。与去掉「第 8 城」「首批三个」是同一条纪律。
6. **`/city-partner` 的 `InquiryModal` 用 `pageType='content'`，城市路由那两处保持 `'home'`**——
   两处不一致是刻意的，改它会改动已有线索的归因口径。
7. **`CITY_PARTNER_COPY.note` 合规声明扩散到了城市路由**（原先只在 `/city-partner`），
   位置从 hero 文案块挪到表单卡正下方。
8. **稿子的移动字阶一条都没取**（商圈名 19 / 区位 14 / 格内 gap 6 / 引导语 17…），
   只取「三列塌单列」「次要入口卡塌纵向 + padding 24」这类**宽度逼出来的布局变更**。
   Task 4 曾建议 Task 5 或 Task 6 显式裁一次——**Task 6 裁定：维持现状，一条都不取。**
   理由是跨段一致性：`.rc-vp__name` 与 `.rc-hero__lead` 至今无移动档，只降商圈那一段会让
   同一页出现两套移动字阶（375 下引导语 17、Hero 副标 21）。要取就整份取、并回头对齐价值点与 Hero
   ——那是跨页排版决定，应另开工作项，不在改版批次里半取。
9. **Task 6 清理摘除的死 CSS**（不改任何渲染输出，四断点逐像素 0 差异）：
   `styles.css` 的 `.city-partner-page*` 整族与 `.city-coming-soon__*` 旧四模块，
   共 −385 行。保留了仍在 DOM 里的 `.city-coming-soon` / `__media` / `__embedded-form`
   与 `.city-partner-form*` 全族。逐类名判据与存疑保留清单见 Task 6 报告与
   `artifacts/verification/OPT-038/task6-dead-css-probe-{before,after}.json`。
   `tests/coming-soon-city-view.test.ts` 里那条「四个旧模块的 CSS 规则必须存在」的断言
   **方向已反转**为「不得回来」，并把 44px 触控高度的断言改打 `recruit.css`（规则搬家了）。
