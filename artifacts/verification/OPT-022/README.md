# OPT-022 后台 Dashboard 性能验证

验证日期：2026-08-07。本轮最终复核修正未执行数据库写入，亦未暂存、提交或推送代码。

## 自动化与静态检查

在 `payload-office-platform/` 执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/effective-supply-snapshot.test.ts tests/dashboard-stats.test.ts tests/dashboard-stats-endpoint.test.ts tests/dashboard-stats-widget-contract.test.ts tests/opt022-type-safety-contract.test.ts` | 5 files / 36 tests 通过（596 ms）。 |
| `pnpm test` | 143 files / 2,363 tests 通过（10.34 s）。 |
| `pnpm typecheck` | 通过。 |
| `pnpm exec eslint …`（本轮 10 个相关源码、脚本和测试文件） | 通过，0 warning / 0 errors。 |
| `pnpm lint` | 退出 0；16 个 warning、0 errors，均位于不在 OPT-022 变更中的前台文件。 |
| `npx -y node@22 --version` | `v22.23.2`。 |
| `npx -y node@22 node_modules/vitest/vitest.mjs run …`（同上五个聚焦文件） | 5 files / 36 tests 通过（704 ms）。 |
| `npx -y node@22 node_modules/vitest/vitest.mjs run` | Node 22 全量 143 files / 2,363 tests 通过（10.54 s）。 |
| `npx -y node@22 node_modules/typescript/bin/tsc --noEmit --pretty false` | Node 22 类型检查通过。 |
| `npx -y node@22 node_modules/eslint/bin/eslint.js .` | Node 22 lint 退出 0；0 errors、16 个既有前台 warning。 |

默认运行时为 Node `v24.14.0`（pnpm `8.6.1`），与项目声明的 Node `22.x` 不一致，`pnpm test` 和 `pnpm typecheck` 输出 engine warning。通过临时 `npx node@22` 运行时，Node 22 的聚焦/全量测试、类型检查、lint 和 build 均已执行。

覆盖到的合同包括：500 候选的一次批量关系查询、`nextPage`-only / `hasNextPage`-only 分页、畸形分页元数据拒绝、原始关系行 exact-one cardinality、重叠关系 fail-closed、统计服务的八项指标、固定 401、角色查询异常的脱敏通用 500、客户端 same-origin 请求、非负安全整数响应校验、减少动效及 44px 重试触控目标，以及 OPT-022 新增 Payload 端口不使用类型逃逸。

## 生产构建

1. `pnpm build`（未新增环境变量）按既有配置防护失败：收集 `/robots.txt` 页面数据时报告缺少 `NEXT_PUBLIC_SITE_URL`，退出 1。编译和 TypeScript 阶段均已通过；该失败不是 OPT-022 的编译或类型错误。
2. 仅以内联本地、非敏感 URL 重试：`NEXT_PUBLIC_SITE_URL=http://localhost:3717 pnpm build`，退出 0。Next 16.2.10 完成编译、类型检查、页面数据收集及静态页面生成，`/admin/[[...segments]]` 与 `/api/[...slug]` 均列为动态路由。该检查只验证编译/静态生成；不验证生产 `NEXT_PUBLIC_SITE_URL` 配置、生产部署或生产运行时行为。
3. Node 22 复验：`NEXT_PUBLIC_SITE_URL=http://localhost:3717 npx -y node@22 node_modules/next/dist/bin/next build`，退出 0；编译、TypeScript、页面数据收集和 5 个静态页面生成均通过。验证范围同样仅限编译/静态生成。

## 本地 PostgreSQL 批量测量

通过保留的只读复现脚本，以本地 `.env.local` 初始化 Payload 和 PostgreSQL；未输出任何环境变量。测量路径与 Dashboard 一致：获取有效供给 where、排除暂停项、取 `depth: 2` 的 500 个候选，再调用 `resolveEffectiveSupplies`。从 `payload-office-platform/` 运行精确命令：`node --env-file-if-exists=.env.local --import tsx scripts/verification/opt022-batch-resolver-measure.ts`；脚本见 [`opt022-batch-resolver-measure.ts`](../../../payload-office-platform/scripts/verification/opt022-batch-resolver-measure.ts)，结果见 [`batch-resolver-measure.output.json`](batch-resolver-measure.output.json)。

| 项目 | 实测 |
| --- | --- |
| 候选数量 | 500 |
| `listing-merchant-relations` 的 Payload Local API `find` 次数 | 1 |
| `resolveEffectiveSupplies` 耗时 | 初次捕获 146.21 ms；保留命令复跑 147.27 ms；脚本移至最终路径后复跑 161.94 ms。 |
| 结果中 eligible 数量 | 500 |

该计数是批量 resolver 对关系集合发出的 Local API 查询调用数；未启用数据库 SQL 日志，因此不是底层 driver SQL statement trace。数据集已确认可连通 PostgreSQL（下列 health 的 `db: ok`）。三次运行均为同一路径的本地即时观测，耗时随本机负载变化。

## 本地 HTTP 与浏览器

- 未认证 `GET http://localhost:3717/api/dashboard-stats`：HTTP 401，28.10 ms，响应为 `{ "ok": false, "error": "未登录或会话已失效" }`；精确 `curl` 命令与保留的脱敏输出见 [`http-checks.output.md`](http-checks.output.md)。
- `GET /api/health`：HTTP 200，836.64 ms，`status: ok`，`checks.payload: ok`，`checks.db: ok`；命令和脱敏输出同上。
- 3717 已有本地开发服务器运行，故没有重启它。浏览器访问 `/admin/login` 时复用了既有认证会话并重定向到 `/admin`；未读取、请求或暴露凭据。
- 新建认证浏览器标签访问 `/admin`：从导航开始到 load 为 604 ms；“当前可租 500”成功内容可见为 3,254 ms；控制台 error 日志为空。精确 Browser 自动化方法及脱敏结果见 [`authenticated-browser-timing.md`](authenticated-browser-timing.md)。相对于 Task Packet 的修改前约 23.5 s 应用代码记录，这是一份本地开发、热服务/已认证会话的观测快照，不能作为 p95 或跨环境基准。
- 通过临时、随后完全还原的服务延迟/受控异常，真实浏览器验证 loading 骨架、错误文案、重试点击与恢复后的成功态；三个阶段控制台均无 error。步骤和脱敏结果见 [`controlled-widget-states.md`](controlled-widget-states.md)，最终代码不含诊断开关。

## 未验证项与限制

- 未执行无权但已登录的角色矩阵、四个指定 viewport、light/dark/空态完整矩阵，亦未测试生产部署。
- `/admin` 成功态通过既有本地认证会话验证；未执行登录表单提交。
