# OPT-121 小程序等级同步验证

## 实现范围

- 契约规范值及顺序：`super-grade-a`（超甲级）、`grade-a`（甲级）、`grade-b`（乙级）、`ungraded`（未评级）。
- 响应解析将旧 `creative-park`、`serviced-office` 及 `null` 空等级归一为 `ungraded`；未知字符串继续拒绝。首页、列表与详情均显示“未评级”。
- 楼盘筛选复用契约规范值与中文标签，选项顺序为全部、超甲级、甲级、乙级、未评级；实际请求只发送对应规范值。
- 原有卡片和详情消费共享标签，无需修改展示源代码；其旧文本守卫替换为实际注册组件/页面、调用真实处理函数并检查展示状态的行为测试。筛选文本守卫替换为选择每一项并核验查询参数的行为测试。
- 未改实际物业类型、服务端、数据库、迁移或项目配置；未提交、推送、创建 PR、部署或发布微信版本。

## 执行环境

2026-10-18，Windows PowerShell、pnpm `8.6.1`。首轮使用系统 Node.js `v24.14.0`；小程序初始未安装依赖，已执行 `pnpm install --frozen-lockfile`，锁文件未改。项目要求 Node.js `>=22.12 <23`，首轮命令有 engine 警告。后续主代理找到本机已有 Node.js `v22.22.2`（`C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`），仅在验证子进程 PATH 前置该目录，未安装运行时或修改系统配置。

## 测试先红后绿

先修改测试、运行失败后才修改两个生产源文件。

1. `pnpm test tests/catalog-contracts.test.ts tests/buildings-page-pagination.test.ts tests/building-grade-consumers.test.ts tests/buildings-page-contract.test.ts`
   - 红阶段：4 文件中 2 失败、2 通过，53 例中 9 失败、44 通过。
   - 失败对应乙级/未评级无法解析、旧业态未归一，以及筛选仍显示旧选项和旧顺序。
2. 再将卡片/详情源码文本守卫替换为真实消费行为测试，执行 `pnpm test tests/building-grade-consumers.test.ts`。
   - 红阶段：6 例中 4 失败、2 通过，乙级/未评级解析失败，旧业态显示旧标签。
3. 完成生产改动后重跑第 1 条命令。
   - 绿阶段：4 文件、57 例全部通过。
   - 覆盖四个规范值、两个旧值、null、未知值拒绝、首页解析、卡片/详情标签，以及五个筛选项的标签和请求值。
4. `pnpm typecheck`：通过，退出码 0。包括小程序源码与 Node 测试两份 tsconfig。

### 空等级展示补充回归

按集成核对结果，空等级也必须显示未评级。原解析保留 `null` 时，卡片会漏掉等级，详情显示破折号；现改为在共享解析边界归一为 `ungraded`。

- 先补空值行为测试，执行 `pnpm test tests/catalog-contracts.test.ts tests/building-grade-consumers.test.ts`：39 例中 2 失败、37 通过，分别实证解析得到 null 以及卡片等级文本为空。
- 再实现 null 归一，重跑四份相关测试：4 文件、58 例全部通过。新增覆盖首页精选楼盘、列表在租/无在租条目、楼盘详情、可比楼盘、房源关联楼盘，以及真实卡片/详情展示状态。
- `pnpm typecheck` 再次通过，退出码 0。
- 在已有 Node.js `v22.22.2` 下再次执行相同四份相关测试与 `pnpm typecheck`：58 例及类型检查均通过，退出码均为 0。
- 此补充未重跑全量 Windows 工具测试；下列全量数字为此前运行结果，不代表补充后的完整套件结果。

### 新旧客户端等级能力协商

为配合服务端对旧微信客户端维持可识别等级，新版在统一 `request` 层构造最终传输路径时固定追加 `gradeSchema=quality-v1`。

- 先通过原有 `assertMiniApiPath` 受控路径检查；外部绝对 URL、非 `/api/mini/v1/` 路径仍在发请求之前拒绝。
- 删除调用端所有同名参数（含百分号编码参数名）后仅追加一次固定值，保留其他查询参数的原有编码、重复参数与顺序。调用端不能借同名查询参数覆盖 schema。
- 同时覆盖 HTTP 最终 URL 与 CloudBase `callContainer.path`；catalog 首页、房源列表/详情、楼盘列表/详情、`/me` 收藏卡片读取、`/favorites` 写入及 session 请求均经过统一层。无需在每个业务 service 重复拼接。
- 现有请求层没有按 URL 的客户端响应缓存，未新增缓存。`user-assets` 的已有已确认对象与同一次 load 合并仍仅属于当前服务实例；refresh 继续发出带 schema 的 `/me` 请求。服务端实际接收的最终 URL 已包含 schema，供服务端按最终 URL 区分缓存；服务端缓存实现由服务端代理负责。
- 新增测试直接组合真实 `createRequestClient` 与 `createWxTransport`，在微信 API 边界记录实际 URL/path，未用替代 request 的 mock 假冒协商覆盖。另更新原请求测试对传输路径的预期。

Node.js `v22.22.2` 下验证：

1. 红阶段 `pnpm test tests/request-grade-schema.test.ts`：28 例中 26 失败、2 通过；失败为原先不携带固定 schema，以及重复/调用端覆盖未归一。两个原有拒绝外部路径行为通过。
2. 实现后请求、传输、catalog service、收藏 service 五份相关测试：110/110 通过。
3. 合并前再次执行上述五份及四份等级回归测试：9 文件、168/168 通过。
4. `pnpm typecheck` 与 `pnpm project:check` 均通过，退出码 0。

此补充未重跑全量 Windows 工具测试、未执行微信工具或实机验收，未提交、推送或修改服务端/数据库。

## 全量结果与边界

- `pnpm test`：退出码 1。共 47 文件，43 通过、4 失败；共 971 例，859 通过、112 失败。
- 失败集中在 `tooling-scripts.test.ts`（59）、`staging-acceptance-capsule.test.ts`（51）、`staging-acceptance-runner.test.ts`（1）、`staging-acceptance-recovery.test.ts`（1）。对应现有工具的系统条件：Windows 不提供 `process.getuid`、`O_NOFOLLOW`，触发 `store_config_invalid` 或“当前平台不支持 O_NOFOLLOW”；部分工程检查同时受当前 Node 24 与要求 Node 22 的差异影响。这四份测试与对应工具未修改，本任务未扩大范围修复。
- 首轮 Node 24 下 `pnpm project:check` 退出码 1，输出“需要 Node.js >=22.12 且 <23”；后续仅在子进程切到本机已有 Node `v22.22.2` 后重跑，通过并输出“SBH 小程序工程静态检查通过”，退出码 0。
- 全量测试会临时生成组件 JavaScript。执行前在内存保存小程序已有 `.js` 的字节，使用 `finally` 恢复；执行后仍只有既有五份组件 `.js`，未留下新增生成文件或删除已有文件的改动。
- 尚未执行微信开发者工具模拟器与实机验证；Node 行为测试和类型检查不能代替微信端视觉、交互、合法域名与联网验收。
