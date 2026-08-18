# Task Packet：OPT-032 房源编辑页填写引导 + 免审直发产品口径

> 状态：**讨论中，未拍板，未动代码**
> 创建日期：2026-08-18
> 分支：`docs/fast-track-form-guidance-024171`（本地，未推送）
> 基线：`master @ 8487934`，线上 CloudRun `sbh-097`
> 来源：2026-08-18 会话记录（用户 + Claude Code），非最终规格

本文件是一次讨论的完整记录，包含**已核实的代码事实**、**发现的缺陷**、**给出的建议**
与**尚未拍板的问题**。里面的建议都还没有获得用户确认，不要当作既定方案实施。
落成方案前需要先答完文末「待决问题清单」。

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
| 6 | tab 改锚点的最终形态（全展开 / 默认折叠） | 待实测渲染性能后定 |

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
