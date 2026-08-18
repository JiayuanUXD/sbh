# Task Packet：OPT-032 房源编辑页填写引导 + 免审直发产品口径

> 状态：**第一、二部分讨论中；第三部分（表单布局）已定稿，实施中**
> 创建日期：2026-08-18
> 分支：`feat/opt-032-listing-form-guidance-12ea`
> 基线：`master @ 8487934`，线上 CloudRun `sbh-097`
> 来源：2026-08-18 会话记录（用户 + Claude Code）

第一、二部分是讨论记录：**已核实的代码事实**、**发现的缺陷**、**建议**与**未拍板的问题**，
不要当作既定方案实施。

**第三部分是用户已确认的表单布局方案**，含实施清单，照着做即可。
交互式对照 demo：`artifacts/OPT-032/listing-form-demo.html`（纯静态，双击可开）。

---

## 第一部分：免审直发（fast_track）四个待定口径

### 1.1 讨论前提被证伪的一条

确认弹窗 [ListingFastTrackActionClient.tsx:120-124](../../payload-office-platform/src/components/admin/ListingFastTrackActionClient.tsx)
向用户承诺「在审核记录里留下一条免审直发事件，**记录操作人**——事后可追溯」。

**这条承诺目前不成立。** 核实过程：

- [listing-review-decision-endpoint.ts:204-207](../../payload-office-platform/src/endpoints/listing-review-decision-endpoint.ts)：
  `submittedBy` 只在 `decision === 'submit'` 时写，`reviewedBy` 只在 `approve`/`reject` 时写。
  `fast_track` 两个条件都不满足 → 该条 `listing-reviews` 记录的**操作人与时间戳均为空**。
- [listing-review-decision-endpoint.ts:175-180](../../payload-office-platform/src/endpoints/listing-review-decision-endpoint.ts)：
  `auditAction` 映射表没有 `fast_track` 键，落到 `?? 'listing.update'`，
  中文标签是「房源已修改」（见 `src/domain/audit/audit-types.ts:112`）。
- `ListingReviews` collection 字段清单（`src/collections/ListingReviews.ts`）里没有
  自动 `createdBy` 一类的兜底字段。

**净结果**：事后能查到的只有「某人某时改了这条房源」，分不出那是普通编辑还是免审直发。
而「至少事后追得到人」正是允许直发存在的组织理由——前提塌了，下面 1.3 / 1.4 的讨论都悬空。

### 1.2 顺带发现的 UI 缺陷

[ListingFastTrackActionClient.tsx:123](../../payload-office-platform/src/components/admin/ListingFastTrackActionClient.tsx)
的 `直发会**跳过另一个人复核**这道约束` 是 JSX 字面量，Arco 的 `Typography.Paragraph`
不解析 markdown，线上显示的是带星号的原文。

### 1.3 四问逐条

#### 问题 1 · 直发只改审核状态，不自动上架，符合原意吗？

**核实到的事实**：

- 两轴分离是显式设计（`publication-status.ts` 头注释 / design §3.5 / R3）。
- 发布端点的前置门**比直发严**：[listing-publish-endpoint.ts:129](../../payload-office-platform/src/endpoints/listing-publish-endpoint.ts)
  要求 `reviewStatus === 'approved'` **加**有效供给精筛谓词；而直发只跑
  `checkListingCompleteness`。两者不是同一个口径。
- 权限也不同：直发要 `listing:review` + `listing:fast_track_review`，发布要 `listing:publish`。

**建议**：保持两轴分离，在 UI 上合并动线。确认弹窗加「直发后立即上架」勾选，
仅当用户同时持有 `listing:publish` 时出现，前端连调两个端点。
失败语义要明确：直发成功但上架失败时提示「已审核通过，未上架，原因 X」，
**不做整体回滚**（直发不可逆）。

