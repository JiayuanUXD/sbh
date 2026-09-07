# Task Packet：MP-101 Mini API v1 只读门面

> 状态：实施完成，待用户验收
> 创建日期：2026-08-26
> 分支：`feat/miniprogram-mvp-59f9`
> 基线：`origin/master@dc5ccef`
> 上游设计：`specs/work-items/MP-001-miniprogram-mvp-design.md`

## 1. 目标与架构

为微信小程序提供首页、房源列表和房源详情三个版本化只读 API，同时保证公开供给、价格、媒体和缓存口径与现有 Web 一致。

```text
Next Route Handler（只处理 HTTP）
  → lib/mini-program（城市校验、缓存与查询编排）
    → domain/mini-program（传输 DTO 与纯 mapper）
      → Public Catalog / Effective Supply
```

任何 Payload Document 都不得越过 Public Catalog 进入 Mini API。路由不得拼 Payload `where`，不得复制有效供给谓词。

## 2. 范围

### 包含

- `GET /api/mini/v1/home`
- `GET /api/mini/v1/listings`
- `GET /api/mini/v1/listings/[slug]`
- Mini API v1 DTO、稳定错误码、`requestId`、真实 `asOf`
- Public Catalog 数据快照的 300 秒标签缓存
- Web / Mini 公开 Listing ID 集合一致性守卫
- 可重复执行的真实 HTTP 验证脚本

### 不包含

- 小程序页面工程、登录、手机号、咨询写入
- Collection、Global、迁移、部署、正式上传
- 新增生产陈旧排除逻辑（2026-08-26 用户确认：陈旧仅触发维护待办，不影响公开可见性）

## 3. 不可变接口与语义

### 3.1 响应

- 成功响应：`ok=true`，包含 `data` 和 `meta.requestId/asOf/maxAgeSeconds`。
- `meta.maxAgeSeconds=300` 只表示服务端 Public Catalog 数据快照 TTL，不是 HTTP 缓存期限。
- 失败响应：`ok=false`，只暴露稳定错误码、用户文案、可选字段列表和 `requestId`，不得泄漏内部异常。
- 200、404、503 全部显式返回 `Cache-Control: private, no-store` 和 `X-Request-Id`；header/body 的 request ID 必须一致。
- `asOf` 在内部缓存回调创建并随快照缓存；不得用响应发送时间冒充数据时点。

权威实现：

- `payload-office-platform/src/domain/mini-program/contracts.ts`
- `payload-office-platform/src/domain/mini-program/response.ts`
- `payload-office-platform/src/app/api/mini/v1/home/route.ts`
- `payload-office-platform/src/app/api/mini/v1/listings/route.ts`
- `payload-office-platform/src/app/api/mini/v1/listings/[slug]/route.ts`

### 3.2 缓存

- 只在 `unstable_cache` 数据快照层缓存，`revalidate=300`。
- 复用 `LISTINGS_CATEGORY_TAG`、`listingsCityTag`、`homeTag`、`facetsTag` 等既有失效标签。
- 首页无当前筛选，可使用一次 facet 查询。
- 列表必须分别查询忽略 `district`、`listingType`、`priceUnit` 的三个 facet 快照；各筛选行只消费对应的自忽略快照。当前选择不得擦除同维度其他候选，零结果仍须保留可放宽选项。
- 同一 city + canonical/slug 在 300 秒内返回相同 `asOf`；不同 city 的相同 canonical/slug 不得串缓存。

权威实现：`payload-office-platform/src/lib/mini-program/cached-queries.ts`。

### 3.3 价格与月成本

- 价格携带 `currency`、`businessType`、`period`、`basis`、`displayUnit`，不同单位不换算、不聚合、不排序。
- `estimateMonthlyRent()` 是 Web 与 Mini 共用的月租折算入口；日租按 30 天折算，月租直接按维度相乘，年度、一次性和出售返回 `null`。
- 共享月租结果按人民币分舍入，确保卡片 `price.monthlyEstimate` 与详情 `monthlyCost.rent` 完全一致。
- `monthlyCost` 固定携带 `currency='CNY'`、`period='month'` 和 `propertyFeeInclusion`：
  - `included`：`total=rent`，物业费金额即使可展示也不重复加总；金额缺失不阻塞 total。
  - `excluded`：只有 rent、物业费金额和面积均存在时才相加，否则 `total=null`。
  - `confirm` 或状态缺失：`total=null`。
- rent、propertyFee、total 均按人民币分保留两位；assumptions 必须与真实分支一致。

权威实现：

- `payload-office-platform/src/domain/public-catalog/monthly-estimate.ts`
- `payload-office-platform/src/domain/mini-program/mappers.ts`

### 3.4 媒体与隐私

- mapper 保持纯函数，所有入口显式接收受信任 `mediaOrigin`。
- 根相对 `/media/...` 转成绝对 URL；已有绝对 CDN URL 原样保留。
- service 从 `getSiteConfig().siteOrigin` 传入 origin；生产环境由既有配置守卫保证 HTTPS。
- Mini DTO 使用递归字段白名单，不包含内部电话、商户资质、审核、举报、权限、审计或原始富文本。

