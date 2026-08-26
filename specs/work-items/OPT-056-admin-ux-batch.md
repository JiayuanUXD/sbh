# Task Packet：OPT-056 后台体验优化批次（导航可点性 / 文案净化 / 默认值 / Arco 列表 / 概览提速）

> 状态：**已实施**（2026-08-26，全部子任务完成并浏览器实测；证据见
> `artifacts/verification/OPT-056/`）
> 创建日期：2026-08-26
> 来源：用户后台使用反馈，7 项优化打包
> 分支：`feat/admin-ux-batch-6a11`
>
> 补充结论：
> - 「供给商户默认官网」既有 `resolveDefaultSupplyMerchant` 链路已生效，无需改动（创建页实测预填）。
> - 每页 25 条对**存过每页偏好**的账号不生效（Payload 语义：用户主动选择优先）；新账号/未选过默认 25。
> - `migrate:create` 输出 "No schema changes detected"：全批 UI/配置层改动，无迁移，
>   提交使用钩子预留的 `SKIP_MIGRATION_CHECK=1` 逃生舱（其注释注明适用于纯 UI 改动）。

---

## 子任务与验收

### T1 左侧导航在 1024–1440px 视口不可点击

- **根因（已实测确认）**：Payload 3.86 的 `NavProvider` 在视口 ≤ 1440px（断点 `l`）时自动
  `setNavOpen(false)`，`aside.nav` 被加上 **`inert` 属性**（整棵子树不可交互）；而
  `custom.scss:735` 在 ≥1024px 强制导航可见并隐藏了汉堡开关。结果 1024–1440px 区间
  导航「可见但完全点不动」，且窗口拉宽回去也不会自愈（状态已锁死为关闭）。
- **修法**：`AdminNavigationClient` 引入 `useNav()`，桌面态（≥1024px）强制 `setNavOpen(true)`。
- 验收：1200px 视口下分组可展开、链接可点、`aside.nav` 无 `inert`。

### T2 去掉开发者口吻的字段备注

- 清除/改写含 OPT-0xx、FP-05、M5、design §x、「唯一真相」「乐观锁」「Outbox」「幂等」
  「append-only」「谓词」「哈希」等实现细节词汇的 `description`（探查清单见对话记录，
  A 级 8 处 + B 级 14 处 + C 级选择性处理）。
- 原则：运营看不懂的删掉；对运营真正有用的改写成白话；不新增长备注。
- 验收：`rg "OPT-0|§|乐观锁|Outbox|幂等|append-only" src/collections src/globals` 中
  **用户可见的 description** 不再出现工程术语（代码注释不在范围内）。

### T3 默认值

- `Listings.merchant`（供给商户）已有 `resolveDefaultSupplyMerchant` 默认值链（平台自营
  兜底「官网」）——浏览器实测创建页是否真的预填；未预填则修。
- `Listings.verificationInfo.verifiedAt` 与 `Buildings.verificationInfo.verifiedAt`
  （信息核验时间）加 `defaultValue: () => 当前时间`（运行时函数，不动表结构）。
- 验收：创建页两字段有默认值；保存后落库正确。

### T4+T7 房源/楼盘列表页换 Arco 表格

- 参照 `AuditLogList` / `GeographyListView` 成熟范式（server 取数 + Arco Table 客户端渲染），
  为 `listings`、`buildings` 提供 `views.list` 整页替换：
  - 状态/标签列用 Arco Tag 丰富呈现（审核状态、发布状态、推荐等）。
  - 快捷编辑仅限低风险字段（如推荐位开关），走 Payload REST PATCH（走 access + hooks）。
  - 保留搜索（标题/名称）与基础筛选（状态、城市/楼盘），舍弃 Payload 原生筛选组件。
  - 「创建新条目」为右上角按钮；不渲染「所有 房源列表」抬头。
- 验收：浏览器实测列表渲染、筛选、搜索、分页、快捷编辑、创建按钮跳转。

### T5 所有表格默认 25 条 + Arco 分页

- 新自定义列表默认 25 条/页，用 Arco Pagination。
- 仍走 Payload 原生列表的 collection 统一 `admin.pagination.defaultLimit: 25`。
- 存量自定义视图（Geography / AuditLog / ReviewQueue）的 20 条改 25 条。

### T6 运营概览提速与充实

- 慢点（已探明）：`countEffectiveListings` 三步串行——`getPausedListingIds` 全量翻页
  listing-reports → `payload.find` listings `pagination:false, limit:500, depth:2` → 内存判定。
- 优化：可并行的并行化；砍不必要的 depth；必要时加短 TTL 缓存。
- 充实：利用既有统计口径补充待办类指标（待审核、举报待处理、无封面房源等已在查询中）。
- 验收：/api/dashboard-stats 响应时间对比（前后各测），页面指标齐全。

---

## 非目标

- 不改任何表结构、不生成迁移（全部 admin/UI 层改动，提交用 `SKIP_MIGRATION_CHECK=1`，
  以 `migrate:create` 无 diff 输出为证据）。
- 不动生产数据（「官网」商户记录已存在，id=1）。
- 不替换 Listings/Buildings 之外其余 collection 的原生列表页（只调默认每页条数）。
- 不动 C 端。

## 验证证据

存 `artifacts/verification/OPT-056/`。