**不推荐端点层联动**：会迫使直发复制一遍有效供给谓词，否则造出
[endpoint 注释 138-146 行](../../payload-office-platform/src/endpoints/listing-review-decision-endpoint.ts)
自己警告的那种幽灵（后台已发布、前台静默不可见）；也会让 `fast_track` 权限隐含 `publish` 权限。

**用户回应**：本轮未选择上述任一选项，转而提出先做「必填字段加标记」（见第二部分）。**此问仍挂起。**

#### 问题 2 · `listing:fast_track_review` 要不要显式授予角色？

**核实到的事实**（`src/migrations/20260728_180000_opt_021_admin_navigation_roles.ts`）：

| 角色 | `listing:review` | `listing:publish` | `listing:fast_track_review` |
|---|---|---|---|
| ADM | 靠 `*` | 靠 `*` | 靠 `*` |
| OPS | ✅ 显式 | ✅ 显式 | ❌ 无 |
| MGR / BRK / CSR | ❌ | ❌ | ❌ |

**建议**：默认最小权限，不给整个 OPS 加。但存在一个与「导航入口消失」同构的风险——
如果日常录房源的是 OPS 而 ADM 只有一两个人，这功能实际没人碰得到（上次是导航层
「人碰不到」，这次可能是权限层）。若确需开放，倾向新建更窄的角色（如内容主管）
而不是给整个 OPS。

**用户回应**：无所偏好。**此问仍挂起**，取决于「谁在录房源」这个运营事实。

#### 问题 3 · `pending` 要不要放开直发？

**核实到的事实**：`review-status.ts:62-67` 的转移表里 `pending` 只有
`withdraw` / `approve` / `reject`；`fast_track` 的起点是 `not_submitted` 和 `rejected`。
[ListingFastTrackAction.tsx:43](../../payload-office-platform/src/components/admin/ListingFastTrackAction.tsx)
在 pending 时直接 `return null`——运营看到的是**什么都没有**。

**建议**：不放开。代码注释里「审核中却已通过自相矛盾」这个理由只对一半
（`pending → approved` 本来就合法，那是 `approve` 这条边）；真正的约束是
「进了别人队列的东西不该被人替他裁决」。而运营需求已经有解：
`pending --withdraw--> not_submitted --fast_track--> approved`，两步都在状态机内，
审计留下「谁把它撤出队列」和「谁直发的」两条记录，轨迹自洽。
放开 `pending → fast_track` 反而丢掉「它曾进过队列又被撤出」这个事实。

真正的缺口在 UI：pending 时应渲染禁用态说明或「撤回并直发」组合按钮（前端连调两次）。

**用户回应**：无所偏好。**此问仍挂起。**

#### 问题 4 · 从未在真实数据上点过

**建议**：四个里唯一无条件必须做的，且顺序是**先补审计操作人，再做真实验收**——
1.1 那个缺口正好在这里咬人：第一次真实点击若点错对象，事后只查得到一条「房源已修改」。

验收至少覆盖：
1. 完整房源 → 直发成功 → 核对 `reviewStatus` / `listing-reviews` 记录 / audit-log
2. 缺字段房源 → 422 → 检查缺失项弹窗的中文可读性（用户点名要看的）
3. 版本冲突 → 409 提示
4. 无权限账号 → 入口不渲染

生产上第一次点击用自己新建的测试房源，不要拿真实供给试。

**用户回应**：无所偏好。**此问仍挂起。**

---

## 第二部分：房源编辑页填写引导

用户诉求：**给满足房源发布条件的字段加标记，便于填写与检查，尤其是出错时方便看错误提示。**

### 2.1 现状盘点（已核实）

- 编辑页当前带 `*` 的只有 3 个字段：房源标题、所属楼盘、类型。那是 Payload 对
  `required: true` 的自动渲染，代表的是**草稿能不能存**（`DRAFT_REQUIRED_FIELDS`），
  不是能不能发布。
