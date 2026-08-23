# Task Packet：OPT-042 C 端表单 requestId 生命周期对齐（失败重试不再产生重复行）

> 状态：**待排期**（从 23505 判定失效核查中显式分出，用户裁定本轮不动）
> 创建日期：2026-08-23
> 来源：`fix/unique-violation-detection-9c41`（commit `e24b106`）的真库核查
> 编号说明：OPT-041 已被后台批量导入占用，故取 042

---

## 1. 一句话

`InquiryModal` 与 `CorrectionModal` **每次点击提交都重新生成 `requestId`**，
而幂等键 = `sha256(requestId | ...)`，于是「服务端报错 → 用户再点一次」这条最自然的
用户行为会**绕过幂等键落一条重复行**；同仓的 `SupplySubmissionForm` 与
`CityPartnerApplicationForm` 已经做对了（挂载期取一次、失败重试沿用同键）。

## 2. 现状与证据

| 表单 | requestId 取值时机 | 失败重试的后果 |
|---|---|---|
| [`InquiryModal.tsx:420`](../../payload-office-platform/src/components/frontend/InquiryModal.tsx) | `handleSubmit` 内 `generateRequestId()` | **每次重试换新键 → 重复 Lead** |
| [`CorrectionModal.tsx:156`](../../payload-office-platform/src/components/frontend/CorrectionModal.tsx) | `handleSubmit` 内 `generateRequestId()` | **每次重试换新键 → 重复纠错记录** |
| [`SupplySubmissionForm.tsx:449`](../../payload-office-platform/src/components/frontend/landing/SupplySubmissionForm.tsx) | coordinator 创建时取一次，另有 `pendingRequestStore` 持久化 | 沿用同键 → 软幂等命中，无重复 |
| [`CityPartnerApplicationForm.tsx:221`](../../payload-office-platform/src/components/frontend/city-partner/CityPartnerApplicationForm.tsx) | `createCityPartnerApplicationCoordinator` 内 `const requestId = requestIdFactory()` | 同上 |

真库实测（2026-08-23，本地 PG + dev server）：对 `/api/inquiries` 并发双击，
一个 200 一个 500；模拟用户看到报错后再点一次（新 requestId），
同一手机号 `13800000099` 落了 **2 条 Lead**（`id=98`、`id=100`）。

## 3. 为什么这轮不做

触发这次 500 的根因（`23505` 判定对本项目的 drizzle 适配器恒为 false）已在
`fix/unique-violation-detection-9c41` 修掉，那条具体路径不再产生 500。

但 requestId 每次重生成本身是**独立的**脆弱点：任何服务端 5xx（限流存储抖动、
DB 连接抖动、部署窗口期、上游超时）都会让用户点第二次，而这两个表单的第二次
必然是一条新记录。修好一个 500 的来源不等于修好这条路径。

拆开的另一个理由是评审面：本轮改的是服务端判定 + 测试 fixture，
改 C 端表单组件会连带碰它们现有的交互测试与 E2E，混在一起会把一个
「判定写错了」的修复稀释成一次组件重构。

## 4. 建议做法

对齐已经做对的两个表单：

1. `requestId` 提到组件挂载期（`useRef` / coordinator 字段），一次表单会话一个键；
2. **提交成功后**才重置为新键（下一次是新的业务意图，不该复用旧键）；
3. 表单内容被用户改动后也应重置——幂等键的语义是「同一份提交的重放」，
   用户改了手机号或留言就不再是同一份（参考 `SupplySubmissionForm` 的
   `createSupplyIntentFingerprint` / `intentKeyFactory` 做法，可直接复用）；
4. 考虑是否同样接 `pendingRequestStore`（跨刷新保留），
   `SupplySubmissionForm` 已有实现，评估对询盘弹窗是否过重。

## 5. 验收

- 单测：同一 coordinator/组件实例连续两次提交（第一次服务端 500）→ 两次请求体的
  `requestId` 相同；提交成功后再提交 → `requestId` 不同；改动手机号后 → `requestId` 不同。
- 真库：dev server 上让 `/api/inquiries` 人为返回一次 500，前端重试后
  `select count(*) from leads where phone = ?` 必须是 1。
- 不得回归：现有 `tests/inquiry-*.test.ts`、`tests/correction-*.test.ts`
  与 `tests/e2e/` 相关用例全绿。

## 6. 相关

- `fix/unique-violation-detection-9c41` / commit `e24b106`：服务端判定修复，本工作项的直接上游。
- `payload-office-platform/src/domain/shared/unique-violation.ts`：唯一约束冲突判定的唯一实现。
- `.agent/supply.md`「幂等键 = sha256(...)，DB 唯一索引兜底」：本工作项守护的正是这条口径的前半段。
