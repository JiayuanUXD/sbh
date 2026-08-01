# P2 全量验证证据（Task 6）

生成时间：2026-08-01  
分支：`codex/detail-pages-p2-guidance`

---

## 1. 门禁结果

| 门禁项 | 状态 | 说明 |
|--------|------|------|
| 迁移 | ✅ 通过 | `pnpm payload migrate` 无错误，所有迁移已应用 |
| Lint | ✅ 通过 | 0 errors, 10 warnings（均为预存的 `@next/next/no-img-element`，非 P2 引入） |
| 类型检查 | ✅ 通过 | `pnpm tsc --noEmit` 零错误 |
| 全量测试 | ✅ 通过 | 138 文件 / 2326 测试全绿（10.3s） |
| 生产构建 | ✅ 通过 | `NEXT_PUBLIC_SITE_URL=... pnpm build` 成功，所有路由正常编译 |

---

## 2. 隐私矩阵验证

### 2.1 路线建议（Task 1-2）

| 隐私约束 | 验证方式 | 结果 |
|----------|----------|------|
| 首次不请求定位 | E2E `detail-route-planner.spec.ts`：页面加载后 `__geoCalls === 0` | ✅ |
| 拒绝可降级 | E2E：拒绝后显示"无法获取当前位置"+ 保留"打开高德地图"外链 | ✅ |
| 坐标不持久化 | `RoutePlanner.tsx` 注释声明 + 源码无 localStorage/sessionStorage/cookie 写入 | ✅ |
| 坐标不泄露日志 | `location-route-api.test.ts`："响应不含原始起点坐标"+"日志不含 body/URL/坐标" | ✅ |
| API 日志只记 mode/结果/耗时 | 源码 `route.ts:128-137` 仅 `{ endpoint, route_mode, result, duration_bucket }` | ✅ |
| 错误信息不泄露 Key 或坐标 | `location-routes.test.ts`："错误信息不泄露 Key 或坐标" | ✅ |

### 2.2 顾问服务状态（Task 3）

| 隐私约束 | 验证方式 | 结果 |
|----------|----------|------|
| 前台只公开平台服务状态 | `advisor-service-hours.test.ts`："返回不含个人顾问字段" | ✅ |
| 不公开个人顾问状态 | `AdvisorAvailability.tsx` 仅渲染 `status.state` + `status.message` + `status.nextOpenAt` | ✅ |
| 不显示手机号/排班 | 源码无 phone/schedule/personal 字段渲染 | ✅ |

### 2.3 情境推荐（Task 5）

| 隐私约束 | 验证方式 | 结果 |
|----------|----------|------|
| 不读取 cookie | `parseRecommendationContext` 拒绝含 `cookie` 字段的 context | ✅ |
| 不读取 localStorage | 同上，拒绝 `localStorage` | ✅ |
| 不读取用户 ID | 同上，拒绝 `userId` | ✅ |
| 不读取手机号 | 同上，拒绝 `phone` | ✅ |
| 不使用跨会话历史 | 同上，拒绝 `sessionHistory` | ✅ |
| 确定性 | 单元测试："确定性：相同输入始终产出相同顺序" | ✅ |
| 只使用有效供给 | `getDetailRecommendations` 通过 `SupplyAdapter.findEffectiveListings` 获取候选 | ✅ |

---

## 3. 预约边界验证

| 边界场景 | 验证方式 | 结果 |
|----------|----------|------|
| 服务时段内有效 slot | `viewing-slots.test.ts`："接受服务时间内、30 分边界、2 小时、未来的 slot" | ✅ |
| 过期 slot 拒绝 | `viewing-slots.test.ts`："拒绝过期 slot" | ✅ |
| 非服务时段拒绝 | `viewing-slots.test.ts`："拒绝非服务时段 slot（周日）" | ✅ |
| 非 2 小时时长拒绝 | `viewing-slots.test.ts`："拒绝非 2 小时时长" | ✅ |
| 越过服务时段末端拒绝 | `viewing-slots.test.ts`："拒绝超出服务时段末端的 slot（17:00-19:00 越过 18:00）" | ✅ |
| 不生成周末时段 | `viewing-slots.test.ts`："不生成周末时段" | ✅ |
| 所有时段均为待确认 | `ViewingSlotPicker.tsx` 标题"偏好看房时间（待顾问确认）"+ 提示文案 | ✅ |
| 服务端复核时段有效性 | `inquiry-api-route.test.ts`："过期时段 -> 422 viewing_slot_invalid，不落库" | ✅ |
| 合法时段落库 pending | `inquiry-api-route.test.ts`："合法时段 -> 落库 pending-confirmation" | ✅ |
| 无时段正常提交 | `inquiry-api-route.test.ts`："无时段 -> 正常提交，viewingPreference 为 undefined" | ✅ |

---

## 4. P2 Definition of Done 检查清单

| # | 条件 | 状态 |
|---|------|------|
| 1 | 未经用户主动操作不读取定位；原始坐标无持久化和日志痕迹 | ✅ |
| 2 | 路线拒绝/失败时仍可外部导航和咨询 | ✅ |
| 3 | 前台只公开平台服务状态，不公开个人顾问状态 | ✅ |
| 4 | 所有预约时段均为待确认，服务端复核时段有效性 | ✅ |
| 5 | 推荐可解释、确定性、只使用显式当前上下文并复用有效供给 | ✅ |
| 6 | 类型、lint、全量测试、构建、迁移和 P2 浏览器/隐私矩阵全绿 | ✅ |

---

## 5. 提交记录

| 提交 | 描述 |
|------|------|
| `b0d82b8` | Task 1: 定义隐私安全的路线摘要契约 |
| `5b9b8dd` | Task 2: 用户主动触发的路线建议 |
| `b2ec06a` | Task 3: 平台顾问服务时间与公开状态 |
| `994e66c` | Task 4: 待确认看房时段 + 修正迁移顺序 |
| `46d5ffd` | Task 5: 可解释情境推荐 — 确定性打分排序 + 详情页接入 |
| (本提交) | Task 6: 全量验证证据 + lint 修复 |