- 发布真正要的是 12 项（[listing-completeness.ts:162](../../payload-office-platform/src/domain/review/listing-completeness.ts) 的 `getSubmitRequiredFields`）：
  上述 3 项 + 租售类型、装修状态、结构化价格、面积、楼层、房源描述、联系经纪人、
  图集、商户关系；租赁再加最短租期 / 付款条件 / 可入驻日期，出售加产权年限。
  **这些一个标记都没有。**
- **不能改成 `required: true`**：会打死「草稿随写随存」（listing-completeness.ts 开头
  写明的两级门槛）。
- 三项发布条件没有可标的单一字段：图集要 **≥3 张**（数量不是有无）、商户关系在
  `listing-merchant-relations` **另一个 collection**（编辑页没有这个字段）、
  结构化价格要 amount/currency/period/unit **四件套都有效**。
- 租售差异已由 `admin.condition` 处理（`minimumLeaseMonths` / `paymentTerms` /
  `availableFrom` 都是 `businessType !== 'sale'`；`saleTerms` 组有 `saleTermsCondition`），
  所以静态标记在各自模式下是准确的。`businessType` 有 `defaultValue: 'lease'`，
  不存在「必填但字段被隐藏」的问题。

### 2.2 三个方案与取舍

| 方案 | 做法 | 问题 |
|---|---|---|
| A 手工加 `*` | 每个字段 label 后面敲星号 | 把必填口径手抄一份到 `Listings.ts`，与 `listing-completeness.ts` 必然漂移（宪章「同义文档一多必然漂移」）；且盖不住上述三项 |
| **B 派生标记** | 从 `getSubmitRequiredFields()` 派生，写「字段键 → 表单路径」映射，构建 collection 时自动给 label 追加 `*`，单测断言每个必填键都有映射 | 口径单一真源；天花板仍是那三项 |
| **C 完整度清单** | 编辑页展示 `checkListingCompleteness` 的 score + missing 逐项 ✓/✗ | 覆盖全，且是 `listing-completeness.ts` 头注释写明的原始意图 |

**建议：C 为主，B 为辅。** 录入时漏掉的多半不是「某个下拉没选」，而是「图只传了 2 张」
「忘了绑商户」——恰恰是 `*` 标不出来、也恰恰是 422 最常吐出来的两项。

**用户回应：认可 B。** C 未明确表态。

### 2.3 重要修正：C 已经有半个了

会话中我先断言「图集数量和商户关系客户端拿不到」，**这是错的**。

[ListingVisibilityCardClient.tsx:91](../../payload-office-platform/src/components/admin/ListingVisibilityCardClient.tsx)
已经在客户端用 `useField({ path: 'gallery' })` 读到图集，并用 `galleryRowCount`
处理了「array 父路径有行时存的是行数而不是数组」这个坑。所以完整度清单可以做成
**真实时**，只有商户关系一项需要服务端喂。

更重要的是：OPT-030 那张「前台可见性」卡片（sidebar + 逐条检查 + 点击定位到 Tab
并高亮）**就是 C 的一半**。完整度清单应做成它的兄弟组件，复用
[locateCheck](../../payload-office-platform/src/components/admin/ListingVisibilityCardClient.tsx)，
不要另起炉灶。口径来自 `checkListingCompleteness`，清单随 `businessType` 变时用
`getSubmitRequiredFields`——**不要用 `@deprecated` 的 `SUBMIT_REQUIRED_FIELDS`**，
那是租赁口径，出售房源会被「最短租期」平白卡住。

### 2.4 tab 改锚点

用户提议：把分类 tab 改成一张统表，或 tab 保留但仅作锚点。

**约束**：Payload 的 `type: 'tabs'` 没有「只当锚点」的开关，配置层做不到。要实现得换结构——
tabs 换成 `collapsible` 或普通分组（全部渲染在一张页面），再写一个 sidebar 锚点导航 ui 组件。

**方向支持**，理由具体：现在 `locateCheck` 里那段「查 tab 按钮 → `click()` → 等 React
渲染 → 300ms 重试两轮」是被 tab 逼出来的脆弱 hack。字段全在同一 DOM 后，定位退化成
一行 `scrollIntoView`，浏览器原生 Ctrl+F 也能用，错误提示同屏可见。

