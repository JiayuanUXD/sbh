# 前台任务：F5：咨询表单与 CRM 闭环

> 返回：[任务索引](../tasks.md)

## 7. F5：咨询表单与 CRM 闭环

- [x] 5.1 确认 Lead 与隐私数据契约
  - 与后台 M5 对齐来源、目标房源/楼盘、需求、活动归因、隐私政策版本和幂等键字段。
  - 明确失效房源转通用需求的保存方式。
  - 数据模型变更生成显式迁移、Payload 类型和回滚说明。
  - _Requirement: R7, R10；Backend: M5；Page PRD: FP-05_

- [x] 5.2 实现可访问咨询 Modal/Drawer
  - 支持首页、列表无结果、房源、楼盘和内容页入口。
  - 实现焦点锁定、关闭、归还、滚动恢复和移动端软键盘适配。
  - 表单字段、目标摘要、隐私同意和成功状态符合 FP-05。
  - _Requirement: R7, R10；Page PRD: FP-05 §2–§4_

- [x] 5.3 实现服务端输入验证与安全边界
  - 校验 Content-Type、body 大小、同源/CSRF、schema、字段长度、枚举和手机号。
  - 白名单化 path 和 campaign 参数。
  - 错误响应使用稳定安全错误码，不泄露内部对象。
  - _Requirement: R7, R10；Design: §10_

- [x] 5.4 实现持久化幂等和共享限流
  - 为幂等键建立数据库唯一约束。
  - 使用生产多实例共享机制限流，IP 仅保存轮换盐哈希。
  - 重复请求返回首次成功语义，429 返回合理 `Retry-After`。
  - _Requirement: R7, R10；Page PRD: FP-05 §5–§6_

- [x] 5.5 实现目标有效性复核和 Lead 创建
  - 带房源时调用 `assertEffectiveListing`。
  - 失效时不建立无效兴趣关系，并提供通用需求替代路径。
  - Lead 创建、来源、隐私同意和幂等结果在同一可靠写入边界完成。
  - _Requirement: R7, R9；Page PRD: FP-05 §5_

- [x] 5.6 实现隐私安全日志与分析
  - 清洗服务日志、客户端监控和分析事件。
  - 验证姓名、完整手机号、留言正文和原始 IP 不出现在日志或埋点。
  - 接入打开、提交、成功和安全错误事件。
  - _Requirement: R7, R10；Page PRD: FP-05 §8_

- [x] 5.7 验收咨询闭环
  - 覆盖正常、字段错误、双击、网络重试、失效房源、限流和服务失败。
  - 在后台确认只生成一次且字段、来源和隐私版本正确。
  - 验证键盘、屏幕阅读器提示和移动端软键盘。
  - _Requirement: R7, R9, R10；Page PRD: FP-05 §9_

## 验证证据

- 类型检查：`pnpm typecheck` 通过
- 单元测试：`pnpm test` 全部通过（含 `inquiry-domain.test.ts`、`inquiry-api-route.test.ts` 等）
- 关键文件：
  - `src/app/api/inquiries/route.ts`（仅 POST + 同源 + JSON + 16KB + schema 白名单 + 幂等 + 限流 + assertEffectiveListing）
  - `src/domain/inquiry/{schema,idempotency,privacy-log,campaign,index}.ts`
  - `src/collections/Leads.ts`（`idempotencyKey unique: true, index: true`，DB 兜底）
  - `src/components/frontend/InquiryModal.tsx`（多入口、焦点锁定、Esc 关闭、软键盘适配）
- 迁移：`src/migrations/20260726_140000_m5_2_leads_inquiry_context.ts`
