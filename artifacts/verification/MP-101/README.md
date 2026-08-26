# MP-101 验证证据

验证日期：2026-08-26。验证执行时尚未提交、推送、创建 PR、部署或执行迁移。HTTP 尝试未进行业务数据写入；缺失数据库配置使 Payload 启动阶段尝试创建未定义数据库并失败，细节见“真实 HTTP”。

## 范围

- 新增且仅新增三个只读端点：`GET /api/mini/v1/home`、`GET /api/mini/v1/listings`、`GET /api/mini/v1/listings/[slug]`。
- 未新增登录、咨询写入、Collection、Global、migration 或部署配置。
- Mini DTO 继续消费 Public Catalog DTO；计价单位保留结构化字段，不做跨单位换算。
- 详情月费用显式返回 `currency=CNY`、`period=month` 和物业费包含状态。`included` 的合计等于租金且不重复加物业费；`excluded` 只有租金、物业费金额和面积齐全才计算合计；`confirm` 或状态缺失时 `total=null`。所有金额按人民币分保留两位。
- 列表的区域、类型、计价单位分别来自“忽略自身维度”的 facet 快照，当前选择不会擦除同维度其他候选，零结果时仍保留可放宽选项。
- 根相对媒体地址由受信任 `siteOrigin` 转为绝对 URL，已有绝对 CDN URL 原样保留。
- `meta.maxAgeSeconds=300` 是服务端数据快照 TTL；200/404/503 HTTP 响应全部为 `Cache-Control: private, no-store`，调用方 `requestId` 不进入共享缓存。

## TDD 与公开供给一致性

新增 `tests/mini-api-public-supply-parity.test.ts`。同一上海夹具覆盖两种有效房源（含 `updatedAt` 超过 60 天但按现行生产谓词仍有效）、草稿、未审核、冻结、举报暂停、城市停用、商户资质过期、已出租和逻辑删除状态。fixture adapter 直接消费生产 `getEffectiveSupplyWhere`、`buildEffectiveSnapshot`、`isListingEffectivelySupplied` 与 `isListingPaused`，不读取自写 `expectedEffective` 布尔，也不复制有效供给字段谓词。Public Catalog 输出映射为 Mini DTO 后，Listing ID 集合不增不减，并逐个断言八个无效 ID 均被排除；DTO 不含商户、审核、举报、内部电话和审计字段。

2026-08-26 用户选择规则 A：陈旧只触发 `listing-stale-maintenance` 维护待办，不影响公开可见性。`.agent/supply.md` 已同步到当前生产 effective-supply 与既有 F7.6 语义；本 parity 以 old `updatedAt` 房源仍然有效作为永久回归守卫。

RED：权威查询层与商户精筛已经接入、但举报暂停边界尚未接入时，预期有效 ID 为 `3200, 3201`，实际多出被举报暂停的 `3205`，`1 failed / 0 passed`。这是遗漏真实有效供给边界产生的失败，不是人为让 adapter 返回整份 fixture。

GREEN：接入生产 `isListingPaused` 后，`1 file / 1 test` 通过；相关有效供给、既有一致性与 mapper 测试合计 `4 files / 59 tests` 通过。

## 自动化门禁

以下命令均使用 Node `v22.23.2` 执行：

```text
pnpm typecheck
pnpm test
pnpm lint
```

- `pnpm typecheck`：exit 0。
- `pnpm test`：最终协调代理 fresh 重跑为 `285 passed files / 3884 passed tests`，另有既有 `5 files / 25 tests` skipped；相对 MP-101 开始前的 `276 files / 3818 tests`，新增 9 个通过文件和 66 个通过测试，跳过数未增加。
- `pnpm lint`：exit 0，`0 errors / 23 warnings`。23 条均位于本任务未修改的既有前台文件；Task 8 新增测试与脚本没有 warning。
- 通过 `pnpm dlx node@22` 调用 pnpm 时有一条外层工具链既有的 `DEP0169 url.parse()` 弃用提示，不来自项目源码。
- 终审修复真实 RED：8 个相关文件 `28 failed / 34 passed`；实现后定向 GREEN 为 `8 files / 62 tests`。最终协调代理在最新工作树上用 Node 22 fresh 验证：full typecheck exit 0、full test `285 files / 3884 tests`、full lint `0 errors / 23 existing warnings`；修改范围 scoped lint `0 warning / 0 error`，脚本 `node --check` 通过。
- 复审 Important 新增人民币分舍入守卫：RED 为 `2 failed / 26 passed`（共享月租与 Mini 卡片均暴露 `9.000000000000002`）；GREEN 后月租、Mini mapper 和 Web 摘要 `3 files / 47 tests` 通过，Node 22 typecheck 与 scoped lint 均 exit 0。

## 真实 HTTP

复现脚本：`payload-office-platform/scripts/verify-mini-api.mjs`。脚本会自动选择上海按元/㎡/天报价列表的第一条 slug，并验证：三个 200 的 `ok=true`、无 error、精确 `Cache-Control: private, no-store`、`maxAgeSeconds=300` 和合法 ISO `asOf`；两个 404 的 `ok=false`、稳定错误码和同一 no-store 契约；所有响应 header/body request ID 一致；详情 slug 等于列表自动选择的 slug。每个请求使用 `AbortSignal.timeout(10000)`；响应先读文本再受控解析 JSON，异常会带 status、content-type 和截断正文诊断。证据包含 `verifiedAt`，先写同目录临时文件再原子 rename；运行开始先删除旧目标，失败不会留下可能被误认作本轮成功的旧 `http.json`。

```sh
cd payload-office-platform
node scripts/verify-mini-api.mjs \
  http://localhost:3717 \
  ../artifacts/verification/MP-101/http.json
```

用户授权后，已为当前 worktree 创建本地隔离数据库 `sbh_dev_mp_59f9` 和权限为 `600` 的独立 `.env.local`；仓库现有迁移与本地种子数据均成功执行，未连接或改写主工作区数据库。

Node 22 服务在隔离端口 `3729` 启动后，首次验证命中此前失败环境留下的 Next 城市负缓存，返回旧 404；该请求同时完成后台刷新，随后的冷启动复现和完整脚本均稳定通过。最终证据写入 `artifacts/verification/MP-101/http.json`，记录：

- home、list、detail：三个 HTTP 200；
- invalid city：HTTP 404 + `city_not_found`；
- invalid listing：HTTP 404 + `listing_not_found`；
- 列表命中 4 条 `rmb-sqm-day` 房源，详情自动选择 `lujiazui-grade-a-780sqm`；
- 五个响应均有 header/body 一致的 request ID；三个成功响应均有合法 `asOf`；
- 五个响应均为 `Cache-Control: private, no-store`。

本地验收服务已停止。`.env.local` 被 Git 忽略，数据库仅用于当前 worktree 的后续本地复核。

## 状态

自动化门禁、陈旧规则统一和真实 HTTP 证据均已完成。MP-101 状态为“实施完成，待用户验收”；MP-102 尚未开始。验证完成时尚未推送、创建 PR 或部署。
