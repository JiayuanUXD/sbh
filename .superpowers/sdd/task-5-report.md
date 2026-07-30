# Task 5 — 可复用详情组件

## RED → GREEN

- RED：先新增 `payload-office-platform/tests/detail-components-contract.test.ts`，首次运行因四个组件模块尚不存在而失败（`Cannot find package '@/components/frontend/DetailAnchorNav'`）。
- RED（第二轮）：组件实现后，同一测试仅 `InquiryModal` 的三步状态/目标解析契约失败，缺少 `InquiryStep`。
- GREEN：实现详情组件和询盘两步流程后，契约测试通过；随后补充了团队规模前缀不进入隐私日志的回归断言。

## 修改文件

- `payload-office-platform/src/components/frontend/DetailGallery.tsx`
- `payload-office-platform/src/components/frontend/DetailAnchorNav.tsx`
- `payload-office-platform/src/components/frontend/DetailFacts.tsx`
- `payload-office-platform/src/components/frontend/BuildingSupplyBrowser.tsx`
- `payload-office-platform/src/components/frontend/InquiryModal.tsx`
- `payload-office-platform/tests/detail-components-contract.test.ts`
- `payload-office-platform/tests/inquiry-domain.test.ts`

## 组件边界

- `DetailGallery` 仅接受 `DetailMediaViewModel[]`，使用 `figure`、`img`、原生带 controls 的 `video`；空或无效媒体给出确定性、可读的回退。
- `DetailAnchorNav` 仅输出 `visible=true` 的锚点。
- `DetailFacts` 仅接受 `FactGroupViewModel[]`：普通 null 忽略，critical null 显示“咨询确认”。
- `BuildingSupplyBrowser` 仅接受 `BuildingSupplySnapshot`：过滤空组，使用原生 GET form 与 details 折叠；保留 snapshot 给定顺序，不做跨完整价格 key 的排序，且 `price=null` 明确显示“价格面议”。
- 以上前台详情组件与 `InquiryModal` 均不直接导入 `payload` 或 `payload-types`；DTO 只来自 `@/domain/public-catalog` 公共入口。

## InquiryModal 状态与目标解析

- 状态为 `contact → requirements → success`。第一步要求称呼、手机号、团队规模与隐私同意；第二步只包含选填需求。
- `targetResolution` 从成功响应读取，并按 listing/building/general 显示对应确认文案；幂等、限流、失效房源 fallback、焦点管理和隐私同意流程保持原有入口与处理逻辑。
- 现有 API schema 没有 `teamSize` 字段。团队规模以 `团队规模：…` 前缀合并进已有白名单 `message`，不伪装为 `demand.area`，也不发送未知顶层字段。长度按最终合并字符串校验，重复相同前缀不会再次附加。
- `buildInquiryLogEntry` 的回归测试使用该前缀作为 message，确认序列化日志不含团队规模文本。它至多影响安全的字段完整度枚举，不记录内容。

## 验证

- `pnpm test -- tests/detail-components-contract.test.ts tests/inquiry-domain.test.ts`：2 文件、77 测试通过。
- `pnpm typecheck`：通过。
- 使用临时 Node `v22.23.2` 与 pnpm `8.6.1` wrapper 运行 `pnpm test`：122 文件、2168 测试通过。
- `git diff --check`：通过。

## 自检与后续关注

- 已确认无新增 UI 依赖、没有测试专用生产导出、没有改变 API payload 白名单或隐私日志字段。
- 目前团队规模是兼容性备注，无法支持结构化运营统计；如需该指标，应在后续任务中同时扩展 inquiry schema、Lead 数据模型、API route、隐私/审计策略和迁移，而不是由浏览器发送未校验字段。
