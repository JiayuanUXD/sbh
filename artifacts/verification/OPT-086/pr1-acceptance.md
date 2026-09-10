# OPT-086 PR 1 浏览器验收（控制者实测）

日期：2026-09-10
分支：`feat/opt-086-listing-unpublish-1e4e`（worktree `E:\wt-086`，最初基于 master `868a45e`，终审后 rebase 到 `df391e8`）
环境：`E:\wt-086` 的 dev server `http://localhost:3721`（Turbopack），本地夹具库，`e2e-adm` 登录，视口 1440×1000，深色模式。
取证：`mcp__Claude_Browser__*` DOM 探针 + `/api/listings/:id` 与 `/api/audit-logs` 回查 + 截图。

## 1. 编辑页动作条（Task 2 之后）

对象：房源 66「陆家嘴核心区 · 江景甲级办公」，租赁，初始 `published`，`isFeatured=true`，`version=21`。

| 步骤 | 观察 | 结论 |
|---|---|---|
| 打开编辑页 | 文档控件区出现 `.listing-publication-actions`：「发布状态 · 已发布 · 下架 · 标记已租」，与「保存」同一行；**没有**「标记已售」（租赁房源） | ✅ 租售分开生效 |
| 点「下架」 | 弹层标题「下架『陆家嘴核心区 · 江景甲级办公』」；正文两段（当前状态：已发布 → 已下架 / 必须填写下架原因，会记入审计）；原因输入框 0/200；**「确认下架」禁用** | ✅ 原因必填在 UI 层拦住，不靠 422 |
| 填原因 | 「确认下架」变为可用 | ✅ |
| 确认 | 弹层关闭；动作条变为「已下架 · 发布 · 标记已租」；`GET /api/listings/66` → `unpublished`，`version` 21→22；前台可见性卡变为「未上架（已下架）」并给出提示；`/api/audit-logs` 出现 `listing.unpublish`，对象 66 | ✅ 状态、版本、可见性卡、审计四方一致 |
| 点「发布」 | 弹层标题**「重新上架」**（当前是已下架），正文提示需满足有效供给条件；「确认发布」可用 | ✅ |
| 确认 | 动作条回到「已发布 · 下架 · 标记已租」；API `published`，`version` 23；`isFeatured` 仍为 `true`（重新上架不动推荐位） | ✅ 夹具已恢复 |

未取样（本地无对应数据）：出售房源的「标记已售」按钮、终态（已租 / 已售）无按钮、`mark_leased` 撤销推荐——由 Task 1 单测与端点测试覆盖，e2e 不做终态操作以免破坏夹具。


### 1.1 保存后直接操作（终审 Important 的验证，修复 84d01f2 / 1d8ab88 之后）

| 步骤 | 观察 | 结论 |
|---|---|---|
| 页内改「建议工位数」95→43，点「保存」 | 不整页刷新；API `version` 26→27；动作条仍显示「已发布」 | 表单已保存 |
| 紧接着点「下架」→ 填原因 → 确认 | **一次成功**：弹层关闭、无错误文案；API `unpublished`，`version` 28 | 修复前这里会先撞 409「本页数据已过期」 |
| 紧接着点「发布」→ 弹层 →「确认重新上架」 | 一次成功；API `published`，`version` 29；`isFeatured` 仍 `true` | 连续两步都拿到了实时版本号 |
| 未保存把租售类型切到「出售」 | 动作条仍是「下架 · 标记已租」，不出现「标记已售」（实施代理实测，随后放弃改动） | 租售类型只认已保存文档 |
| 把「建议工位数」改回 95 并保存 | 夹具恢复 | |


### 1.2 未保存改动时的守卫（Task 5 之后）

| 步骤 | 观察 | 结论 |
|---|---|---|
| 页内改「建议工位数」不保存 | 「下架」「标记已租」两个按钮 `disabled` + `aria-disabled="true"`；鼠标悬停出现提示「有未保存的改动，请先保存再执行发布动作」 | ✅ 动作不会再静默丢掉未保存编辑 |
| 点「保存」 | 两个按钮恢复可用 | ✅ |
| （修复 03465b9 后复验）真实鼠标悬停禁用按钮 | 提示由 Arco 自身的包裹层承载（按钮 `pointer-events:none`，无 `title` 属性），提示文案同上 | ✅ 跨浏览器路径 |
| 改回原值再保存 | 夹具恢复（工位数 95，v40，已发布） | |

端点租售守卫（`mark_leased` 拒绝出售房源 / `mark_sold` 拒绝租赁房源 → 422 `BUSINESS_TYPE_MISMATCH`）由单测覆盖，未在本地对夹具执行——成功路径会写入不可逆终态。

### 1.3 下架原因真正入审计（终审修复波 `12025c2` / `dc47bee` / `61356c3` / `f37b785`，rebase 到 master `df391e8` 之后复验）

