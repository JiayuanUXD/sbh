# MP-108 验证证据

## Task 4：本地质量门

本轮于 2026-09-07（Asia/Shanghai）验证已提交候选 `7fdd91afb24891a8ad0d9560ccf8927c0c055e72`。Task 4 的全部 11 条命令退出码为 0；既有警告及条件跳过如下。本结论只覆盖本地自动化门，不等于 MP-108 整体完成或生产放行。

机器可读明细、脱敏输出与 12 条 Mini API 路由清单见 [local-quality.json](./local-quality.json)。

| 范围 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 小程序 | `pnpm install --frozen-lockfile` | 0 | 锁文件不变，1124 packages；1123 缓存复用、1 下载 |
| 小程序 | `pnpm test` | 0 | 46 files / 938 tests passed |
| 小程序 | `pnpm typecheck` | 0 | 两份 tsconfig 均通过 |
| 小程序 | `pnpm project:check` | 0 | 工程静态检查通过 |
| Web | `pnpm typecheck` | 0 | 通过 |
| Web | `pnpm lint` | 0 | 0 errors / 22 warnings |
| Web | `pnpm test` | 0 | 363 files / 5151 tests passed；8 files / 41 tests skipped |
| Web | `pnpm migrate:dry-run` | 0 | 81 migrations，0 blocking / 4 warnings |
| Web | `pnpm exec tsx scripts/preflight.ts migrations` | 0 | 3 passed / 1 warning / 0 failed |
| Web | `pnpm migrate:drift` | 0 | config 与最新快照一致 |
| Web | `pnpm build` | 0 | 18 个静态页面；12 条 Mini API 动态路由全部进入 manifest |

## 环境与候选边界

- 工作树：`/Users/liujiayuan/App/wt-mp-108-prod`；Node `v22.23.2`、pnpm `8.6.1`、Next.js `16.2.10`。
- Node PATH 前缀：`/Users/liujiayuan/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin`。
- 检查前后候选源码均无 tracked diff。`.planning/` 为未跟踪过程文件，`.superpowers/` 为忽略的本地过程文件；两者不计入候选源码，但确实存在。本轮新增本 README、JSON 及忽略目录中的 Task 4 报告。
- Web 目录仅有 `.env.example`，没有会被加载的 `.env.local`；小程序无 env 文件。继承环境中没有 `DATABASE_URL`、`PAYLOAD_SECRET`、`COS_*`。
- 普通 Web quality 只额外设置以 `crypto.randomBytes(48)` 生成的强本地 `PAYLOAD_SECRET`，不设置数据库连接串或 COS。
- 构建才设置本地 PostgreSQL（`127.0.0.1:5432`，库名 `sbh_dev_mp108_prod`）、`CI=1`、`NEXT_PUBLIC_SITE_URL=https://mp108.local.test`、`MULTI_CITY_ROUTING_ENABLED=false` 和强本地 secret；完整连接串与 secret 不落证据。
- 类型生成物在门禁前已存在，`prefix` 计数为 2。本轮不重复生成类型/import map。漂移检查结束后迁移目录无 diff。
- 未执行 Git 暂存、提交、推送、合并、reset、checkout、部署或生产访问。安装时从包源下载了 1 个依赖包。

## 警告与跳过的解释

Lint 的 22 条为 20 条 `@next/next/no-img-element`、2 条 `react-hooks/exhaustive-deps`。与本地 `origin/master`（`4d5c5af54692b555564c80a56d2f05a4ea6eae25`）直接比较，全部告警文件、lint 配置和依赖锁文件内容未变，归类为既有警告；没有另开主线工作树重跑基准 lint。

迁移 dry-run 的 4 条既有警告分别来自 20260725 locations 字段类型变更（2）、20260815 locations DELETE（1）、20260820 DROP INDEX（1）；这些迁移及扫描脚本与上述主线引用一致。Preflight 聚合成 1 条字段类型变更警告。新 MP-108 迁移没有 forbidden patterns。构建没有 warning；实验项状态展示不记作警告。

Web 的 8 个 PostgreSQL 测试文件通过原有 `describe.skipIf(!databaseAvailable)` 跳过 41 个用例，与本任务普通 quality 不设置 `DATABASE_URL` 的要求一致。没有改测试定义、增加 skip 或关闭检查；这些用例不能计为已验证。

## 可复核命令

完整独立脚本为 [local-quality.mjs](./local-quality.mjs)，只有显式 `capture` 和只读 `verify` 两种模式。原始 11 条命令由 Agent 分别执行并记录，原始捕获时尚无完整独立脚本；该脚本是在审查修复时补齐。本 JSON 保留原始结果，不冒称由后来补写的脚本生成。

从工作树根目录执行只读核验（无重测试、无构建、无数据库连接或文件写入）：

```sh
export PATH='/Users/liujiayuan/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin':"$PATH"
node artifacts/verification/MP-108/local-quality.mjs verify
```

