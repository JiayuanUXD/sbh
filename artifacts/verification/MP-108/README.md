# MP-108 验证证据

## Task 5：本机集成验收（2026-09-07）

本轮候选为 `e2d2666eaf8d6d1ec1850c7d0fff8eb8f3d4e09f`，业务集成为 `7fdd91afb24891a8ad0d9560ccf8927c0c055e72`。证据均本轮新采，不复用旧截图。数据库保留供复核，禁止删除或把已存在 fresh 库重新当作空库运行。

- [local-postgres.json](./local-postgres.json)：升级库明确 80 → 81；新库不存在证明、创建、完整 81 迁移、seed/离线 seed:media、幂等复跑、8 files / 41 tests 实连全通过。旧 baseline 的 49 是每个 collection 最多 3 条的脚本口径，不是全库总记录；各表真实 count 另列。fresh 后续 baseline 为 42 collections / 有界 50。
- [local-build.json](./local-build.json)：受控临时 build-info 注入当前完整 SHA，构建退出 0 后删除。Task 5 的重建替换了 Task 4 的 `.next` 指纹；Task 4 的 JSON 是历史证据，其 verifier 对当前构建拒绝旧指纹是预期行为。
- [local-mini-api.json](./local-mini-api.json)、[local-mini-api-probe.json](./local-mini-api-probe.json)：只读访问升级库；health 200 / 精确 SHA，首页、列表、真实详情、非法城市、无效详情、request ID、no-store、asOf、固定 pageSize=24 与 slug 对账。
- [local-e2e.json](./local-e2e.json)：所有可写 E2E 仅连接 fresh。原关闭态 `127.0.0.1` 配置错误导致 158 passed / 15 skipped / 9 failed / 5 did not run，原输出完整保留。Playwright 1.61.1 的 Secure-cookie HTTP 例外只认 localhost；改回 CI 原本的 localhost 后，18 个登录/批量导入证伪用例全通过，再完整重跑关闭态，并运行开启态四 spec。不得把条件跳过当通过。
- `local-e2e-cleanup-*.json`：只按本轮精确 request ID、externalId、文件名和地理 slug 清理自身夹具，前后真实 count 与残留另列；缺少可复核唯一标记关联的事件不擅自删除。
- 最终 E2E：关闭态 **172 passed / 15 skipped / 0 failed**；开启态 **20 passed / 2 skipped / 0 failed**，两趟均无 flaky/did-not-run。跳过是既有 flag 条件分支，不计通过。
- [local-devtools.json](./local-devtools.json)：最终 `pnpm devtools:smoke` exit 0，develop 首页/列表/真实详情 ready 全通过，并与本轮 server 日志 request ID 对应。初次 Launcher 失败、CLI 登录检查、显式打开当前项目后的直连诊断均保留在 priorAttempts；在当前项目正常关闭释放 9420 后原命令成功。应用附带的 session POST 为 503：未设置 `MINI_TRUSTED_PROXY_HOPS`，在路由最前段 fail-closed，未进入数据库限流或微信 gateway；不将本地冒烟外推为微信登录/资产写链路通过。
- [local-settlement.json](./local-settlement.json)：两个数据库均保留；112 个 public 表真实 count 已记录；升级库 HTTP 开始以来所有带 updated_at 表的新增更新计数均为 0，users_sessions/限流/资产表也为 0。3717 已释放，临时 build-info 已删除。fresh 精确业务夹具标记归零，leads=8/listings=11/locations=14，供给/合伙人/表单均为 0；另保留 3 条孤立供给事件及对应 3 jobs、21 audit_logs、6 listing_reviews、148 users_sessions、11 preferences 等运行副产物，详见逐表 count。缺少原始 request ID 可复核归属者未广删，fresh **不是字节级恢复到 seed 状态**。

最终 `task5-verify.mjs verify` 退出 0，独立重解析四次 E2E 摘要（含原失败）、核验候选/构建/12 路由 bundle、41 实连用例、HTTP/DevTools 请求关联和端口结算；验证脚本自身 11 个纯函数反例测试通过。既有 E2E 自动生成的 20 张未脱敏截图已移至忽略的 `.superpowers/sdd/task5-unreviewed-visuals`，可恢复但不交付为脱敏验收截图；最初失败 trace/video 未另行归档，后续 Playwright 运行会清理 test-results，不能声称仍保留。原失败的完整脱敏终端输出已保留，未引用旧 MP-109 图。

复现脚本均位于本目录。先使用上文固定 Node 22 PATH；以下命令从工作树根执行。脚本白名单继承环境、随机强 secret 仅进入子进程，严格校验本机数据库身份，不加载未知 env，不注入 COS。`prod` 只准第 81 迁移写入；后续只读服务增加已有的 `PAYLOAD_DISABLE_JOB_AUTORUN=1` 与 PostgreSQL `default_transaction_read_only=on` 保护。所有服务只绑定 127.0.0.1:3717；Playwright 以 localhost 访问以保持 CI cookie 语义。

