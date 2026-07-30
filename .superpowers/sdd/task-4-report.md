# Task 4 — 扩展咨询上下文和提交时降级

## RED / GREEN

- RED：先增加询盘 schema 与 API 路由测试，并运行 `pnpm test -- tests/inquiry-domain.test.ts tests/inquiry-api-route.test.ts`。结果为 7 项失败：新详情上下文未被 schema 采纳、成功响应缺少 `targetResolution`，以及旧逻辑将无效 listing 返回 409，未降级到 building/general。
- GREEN：实现白名单 schema、最终目标解析、Lead 映射及日志字段后，同一聚焦命令通过 **98/98**；补充 Lead 上下文持久化断言后，相关 4 个测试文件通过 **150/150**。

## 实现与目标解析

- `InquiryRequest` 新增 `source.section`、`source.currentFilters`、`activeSupplyGroup`、`priceSnapshot`。section、供给分组、价格展示单位、筛选键和值全部为显式 allowlist；无效上下文只返回稳定错误码，不回显原始值。
- `/api/inquiries` 使用同一个 `defaultSearchContext()` 依序解析 `listing → building → general`：listing 有效则只保存 listing；否则有效 building 则只保存 building；两者均无效则保存 `targetType=none` 和两个空 slug。响应为 `{ ok: true, targetResolution }`。
- `assertEffectiveBuilding` 位于 Public Catalog facade，并从 public-catalog 索引导出；路由未拼 Payload `where` 或读取原始文档。
- `priceSnapshot` 作为非权威 JSON 快照保存，并写入 `priceSnapshotSubmittedAt`；不会参与公开价格查询、聚合或排序。

## 隐私断言

- 降级到 building 的 API 测试断言日志仅含 `hasPriceSnapshot`、白名单 `section`、`targetResolution` 等安全元数据，不含价格数值/单位、筛选原值、姓名、完整手机号或留言。
- 无效的 section/filter/价格/分组测试断言返回中不含原始姓名或手机号片段。
- 已同步 F7.5 的固定日志与 `InquiryRequest` 契约测试，防止新上下文字段未受审计地进入日志。

## 迁移与生成

- 运行 `pnpm exec payload generate:types` 更新 `src/payload-types.ts`。
- 仅通过生成器运行 `pnpm exec payload migrate:create inquiry-detail-context`，生成并注册：
  - `src/migrations/20260730_134600_inquiry_detail_context.ts`
  - `src/migrations/20260730_134600_inquiry_detail_context.json`
- 生成结果已人工核对：无 generator rename 提示、无 rename DDL、无重复或无关 DDL；仅为 `leads` 增加 `source_section`、`active_supply_group`、`current_filters`、`price_snapshot`、`price_snapshot_submitted_at` 及两个新 enum。
- 新建一次性数据库 `sbh_task4_inquiry_detail_context_20260730`，从 init 到 `20260730_134600_inquiry_detail_context` 完整运行全部迁移。随后查询确认五个列与该 migration 记录存在，成功后删除该数据库；最终状态为 `removed`。

## 验证

- `pnpm test -- tests/inquiry-domain.test.ts tests/inquiry-api-route.test.ts tests/f7-5-security-privacy-acceptance.test.ts tests/preflight-migrations.test.ts` — **150/150**。
- `pnpm typecheck` — 通过。
- `pnpm preflight:migrate` — 0 failures；保留既有 `20260725_130727_m2_1_locations_geo_node` 类型变更 warning。
- `pnpm test` — **121 test files / 2,159 tests** 全部通过。
- `git diff --check` — 通过。

## 自检与遗留关注

- 确认既有 idempotency 查询和分布式限流顺序未改变；幂等命中从已保存的最终 `targetType` 恢复 `targetResolution`。
- 本机只有 Node `24.14.0`，项目声明 Node 22.x；pnpm `8.6.1` 与项目锁定版本一致。所有命令产生 engine warning；未找到可用的 Node 22 wrapper，因此仍需在 Node 22 CI/目标环境复跑。

## Review P1 follow-up — RED / GREEN / Node 22 verification

- RED：为 `MAX_INQUIRY_PRICE_SNAPSHOT_AMOUNT` 边界、超界/`Number.MAX_VALUE` 拒绝，以及 source 顶层未知嵌套字段注入增加测试后，`pnpm test -- tests/inquiry-domain.test.ts tests/inquiry-api-route.test.ts` 出现 3 个预期失败：边界常量尚未导出、0/超界金额仍会通过、source 未知键仍会被忽略并创建 Lead。
- GREEN：导出并文档化 `MAX_INQUIRY_PRICE_SNAPSHOT_AMOUNT = 1_000_000_000_000` CNY；价格快照仅允许 `(0, MAX]` 内有限数。source 顶层现在精确限制为 `pageType`、`path`、`section`、`currentFilters`、`campaign`；任何未知键返回稳定 `source_invalid`。`currentFilters` 原有的键和值 allowlist 保持不变。
- 隐私回归：domain 与 API 测试均使用嵌套 `李四13900009999` 注入值，断言 schema 错误、HTTP 响应与 logger 调用序列化均不含该值，且不调用 Lead 创建。
- 按审查指定的 wrapper 成功执行：Node `v22.23.2`、pnpm `8.6.1`；4 个相关测试文件 **153/153**、`pnpm typecheck`、全量 `pnpm test` **121 files / 2,162 tests** 均通过。