权威实现：

- `payload-office-platform/src/domain/mini-program/mappers.ts`
- `payload-office-platform/src/lib/mini-program/catalog-service.ts`

## 4. TDD 任务记录

所有任务都遵循“先写失败测试并确认失败原因 → 最小实现 → 定向 GREEN → typecheck/lint”的顺序。这里保留验收意图，不复制完整实现代码。

| 任务 | 失败测试要证明的问题 | 永久验收条件 |
|---|---|---|
| 1 响应契约 | 模块缺失、错误码与 request ID 未锁定 | success/failure 字段白名单、固定快照 TTL、HTTP no-store 常量 |
| 2 月租折算 | Web/Mini 缺共享折算、缺字段可能伪造金额 | 日/月折算、年度/出售 null、人民币分舍入 |
| 3 DTO mapper | 嵌套对象可能泄漏内部字段 | 递归白名单、三类 facet 来源、物业费四态、媒体绝对 URL |
| 4 缓存快照 | `asOf` 可能是响应时间，city/key 可能串缓存 | 300 秒标签缓存、同 key 命中、跨 city 隔离、列表三次自忽略 facets |
| 5 服务编排 | 城市、slug、parser 或媒体 origin 可能绕过边界 | 只接受精确 live city/safe slug，复用现有 parser，显式传 `siteOrigin` |
| 6 首页/列表路由 | HTTP 状态、request ID、错误泄漏或缓存头不稳定 | 200/404/503 均精确 no-store，header/body request ID 一致 |
| 7 详情路由 | 城市 404、房源 404、503 可能混淆 | 三态判别联合正确映射，全部响应 no-store |
| 8 一致性与证据 | Mini 可能新增/丢失公开 Listing ID，验证脚本可能误留旧证据 | Public Catalog/Mini ID 集合一致、原子证据写入、失败不留 `http.json` |

相关测试：

- `payload-office-platform/tests/monthly-estimate.test.ts`
- `payload-office-platform/tests/mini-api-contracts.test.ts`
- `payload-office-platform/tests/mini-api-mappers.test.ts`
- `payload-office-platform/tests/mini-api-cached-queries.test.ts`
- `payload-office-platform/tests/mini-api-catalog-service.test.ts`
- `payload-office-platform/tests/mini-api-home-route.test.ts`
- `payload-office-platform/tests/mini-api-listings-route.test.ts`
- `payload-office-platform/tests/mini-api-listing-detail-route.test.ts`
- `payload-office-platform/tests/mini-api-public-supply-parity.test.ts`

## 5. 验证脚本契约

权威脚本：`payload-office-platform/scripts/verify-mini-api.mjs`。

脚本必须：

1. 为每个请求使用 `AbortSignal.timeout(10000)`。
2. 先读取文本，再受控解析 JSON；解析失败诊断包含 path、status、content-type 和截断正文。
3. 对三个 200 与两个 404 都精确校验 `Cache-Control: private, no-store`。
4. 校验 `ok`、稳定错误码、header/body request ID、`maxAgeSeconds=300` 和 ISO `asOf`。
5. 从列表自动选择首条 slug 验证详情，不硬编码房源。
6. 开始前删除旧目标，先写临时文件再原子 rename；任何失败都不得留下可能冒充本轮成功的 `http.json`。

复现命令：

```sh
cd payload-office-platform
node scripts/verify-mini-api.mjs \
  http://localhost:3717 \
  ../artifacts/verification/MP-101/http.json
```

## 6. 完成门与验收结果

### 自动化门

按 Node 22 顺序执行：

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`
4. `node --check scripts/verify-mini-api.mjs`

详细数字和 RED/GREEN 证据见 `artifacts/verification/MP-101/README.md` 与 `.superpowers/sdd/final-fix-report.md`。

### 验收结果

- 已创建仅供当前 worktree 使用的本地 PostgreSQL `sbh_dev_mp_59f9` 和独立 `.env.local`，未借用主工作区数据库。
- 仓库现有迁移与本地种子数据执行成功。
- Node 22 真实 HTTP 验收通过：home、list、detail 三个 200，非法城市和非法房源两个预期 404；request ID、`asOf`、`maxAgeSeconds=300`、no-store 与自动选择详情 slug 均通过。
- 证据：`artifacts/verification/MP-101/http.json`。
- 2026-08-26 用户已选择规则 A：陈旧只触发维护待办，不影响公开可见性；`.agent/supply.md`、当前生产 effective-supply、F7.6 与本任务 parity 已统一。

因此 MP-101 已实施完成，等待用户验收；MP-102 尚未开始。

## 7. Git 与发布约束

- 未经用户确认，不提交、暂存、推送、创建 PR、部署或执行迁移。
- 获得提交授权后仍只可显式 `git add <具体路径>`；禁止 `git add .`、`git add -A`、`git commit -am`。
- 本工作项仅按用户确认同步 `.agent/supply.md` 的陈旧可见性规则；不改 Collection、Global 或 migration。