```sh
# preflight/upgrade/fresh 仅在数据库满足原始前置时运行；当前两库已保留，不能再次重放创建。
node artifacts/verification/MP-108/task5-local.mjs preflight
node artifacts/verification/MP-108/task5-local.mjs upgrade
node artifacts/verification/MP-108/task5-local.mjs fresh
node artifacts/verification/MP-108/task5-build.mjs

# 每个 server 在独立终端启动；阶段结束后仅对该进程 Ctrl-C，确认3717释放再启动下一阶段。
node artifacts/verification/MP-108/task5-server.mjs http
node artifacts/verification/MP-108/task5-http.mjs
node artifacts/verification/MP-108/task5-server.mjs e2e-false
node artifacts/verification/MP-108/task5-e2e.mjs diagnostic
node artifacts/verification/MP-108/task5-e2e.mjs false-corrected
node artifacts/verification/MP-108/task5-server.mjs e2e-true
node artifacts/verification/MP-108/task5-e2e.mjs true
# 历史清理已完成；旧 initial/final 模式现禁用。不得重跑现存数据库清理。
node artifacts/verification/MP-108/task5-server.mjs devtools
node artifacts/verification/MP-108/task5-devtools.mjs
# 停止本任务server后
node artifacts/verification/MP-108/task5-settle.mjs

# 仅只读复核，不运行测试、不连接数据库、不写文件
node artifacts/verification/MP-108/task5-local.mjs verify
node artifacts/verification/MP-108/task5-verify.mjs verify
node --test artifacts/verification/MP-108/task5-*.test.mjs
```

首次 server 未设 CI 触发 COS guard 503，按仓库已有本地 CI 离线例外设置 CI=1 后通过；未修改守卫。初始补充分页探针错误假设 pageSize=2，阅读真实固定 24 契约后纠正，所有补跑均为只读 GET。服务端访问观察器只记录 Mini 路径（去掉 query/body）、状态码与 request ID；不改业务源码。验证脚本的数据库身份、前置状态、脱敏路径、清理标记与摘要冲突反例均先 RED 后 GREEN。

本轮不包含云端、生产、staging、trial、正式上传或真机验收。没有 Git 写操作；`.planning/` 与忽略的 `.superpowers/` 是本地过程文件，不计入候选源码。

### Task 5 审查修复（四项 Important）

本次只修验证脚本与单元反例，没有连接数据库、启动服务、运行 E2E/DevTools，所有实际验收 JSON/log 均未重采或改写。

- `task5-local.mjs verify` 现在直接调用 `task5-verify.mjs verify`，两个入口采用同一完整判据。固定非空命令及目标；重解析实际迁移/verify/baseline/Vitest输出，核验80→81、fresh81、41测试与41表前后count；HTTP五合同、固定24分页、五request ID集合与真实日志；DevTools固定三marker、三类路由访问及命令时间窗口内唯一request ID。允许真实的“自动首页+导航首页”多一次GET，不以空数组every为PASS。
- E2E capture与verify共用严格摘要解析器；PASS要求非零passed且failed/flaky/didNotRun全部为0。原首次FAILED仍保留，不会覆盖成成功。
- 所有执行脚本共用的identity先比对完整HEAD，然后分别检查索引、工作树、未跟踪文件；仅放行本证据目录和`.planning/`、`.superpowers/`过程文件，业务/迁移dirty立即拒绝。
- cleanup旧无参数期望值模式关闭。未来只有额外明确授权后才可 `task5-cleanup.mjs apply <已审批计划.json>`；计划须含candidateSha、database、evidenceFile、evidenceSha256、candidateEvidenceSha256、markers、expectedDelete、expectedRemaining。证据文件固定绑定`local-e2e-cleanup-initial.json`或`local-e2e-cleanup-final.json`与`local-e2e.json`，双SHA-256、候选/目标/唯一标记/9类精确删除数量全部在连接前校验；缺计划或篡改即拒绝。端口3717必须无人监听；BEGIN后锁定相关表，先核验每个删除集合及表总数，再逐条核验实际rowCount和事务内剩余count，最后才COMMIT；任一异常ROLLBACK。当前历史库已经清理过，不可用旧计划重放；不通过放宽expected值绕过。

严格RED：原完整证据对照通过，25个反例暴露原误判/缺失边界；另一次证据绑定篡改反例RED。修复后全部Task5脚本单元测试 **41 passed / 0 failed / 0 skipped**（含30个新审查案例），两个只读verify均exit0。数据库执行边界仅用内存事务替身；dirty身份使用受控临时目录与Git命令输出替身，没有Git写操作。此处41个脚本单元测试与此前41个真实PostgreSQL业务用例是两组不同证据，不应混为一组。

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