**三条成本**：

1. 首屏要渲染全部 67 个字段（含富文本描述、媒体工作台、亮点选择器）。
   **Payload 对非激活 tab 是否懒渲染，本次未能确认**——该 worktree 没装 `node_modules`。
   **这条必须实测**：若原本是懒渲染，拍平会让编辑页明显变慢，需改用 collapsible 默认折叠。
2. `locateCheck` 依赖 `.tabs-field__tabs button` 和 `tabs-field__tab-button--active`
   两个 Payload 内部类名。tabs 一拆必须同步改，否则可见性卡片的点击定位
   **静默失效**（点了没反应，不报错）。
3. `deriveListingSelfVisibility` 返回的 `locateTab` 语义要从「哪个 tab」改成「哪个锚点」，
   属 domain 层改动，有测试兜着。

当前 tab 结构（5 个）：基本信息 / 价格与面积（label 为计算值 `priceTabLabel`）/
审核与发布 / 展示内容 / 数据来源。

### 2.5 表单组件换 Arco

**结论：可以，但别整体换，按需换。**

Arco 现在的用法是对的——审核队列表格、`MediaWorkbench`、`AmenitiesChipSelector`、
可见性卡片，都是 Payload 原生表达不了的东西。问题出在把普通数据字段
（text / select / number / date）也换掉：换来的只有视觉一致，代价是把 Payload
白送的这些自己重写——字段级校验错误渲染、`condition` 条件显隐（租售差异全靠它）、
字段级权限只读、dirty/undo 追踪、草稿版本对比、i18n label。

**最硬的一条**（宪章已记录）：自定义 array 字段组件绝不能用 `setValue` 往父路径写
整个数组——有行的 array 会被标 `disableFormData`，提交时整条路径跳过，内容静默不落库。
`MediaWorkbench` 就是被这个逼着改用 `addFieldRow` / `removeFieldRow` / `moveFieldRow` 的。
整体替换等于把这类坑摊到 67 个字段上，失败形态是「保存成功但数据没进去」。

次要但真实：Arco 在本仓库带着 pnpm patch；每加一个 client 组件都要
`pnpm payload generate:importmap`，忘了整个 `/admin` 白屏；Arco 的 CSS 与 Payload
主题混用，在暗色模式下正是宪章点名的「残留 `#FFFFFF` 白底」高发区。

**建议成文的判据**（可写进 `.agent/backend.md`）：
> Payload 原生能表达的字段不换；需要跨字段联动、批量操作、复杂选择或工作台形态的，
> 才上 Arco 自定义组件。

这就是现在事实上的做法，只是没成文。

---

## 待决问题清单

| # | 问题 | 状态 |
|---|---|---|
| 1 | 直发是否联动上架（推荐：UI 合并动线，不改端点契约） | 挂起 |
| 2 | `fast_track` 权限给谁（取决于「谁在录房源」这个运营事实） | 挂起 |
| 3 | pending 是否放开（推荐：不放开，补「撤回并直发」） | 挂起 |
| 4 | 真实验收顺序（推荐：先补审计操作人再验收） | 挂起 |
| 5 | C（完整度清单）做不做 | 未表态 |
| 6 | ~~tab 改锚点的最终形态~~ | **已定，见第三部分**：不整体通铺，收成 2 tab，展示内容单独留 |

## 建议落地顺序

1. **B（从 completeness 派生 `*` 标记）**——纯配置层，不碰组件，风险最低，先落。
2. **完整度清单（C）**——复用可见性卡片的模式与 `locateCheck`，中等工作量。
3. **tab 改锚点**——先做渲染性能实测，数据出来再定形态。它会改 `locateCheck`，
   排在 2 之后，否则要改两遍。

Arco 那条不是工作项，是一条取舍规则，写进 `.agent/backend.md` 即可。