本次 Node v22.23.2 实跑结果为 `VERIFY PASS`，退出码 0。它独立检查 JSON 的必要结构与字段类型、恰好 11 条固定顺序命令及全部退出码、测试统计与原始摘要相等、候选 SHA 与当前索引/工作树源码身份、源码/manifest 的 12 条路由集合、所有 bundle 存在、构建输出的动态标记及未进入 prerender，以及 manifest SHA-256 和 BUILD_ID。允许后续只包含本任务证据的提交；任何候选源码差异会拒绝通过。

需要重新捕获时，先在私有终端将 `MP108_LOCAL_DATABASE_URL` 设置为本任务已批准的本地连接串，再显式执行（连接串不得复制到证据）：

```sh
node artifacts/verification/MP-108/local-quality.mjs capture
node artifacts/verification/MP-108/local-quality.mjs verify local-quality.capture.json
```

capture 要求 Node 22、pnpm 8.6.1、无可自动加载的 env 文件，仅接受用户 `liujiayuan`、主机 `127.0.0.1`、端口 `5432`、库名 `sbh_dev_mp108_prod`、无密码/查询参数的精确本地 PostgreSQL 目标。子进程环境采用白名单；普通 quality 只注入随机强 PAYLOAD_SECRET，build 才注入已校验本地数据库与固定 CI/origin/flag，从不注入 COS。完整输出先在内存中脱敏再落盘，secret 与数据库 URL 不输出、不落盘；真实退出码、passed/skipped、warnings 均保留，摘要缺失会 fail-closed。

capture 固定执行表格中的恰好 11 条门禁，结果写入独立 `local-quality.capture.json`，不覆盖本轮 `local-quality.json`。本次审查修复只运行 verify，没有重新运行 capture。原构建产物不存在或后来被另一次构建替换时，verify 应失败；需显式重新 capture 才能获得相应新指纹。

在上述工作树分别进入 `sbh-miniprogram` 和 `payload-office-platform`，按表格顺序执行即可。先设置指定 PATH 并确认 `node --version` 与 `pnpm --version`。每条 Web 命令实际通过以下方式启动，secret 只存在子进程环境中：

```js
const { spawnSync } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const env = {
  ...process.env,
  PAYLOAD_SECRET: randomBytes(48).toString('hex'),
}
const result = spawnSync('pnpm', ['typecheck'], { env, stdio: 'inherit' })
process.exit(result.status ?? 1)
```

将参数依次替换为表格中的命令参数即可。构建额外设置前述本地环境（连接串从私有本地配置提供）；普通 quality 不注入数据库。复核前需确认没有真实 env 文件或继承的 COS/生产凭据，不把未知环境直接用于这些命令。

Manifest 证据来自 `payload-office-platform/.next/server/app-paths-manifest.json`；本轮读取所有 `/api/mini/v1/` 键，并与 `git ls-files 'payload-office-platform/src/app/api/mini/v1/**/route.ts'` 逐项相等比较，再确认每个 `bundle` 文件存在，12/12 通过。文件 SHA-256 为 `6f97051da08607fd953da209ce09aff19afbfaf32e334503aff9e6cf494f5031`，Build ID 为 `vcXv0XMqSLgtpD5XZFc8N`。这些是本次构建指纹，不应跨构建硬编码为期望值。

## 尚未覆盖

### v2 审查修复与补采来源

原始 JSON 的 dry-run 只有摘要，没有完整 output，旧 verify 因此不能独立复核其计数。本次按授权于 **2026-09-07T05:53:13.748Z** 仅独立重跑 `pnpm migrate:dry-run`，使用 Node 22、白名单继承环境与随机本地 secret，未设置 DATABASE_URL/COS。退出码 0，真实脱敏输出和该门禁独立的 recordedAt/source 已写入 JSON；81 migrations、0 blocking、4 warnings。其余 10 条门禁没有重跑，preflight 沿用最初已有的完整输出，顶层 recordedAt 仍表示原始捕获时间。

`verify` 与 `capture` 共用迁移摘要解析器，从 dry-run/preflight output 重新解析全部 6 个计数字段并逐项对账；缺失、重复摘要或矛盾均 fail-closed。capture 从 FAILED 状态开始，只有全部解析、身份、manifest 与最终 validate 完成后才写 PASS；任一失败保存 FAILED 及固定阶段的脱敏 failureReasons 并退出 1。

新增 [local-quality-regression.test.mjs](./local-quality-regression.test.mjs) 使用内存反例验证脚本函数；子进程执行与证据写盘边界被内存替身隔离，不执行 pnpm，也不修改真实 JSON/构建。严格 RED 已复现 8 个 verify 缺陷，以及 manifest/最终 validate 错误写 PASS、identity 失败未保存记录。修复后 12 个案例 GREEN，包括完整成功路径。复核命令：

```sh
node --test artifacts/verification/MP-108/local-quality-regression.test.mjs
node artifacts/verification/MP-108/local-quality.mjs verify
```

本轮未执行 PostgreSQL 实际迁移和约束/并发集成验证、浏览器 E2E、微信开发者工具、真机或生产检查。路由进入构建 manifest 不证明运行时 HTTP 响应、鉴权和持久化。本轮没有复用 MP-109 截图；后续验收应补当前候选的独立新证据。
