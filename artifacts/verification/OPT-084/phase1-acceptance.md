# OPT-084 Phase 1 浏览器验收（控制者实测）

日期：2026-09-10
分支：`feat/opt-084-admin-nav-phase1-0dd5`（Tasks 1–3 落地后，Task 4 只改 `tests/`，不影响运行时）
环境：**主树 dev server `http://localhost:3000`**（`pnpm exec next dev`，Turbopack）。
> 注意：本机 `:3717` 是另一个会话在 `.claude/worktrees/practical-kare-1db3c6` 起的 `next dev --webpack`，分支 `fix/probe-remote-robustness-4b2a`，**与本分支无关**，验收前曾误用过一次，已切换。
账号：`scripts/seed.ts` 的 E2E 夹具（公开夹具，非真实凭据），经 `POST /api/users/login` 登录。
取证：`mcp__Claude_Browser__*` DOM 探针 + 截图；数字来自 `document.querySelectorAll` 计数。

## 1. 五角色结构

全部展开后统计。「组」= `li.admin-navigation__group:not(.--flat)`，「扁平叶」= `a.admin-navigation__link--flat`。

| 角色 | 组（叶子数） | 扁平叶 | 叶子总数 | 与计划表 |
|---|---|---|---|---|
| ADM | 工作台 3 · 待处理 7 · 房源与楼盘 7 · 客户与线索 3 · 站点与内容 6 · 城市与区域 5 · 团队与账号 5 · 设置与工具 3 | 无 | **39** | 一致；子分组元素 0 |
| OPS | 工作台 3 · 待处理 **5** · 房源与楼盘 7 · 站点与内容 4 · 城市与区域 4 | 配套字典 | **24** | 组与扁平叶一致；叶子比计划表少 2，见 §1.1 |
| MGR | 工作台 2 · 待处理 2 · 房源与楼盘 2 · 客户与线索 3 · 团队与账号 3 | 无 | **12** | 一致 |
| BRK | 工作台 2 · 客户与线索 3 | 我的待办 · 房源列表 | **7** | 一致；扁平叶带组图标、`href` 正确、`li` 带 `--flat` |
| CSR | 工作台 2 · 待处理 2 · 客户与线索 2 | 表单管理 | **7** | 一致 |

### 1.1 OPS 少两片叶子的原因（不是导航回归）

「待处理」里 OPS 看不到「信息纠错」与「城市合伙人申请」：

- 信息纠错：collection `read` 走 `correction:read`，内置 OPS 没有这个操作码（`src/test/factory/roles.ts`，生产 `roles` 表同）→ `canReadCollection` 为 false → 叶子按既有规则隐藏。
- 城市合伙人申请：`buildCityPartnerCityScopeWhere` 对非 ADM 且 `cityIds: 'all'` 返回 false → collection 不可读 → 隐藏。**master 上同样如此**（旧 e2e 的 OPS 分组表里从没断言过这片叶子）。

计划表的「26」是把 `canReadCollection` 按 true 推演的近似值（Task 1 的角色快照单测同样是 stub）。e2e 只断言组标签与扁平叶，不断言组内叶子数，所以 CI 不受影响。**这暴露的是权限配置问题，不在本项范围（G4）**：OPS 的角色描述写着「举报处理」，却读不到纠错与合伙人申请。已列入待用户裁定。

## 2. Task 2 交互（ADM，清空 localStorage 后）

| 检查 | 结果 |
|---|---|
| 首次进入 `/admin` 默认展开 | 工作台（当前所在组）+ 待处理 + 房源与楼盘 ✅ |
| 折叠「工作台」后组头汇总角标 | 显示 `2`（消息通知 2 条之和）✅ |
| 展开集写回 localStorage | `sbh-admin-nav-open-groups = ["inbox","supply"]` ✅ |
| 收起侧栏（48px）图标角标 | `--nav-width: 48px`，`.admin-navigation__rail-badge` 在「工作台」图标右上显示 `2` ✅ |
| 进入 `/admin/collections/listings` | 「房源与楼盘」自动并入展开集，「房源列表」高亮 ✅ |

OPS 首次进入默认展开同样为 工作台 + 待处理 + 房源与楼盘 ✅。

## 3. 视口与主题

| 检查 | 结果 |
|---|---|
| 1200×900（OPT-056 T1 回归区间） | `aside.nav` 无 `inert`；点击「客户与线索」组头 `aria-expanded` false→true ✅ |
| 浅色主题 | 切换后 `data-theme=light`；折叠组头角标背景 `rgb(22,93,255)`、文字白 ✅；整栏无残留深色块（截图核对）|
| 深色主题 | 全程默认深色，角标 / 扁平叶 / 组头正常（截图核对）|
| 深色 warning 变体角标 | **未取样**：本地夹具没有任何 warning 类角标（审核 / 举报 / 线索 / 投放 / 纠错）计数 > 0 |
| 扁平叶的收起态图标角标 | **未取样**：没有夹具让被扁平化的叶子同时有非零计数（代码路径与组图标角标相同） |

## 4. 角标端点

`GET /api/admin-navigation`（Task 3 实施代理实测，本机夹具库）：ADM 响应含 `supplySubmissions`、`informationCorrections` 两个新 key（值 0，与 `/api/dashboard-stats` 的 `pendingSubmissions: 0` 一致）；OPS 与 MGR 只得到 `supplySubmissions`；BRK / CSR 两者皆无。

## 5. 未覆盖项

- 全量 e2e 未在本地跑（会被 SIGKILL，见项目记忆），由 CI 执行。
- 390px 移动端不在本阶段验收范围（计划只要求 1200 与 1440）。