## 本次未做的事

- 未修改任何代码。
- 未验证 Payload tabs 的懒渲染行为（worktree 无 `node_modules`）。
- 未在真实数据上点过免审直发按钮（问题 4 的原始风险仍在）。

---

# 第三部分：表单布局方案（已定稿，实施中）

用户已确认。对照 demo：`artifacts/OPT-032/listing-form-demo.html`，可切「现状 / 语义重排」
「租赁 / 出售」「媒体数量」等开关，左上角实时显示表单高度（离屏克隆实测，非估算）。

## 3.1 本轮核实的代码事实（都查过源码，别再重新推测）

### Payload 渲染机制

| 事实 | 出处 |
|---|---|
| 客户端**只渲染激活 tab** | `TabsFieldComponent` 的 return 里只有 `activeTabConfig && <TabContent/>` |
| 服务端 `iterateFields` 对 tabs **无条件全展开**，`renderFieldFn` 不按激活态过滤 | `addFieldStatePromise.js` tabs 分支是 `field.tabs.map(...)` |
| 折叠的数组行**不省**——`Collapsible` 无条件渲染 children，只是套 `height: 0` | `elements/Collapsible/index.js` |

**推论**：通铺**不增加服务端与 RSC 成本**（今天就已全付），只增加客户端 mount。

### 字段分布（Listings.ts 是 **5 个** tab，不是 4 个——有一个 label 是变量 `priceTabLabel`）

| tab | 叶子输入 | 备注 |
|---|---|---|
| 基本信息 | 7 | 今天的默认首屏 |
| 价格与交易参数 / 租赁参数 | 24 | 最大的一个 |
| 审核与发布 | 8 + 1 个 `ui` | |
| 展示内容 | **245 输入当量** | 媒体工作台 40 行 × 6 子字段 + 亮点 4 + 富文本 1 |
| 数据来源 | 4 | 整组挂 condition，手工建的房源不显示 |

**展示内容 = 87% 的首屏渲染量**，且含两个重组件：
- `mediaItems`（`maxRows: 40`，自定义 `MediaWorkbench` 1314 行）——mount 即发 `/api/media`
  批量请求，再渲染最多 40 张缩略图，每张一个 COS 图片请求
- `description`（`richText`）——mount 时实例化 Lexical 编辑器

→ **这就是「展示内容」必须单独留一个 tab 的原因**：一次 tab 点击挡掉 87% 首屏渲染量。

### 短行对不齐的根因

`mergeFieldStyles.js`：字段**没设** `admin.width` 时内联样式是 `flex: 1 1 auto`（grow=1，
**拉伸填满**）；设了才走 SCSS 的 `flex: 0 1 calc(var(--field-width) - ...)`（grow=0，不拉伸）。

→ **固定列轴是纯配置**：给字段加 `admin.width` 即可，不用写 CSS。

### slug 隐藏方案的三种写法（选错就踩坑）

| 写法 | 表单状态 | 渲染 | 校验 | API 输出 | 结论 |
|---|---|---|---|---|---|
| `admin.hidden: true` | **在** | 走 `HiddenField` | **参与** | 保留 | ❌ 新建时被**看不见的必填错误**拦住保存 |
| `admin.disabled: true` | 不在 | 不渲染 | 不参与 | 保留 | ⚠️ 可用，但图标读不到值（得退回 `useDocumentInfo`） |
| **`admin.condition: () => false`** | **在（带值）** | 不渲染 | 不参与 | 保留 | ✅ **采用** |
| 顶层 `hidden: true` | — | — | — | **被删** | ❌ 前台 `mappers.ts` 读不到 slug，详情页崩 |

关键源码：
- `fieldIsHiddenOrDisabled` 只认**顶层** `hidden` 和 `admin.disabled`，**不认 `admin.hidden`**
- `addFieldStatePromise.js:80-88`：`passesCondition === false` → 写入 `state[path]`（含 value）
  后 return，早于校验块与 `renderFieldFn`