终审发现弹层「必须填写下架原因，会记入审计」是空头承诺：端点只校验非空就把原因丢了，审计表没有承接字段。修复：`audit_logs` 新增可空 `reason` 列（迁移 `20260910_141436_opt_086_audit_log_reason`，`up()` 只有一句 `ADD COLUMN`），`withAudit` 透传，端点在 `unpublish` 时写入 trim 后的原因，成功与失败审计都带；审计详情抽屉新增「操作原因」一行。dev server 冷重启、迁移已应用到本地库后实测：

| 步骤 | 观察 | 结论 |
|---|---|---|
| 编辑页点「下架」，填「实测：终审修复波，原因随审计落库」，点「确认下架」 | 弹层关闭，动作条「已下架 · 发布 · 标记已租」；API `unpublished`，`version` 50→51 | ✅ |
| `GET /api/audit-logs?where[action][equals]=listing.unpublish&sort=-occurredAt` | 最新一条（id 97，对象 66，`objectVersion` 50）`reason` 正是上面填的原因；修复前的同类行（id 94）`reason` 为 `null` | ✅ 落库 |
| 追加 `where[reason][equals]=<同一原因>` | `totalDocs: 1`，命中 id 97 | ✅ e2e 改用的按原因筛选可精确定位 |
| 后台「审计日志」列表 → 该行「详情」抽屉 | 「变更内容」组里出现「操作原因 实测：终审修复波，原因随审计落库」，位于「变更字段 publicationStatus」之下 | ✅ 运营入口可见（截图见上方对话记录，抽屉标题「审计详情 · 房源已下架」） |
| 点「发布」打开「重新上架」弹层 → 真实鼠标点遮罩 | 弹层不关闭 | ✅ `maskClosable={false}` |
| 焦点在弹层内时按 Esc | 弹层关闭 | ✅ `escToExit`（Arco 把 keydown 绑在弹层容器上，焦点在弹层外时 Esc 无效，这是 Arco 既有行为，不是本 PR 引入） |
| 再开弹层 → 点「确认重新上架」 | 动作条回到「已发布 · 下架 · 标记已租」；API `published`，`version` 52，`isFeatured` 仍 `true`；`listing.publish` 审计 `reason` 为 `null` | ✅ 夹具已恢复；上架不收原因 |

未实测：422 `BUSINESS_TYPE_MISMATCH` 之后的 `router.refresh()`（要先把库里的租售类型改掉再在旧页面上点成交动作，会写入不可逆终态），由代码复审确认与 409 分支同一处理。

## 2. 列表操作列「下架」（Task 3 之后，真实鼠标点击）

视口 1920×1000（操作列在 1440 下位于横向滚动区外）。

| 步骤 | 观察 | 结论 |
|---|---|---|
| 打开 `/admin/collections/listings` | 已上架行操作列为「编辑 · 前台 · 下架」；已下架行只有「编辑」 | ✅ 按行状态显隐 |
| 鼠标点击首行「下架」 | 同一确认弹层（标题带房源名，正文同编辑页），「确认下架」禁用 | ✅ 与编辑页共用弹层与文案 |
| 键盘输入原因 → 鼠标点「确认下架」 | 弹层关闭；列表自动刷新，该行发布状态「已下架」、操作列只剩「编辑」；API `unpublished`，`version` 33 | ✅ |
| `POST …/publish {action:'publish'}` 恢复 | API `published`，`version` 34，`isFeatured` 仍 `true` | 夹具已恢复 |

配色表已收成 `src/components/admin/publication-status-colors.ts`，列表与动作条共用；列表「已下架」标签仍为橙色（实施代理核对 `arco-tag-orange`）。

## 3. 未覆盖

- 全量 e2e 由 CI 跑；本地只在 3721 上做了上面的手工链路。
- 无权限角色看不到按钮：按 Task 2 服务端逻辑（`hasOperationPermission`），CSR 等无 `listings` 菜单进不了编辑页，e2e 用 API 403 断言。

## 4. 顺带发现（非本 PR 引入，待排查）

dev server 日志：每次调用 `POST /api/listings/:id/publish` 后，Next dev 的后台缓存重算（`revalidating cache with key: getHomepage… / findPublicCityProfiles / site-settings`）里 `payload.find` 抛 `TypeError: Cannot read properties of undefined (reading 'id')`（`supply-adapter.ts:1173`、`:1141`），浏览器控制台随之出现若干 500 资源加载。

对照：用 master 上就有的「首页推荐」PATCH 写两次，**没有**新增同类错误；错误数 6 恰好对应两次发布端点调用各一波重算。结论：它跟随发布端点既有的缓存失效路径（审核台「通过后上架」同路），且只出现在 `next dev` 的后台重算（生产 `revalidateTag` 不会立即重跑）。不阻塞本 PR，建议单独排查 dev 下 `getPayload()` 在无请求上下文时的行为。