- `Form/index.js` `validateForm`：`if (field.passesCondition !== false)` 跳过
- `beforeChange/promise.js`：`skipValidationFromHere = skipValidation || !passesCondition`，
  且**没有任何 `delete siblingData[...]`** → 值照常提交
- `afterRead/promise.js:31`：顶层 `hidden` 才会把字段从响应里删掉

**采用 `admin.condition: () => false` 的收益**：`required: true` 与 `NOT NULL` 都不用动
（**无迁移**），hook 的 `ensureUniqueSlug` 去重照常跑（新建时提交的 slug 为空），
图标可用正常的 `useField({ path: 'slug' })` 读值。服务端行为**零变化**。

### 其他

- 集合级 `beforeChange` 跑在**字段级 `required` 校验之前**（`create.js`：先 collection
  beforeChange，再 `beforeChange - Fields`）→「留空自动生成」本来就是通的。
- 发布必填是 **租赁 15 项 / 出售 13 项**（`SUBMIT_REQUIRED_COMMON` 12 + 租售专属），
  第二部分写的「12 项」只是 common 的数量。
- **真正标不了的只有 `gallery` 一项**（`admin.hidden` 的派生数组，界面上没有 label 可挂，
  且条件是「≥3 张」）。`price` 可标在 group label 上，`merchant` 有真实 relationship 字段
  可标（近似——实际门槛判的是 `listing-merchant-relations` 的关系记录）。
- 编辑页现在是 **4 个 `*`** 不是 3 个，多出来的 `slug` 既不在草稿门槛也不在提交必填里
  → 做映射时**不能拿现有星号当基准**。
- slug 字段值是**裸 kebab**（`chuangke-plaza-3f`），`/listings/` 是拼 URL 时的前缀；
  且规范前台路径**带城市段** `/{citySlug}/listings/{slug}`，裸路径只是会 302 的中转。

## 3.2 高度实测

| | 高度 | 累计省 |
|---|---|---|
| 现状（Payload 原样） | 2350 px | — |
| ① 语义重排 + 去组框 + 固定列轴 | 1904 px | 446 px（19%） |
| ② + 只读四项文本化并后置 | 1845 px | 505 px（21%） |
| ③ + URL 收进标题框图标 | **1735 px** | **615 px（26%）** |

对照：统一 2 列 **2416 px（比现状更高）**，统一 3 列 2120 px（省 10.5%，但拆散语义配对、
产生孤儿行）。**结论：省高的关键不是统一列数，而是按语义分行。**

## 3.3 实施清单

### A. 纯配置层（Listings.ts）

1. **5 tab 收 2 tab**：`房源信息`（基本信息 + 价格 + 审核发布 + 数据来源）、`展示内容`。
2. **row 按语义重排**（行内字段是语义兄弟，行宽随可见字段数自适应）：
   - 基本信息：`[标题, 类型, 所属楼盘]`、`[租售类型, 装修状态, 工商注册状态]`
   - 价格：`[金额, 币种, 计价周期, 计价单位]`、`[面积, 工位数, 楼层, 最短租期]`、
     `[付款条件, 可入驻日期]`
   - 空间明细：`[得房率, 朝向, 净层高, 家具状态]`、`[最少工位, 最多工位, 可分割]`
   - 出售信息：`[产权年限, 税费承担方, 满五唯一, 车位配置]`
   - 费用条款：`[押金月数, 物业费包含, 物业费金额, 发票情况]`、`[其他固定费用]`
   - 审核发布：`[供给商户, 联系经纪人]`、`[审核状态, 发布状态, 冻结, 版本号]`
   - 数据来源：`[来源平台, 外部 ID, 同步时间, 源地址]`
3. **`admin.width` 固定列轴**：基本信息 `33.33%`，其余节 `25%`；textarea / richText 用 `100%`。
4. **字段顺序**：只读四项移到供给商户 / 联系经纪人 / 核验信息**之后**（字段顺序即显示顺序，
   不涉及 schema）。

> ⚠️ **`row` 上的 `admin.condition` 必须跟着字段走**。重排时把 row 拆开重组，如果只搬字段
> 不搬条件，旧租金字段会在不该出现时冒出来。做 demo 时踩过这个坑。

### B. 样式（`src/app/(payload)/custom.scss`）

5. 覆盖 `.group-field` 去掉上下边框与内边距，只留标题——外框的内边距**正是组内字段与组外
   对不齐的根因**。只作用于 listings 编辑页，别全局改。
6. row 内的复选框改成「标签在上 + 方框落控件行」。原来的 inline 写法没有标签行，
   方框会浮到相邻输入框的中间高度（`可分割` 就是这个现象）。

### C. 两个自定义组件

7. **只读状态展示**：四个状态字段改「字段名 + 值 + ⓘ（hover 显示原说明）」，不再是禁用输入框。
8. **标题框 slug 图标**：slug 设 `admin.condition: () => false`，图标挂在 title 的自定义
   Field 上，`useField({ path: 'slug' })` 读值，hover 显示 `URL 标识: chuangke-plaza-3f`。
   **字段上必须写注释说明为什么不用 `admin.hidden`**，否则后人会顺手改回去，然后踩进
   看不见的必填错误。

### D. 两条兜底（用户确认要一起做）

9. **`slugify` 空值兜底**：`admin.condition: () => false` 会让 `required` 在**所有写入路径**
   （含 REST/Local API）都不再拦。正常情况无所谓（hook 保证有值），但标题若全是符号或
   emoji（如 `###`），`slugify` 返回空 → `listing-protect.ts` 里 `if (base)` 不成立 →
   **slug 根本不被赋值** → 撞 `NOT NULL` 报原始 Postgres 错。
   → 在 hook 里加确定性兜底（`base` 为空时退到可预测的值），三行代码。

10. **`ensureUniqueSlug` 测试覆盖**：`tests/listing-protect.test.ts` 每个用例都显式传了
    slug，**自动生成分支零覆盖**。而改完之后**每次新建都走它**——从「几乎不走」变成热路径。
    要覆盖：留空生成、冲突追加 `-2`/`-3`、update 保留原 slug、空 base 兜底。

### E. 方案 B（发布必填标记）

11. 从 `getSubmitRequiredFields(businessType)` 派生「字段键 → 表单路径」映射，构建 collection
    时给 label 追加标记。**禁止改成 `required: true`**——会打死「草稿随写随存」的两级门槛
    （见 `listing-completeness.ts` 头注释）。标记必须是纯视觉的。
12. 单测断言每个必填键要么在映射表里、要么在显式豁免清单里（`gallery` 进豁免）。
    这条测试才是方案 B 的真正价值：以后加发布条件时，漏标会红。
13. 用 `getSubmitRequiredFields(businessType)`，**不要用 `@deprecated` 的
    `SUBMIT_REQUIRED_FIELDS`**（租赁口径，出售房源会被「最短租期」平白卡住）。

## 3.4 拆 PR 建议

- **PR 1**（A + B + E）：纯配置 + 样式 + 发布必填标记，不含自定义组件。
- **PR 2**（C + D）：两个组件 + 两条兜底 + 测试。D 的两条必须和 C-8 同一个 PR
  ——slug 的 condition 一改，兜底和测试就是前置条件，不能后补。

## 3.5 第二部分中被本轮修正的结论

- 「Payload 是否懒渲染非激活 tab」——**已确认：是**（原文标记为未能确认）。
- 「发布必填 12 项」——实为租赁 15 / 出售 13。
- 「3 项没有可标的单一字段」——实为 **1 项**（只有 `gallery`）。
- 「编辑页只有 3 个 `*`」——实为 4 个（多一个 `slug`）。
- 「tab 改锚点需先实测渲染性能」——已测，见 3.2；结论是**不整体通铺**，展示内容单独留一个 tab。
